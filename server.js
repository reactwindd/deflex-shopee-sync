#!/usr/bin/env node
/**
 * Shopee → OBM sync server (port 8082)
 * Admin UI + API for pulling Shopee orders and writing OBM POS cash sales.
 * Same admin password as the catalog server (ADMIN_PASSWORD, default deflex123).
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { attach, query } = require('./lib/db');
const { loadConfig, saveConfig, loadLog, fetchPreview, syncOrders } = require('./lib/sync');
const { ShopeeClient } = require('./lib/shopee');

const PORT = Number(process.env.PORT || 8082);
const ADMIN_PASSWORD_FROM_ENV = Boolean(process.env.ADMIN_PASSWORD);
let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || loadConfig().adminPassword || 'deflex123';
const ROOT = __dirname;

let db = null;
const SESSIONS_FILE = path.join(ROOT, 'sessions.json');
function loadSessions() {
  try {
    const arr = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}
function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...tokens]));
  } catch (e) {
    console.warn('session save failed:', e.message);
  }
}
const tokens = loadSessions();

const app = express();
app.use(express.json({ limit: '4mb' }));
// React app (built with Vite) takes priority; legacy static dir is a fallback.
app.use(express.static(path.join(ROOT, 'web', 'dist')));
app.use(express.static(path.join(ROOT, 'public')));

function auth(req, res, next) {
  const t = String(req.get('x-admin-token') || '');
  if (!t || !tokens.has(t)) return res.status(401).json({ error: 'Not authorized' });
  next();
}

app.post('/api/login', (req, res) => {
  const pass = req.body && req.body.password;
  if (typeof pass === 'string' && pass === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    saveSessions();
    return res.json({ token });
  }
  res.status(401).json({ error: 'Wrong password' });
});

app.post('/api/logout', auth, (req, res) => {
  tokens.delete(String(req.get('x-admin-token') || ''));
  saveSessions();
  res.json({ ok: true });
});

function mask(s) {
  if (!s) return '';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

app.get('/api/config', auth, (req, res) => {
  const cfg = loadConfig();
  res.json({
    partnerId: cfg.partnerId,
    partnerKeyMasked: mask(cfg.partnerKey),
    daysBack: cfg.daysBack,
    sellerCenterUrl: cfg.sellerCenterUrl || 'https://seller.shopee.com.my/portal/sale/order/',
    shops: cfg.shops.map((s) => ({
      name: s.name,
      shopId: s.shopId,
      accessTokenMasked: mask(s.accessToken),
      refreshTokenMasked: mask(s.refreshToken),
      hasTokens: Boolean(s.accessToken && s.refreshToken),
      customerPkey: s.customerPkey,
      active: s.active,
    })),
  });
});

app.post('/api/config', auth, (req, res) => {
  try {
    const b = req.body || {};
    const cfg = loadConfig();
    if (b.partnerId !== undefined) cfg.partnerId = String(b.partnerId).trim();
    if (b.partnerKey !== undefined && b.partnerKey !== '') cfg.partnerKey = String(b.partnerKey).trim();
    if (b.daysBack !== undefined) cfg.daysBack = Number(b.daysBack) || 7;
    if (b.sellerCenterUrl !== undefined && b.sellerCenterUrl !== '') cfg.sellerCenterUrl = String(b.sellerCenterUrl).trim();
    if (!ADMIN_PASSWORD_FROM_ENV && b.adminPassword !== undefined && b.adminPassword !== '') {
      cfg.adminPassword = String(b.adminPassword);
      ADMIN_PASSWORD = cfg.adminPassword;
    }
    if (Array.isArray(b.shops)) {
      b.shops.forEach((s, i) => {
        if (!cfg.shops[i]) return;
        if (s.shopId !== undefined) cfg.shops[i].shopId = String(s.shopId).trim();
        if (s.accessToken !== undefined && s.accessToken !== '') cfg.shops[i].accessToken = String(s.accessToken).trim();
        if (s.refreshToken !== undefined && s.refreshToken !== '') cfg.shops[i].refreshToken = String(s.refreshToken).trim();
        if (s.customerPkey !== undefined) cfg.shops[i].customerPkey = Number(s.customerPkey) || cfg.shops[i].customerPkey;
        if (s.active !== undefined) cfg.shops[i].active = Boolean(s.active);
      });
    }
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** OBM customers available for mapping (marketplace ones first). */
app.get('/api/customers', auth, async (req, res, next) => {
  try {
    const rows = await query(
      db,
      `SELECT PKEY, NAME FROM CUSTOMER WHERE SUSPENDED IS DISTINCT FROM 'Y'
       ORDER BY CASE WHEN UPPER(NAME) LIKE '%SHOPEE%' OR UPPER(NAME) LIKE '%LAZADA%' THEN 0 ELSE 1 END, NAME`
    );
    res.json({ customers: rows.map((r) => ({ pkey: r.PKEY, name: String(r.NAME || '').trim() })) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/preview', auth, async (req, res, next) => {
  try {
    const idx = Number(req.query.shop || 0);
    const cfg = loadConfig();
    const r = await fetchPreview(db, cfg, idx);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ orders: r.orders, shop: cfg.shops[idx] ? cfg.shops[idx].name : '' });
  } catch (e) {
    next(e);
  }
});

app.post('/api/sync', auth, async (req, res, next) => {
  try {
    const idx = Number((req.body || {}).shop || 0);
    const orderSns = Array.isArray((req.body || {}).orderSns) ? req.body.orderSns : [];
    if (!orderSns.length) return res.status(400).json({ error: 'No orders selected' });
    const cfg = loadConfig();
    const results = await syncOrders(db, cfg, idx, orderSns);
    res.json({ results });
  } catch (e) {
    next(e);
  }
});

app.get('/api/log', auth, (req, res) => {
  res.json({ log: loadLog().slice(0, 200) });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

/* ---------- Image proxy (Shopee CDN thumbnails) ---------- */
const IMG_HOST_RE = /(^|\.)shopee\.com(\.[a-z]{2})?$/;
const imgCache = new Map(); // url -> { body, type, at }
function pruneImgCache() {
  const now = Date.now();
  for (const [k, v] of imgCache) {
    if (now - v.at > 10 * 60 * 1000) imgCache.delete(k);
    if (imgCache.size > 200) imgCache.delete(k);
  }
}
app.get('/api/img', async (req, res) => {
  // token via query param so <img src> tags can use it
  const t = String(req.query.t || '');
  if (!t || !tokens.has(t)) return res.status(401).json({ error: 'Not authorized' });
  const u = String(req.query.u || '');
  let host = '';
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch (e) {
    return res.status(400).json({ error: 'Bad URL' });
  }
  if (!/^https:\/\//i.test(u) || !IMG_HOST_RE.test(host)) {
    return res.status(400).json({ error: 'Only https Shopee CDN URLs allowed' });
  }
  const hit = imgCache.get(u);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
    res.set('Content-Type', hit.type);
    res.set('Cache-Control', 'public, max-age=600');
    return res.send(hit.body);
  }
  try {
    const fr = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (deflex-sync)' }, signal: AbortSignal.timeout(15000) });
    if (!fr.ok) return res.status(502).json({ error: 'Upstream ' + fr.status });
    const buf = Buffer.from(await fr.arrayBuffer());
    const type = String(fr.headers.get('content-type') || 'image/jpeg');
    imgCache.set(u, { body: buf, type, at: Date.now() });
    pruneImgCache();
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=600');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---------- Shopee OAuth (callback) flow ---------- */

app.post('/api/shopee/auth-link', auth, async (req, res, next) => {
  try {
    const idx = Number((req.body || {}).shop || 0);
    const cfg = loadConfig();
    if (!cfg.shops[idx]) return res.status(400).json({ error: 'Unknown shop' });
    if (!cfg.partnerId || !cfg.partnerKey) return res.status(400).json({ error: 'Partner ID/Key missing — fill Settings first' });
    const client = new ShopeeClient(cfg);
    const host = req.get('host') || 'localhost:8082';
    const redirect = `http://${host}/shopee/callback?shop=${idx}`;
    const r = client.authPartnerUrl({ redirect });
    res.json({ authUrl: r, callback: redirect });
  } catch (e) {
    next(e);
  }
});

function page(title, body, ok, autoBack) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#10141b;color:#e8ecf2;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{max-width:420px;text-align:center;padding:24px}
h1{font-size:20px} .s{font-size:26px} p{color:#9aa3b2;font-size:14px;line-height:1.6}
a{color:#7fb0ff}${ok ? '.s{color:#63d98a}' : '.s{color:#f08a8a}'}</style></head>
<body><div class="box"><div class="s">${ok ? '✓' : '✕'}</div><h1>${title}</h1><p>${body}</p>
${autoBack ? '<p><a href="/">Go back to the app now →</a></p><script>setTimeout(function(){ location.href = "/"; }, 2500);</script>' : ''}
</div></body></html>`;
}
const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseQuery(raw) {
  const out = {};
  for (const part of String(raw || '').split(/[?&]/)) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    try {
      out[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1));
    } catch (e) { /* skip malformed */ }
  }
  return out;
}

app.get(['/shopee/callback', '/shopee/callback/:idx'], async (req, res) => {
  // Parse the raw query ourselves — Shopee may append code/shop_id after a
  // redirect that already contains query params, mangling the '?'.
  const raw = (req.originalUrl.split('?')[1] || '');
  const q = parseQuery(raw);
  const idx = Number(req.params.idx !== undefined ? req.params.idx : (q.shop !== undefined ? q.shop : 0));
  const code = String(q.code || '');
  const shopId = String(q.shop_id || '');
  console.log('CALLBACK hit:', JSON.stringify({ raw, idx, hasCode: Boolean(code), shopId }));
  const cfg = loadConfig();
  const shop = cfg.shops[idx];
  if (!shop) {
    return res.status(400).send(page('Authorization failed', 'Unknown shop index.', false));
  }
  if (!code) {
    return res.status(400).send(page('Authorization failed', 'No code returned by Shopee. Raw callback: ' + escHtml(raw.slice(0, 200)), false));
  }
  try {
    const client = new ShopeeClient(cfg);
    const r = await client.getTokenByCode({ code, shopId });
    // token/get returns flat: { access_token, refresh_token, ... }
    const resp = (r && r.response && r.response.access_token) ? r.response : r;
    if (!resp.access_token) {
      throw new Error('No access_token returned: ' + JSON.stringify(r).slice(0, 300));
    }
    shop.shopId = shopId;
    shop.accessToken = resp.access_token;
    if (resp.refresh_token) shop.refreshToken = resp.refresh_token;
    cfg.shops[idx] = shop;
    saveConfig(cfg);
    res.send(page(
      'Authorization complete',
      `Shop <b>${escHtml(shop.name)}</b> is now connected (Shop ID ${escHtml(shopId)}).<br>Taking you back to the app…`,
      true,
      true
    ));
  } catch (e) {
    console.error('CALLBACK token exchange failed:', e.message);
    res.status(500).send(page('Authorization failed', escHtml(e.message), false));
  }
});

app.use((err, req, res, next) => {
  console.error('API error:', err.message || err);
  res.status(500).json({ error: err.message || 'Server error' });
});

attach()
  .then((d) => {
    db = d;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Shopee sync server on http://0.0.0.0:${PORT}`);
      console.log(`Admin password: ${ADMIN_PASSWORD_FROM_ENV ? 'from ADMIN_PASSWORD env' : 'stored in config.json'}`);
    });
  })
  .catch((err) => {
    console.error('Firebird attach failed:', err.message || err);
    process.exit(1);
  });
