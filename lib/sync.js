'use strict';
/** Orchestration: config, Shopee fetch, SKU matching, sync, log. */
const fs = require('fs');
const path = require('path');
const { ShopeeClient } = require('./shopee');
const { createCashSale } = require('./obm');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
const LOG_FILE = path.join(__dirname, '..', 'sync-log.json');

const DEFAULT_CONFIG = {
  partnerId: '',
  partnerKey: '',
  daysBack: 7,
  sellerCenterUrl: 'https://seller.shopee.com.my/portal/sale/order/',
  // Admin password lives here, next to the other credentials (not hardcoded).
  // ADMIN_PASSWORD env var overrides it at runtime.
  adminPassword: 'deflex123',
  shops: [
    { name: 'shopee 1', shopId: '', accessToken: '', refreshToken: '', customerPkey: 279, active: true },
    { name: 'shopee sales2', shopId: '', accessToken: '', refreshToken: '', customerPkey: 283, active: true },
  ],
};

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return Object.assign({}, DEFAULT_CONFIG, c, {
      shops: DEFAULT_CONFIG.shops.map((def, i) => Object.assign({}, def, (c.shops && c.shops[i]) || {})),
    });
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function appendLog(entries) {
  const log = loadLog();
  log.unshift(...entries);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

/** Build a case-insensitive SKU → product map for a batch of SKUs. */
async function matchProducts(db, skus) {
  const uniq = [...new Set(skus.map((s) => String(s).trim()).filter(Boolean))];
  if (!uniq.length) return { bySku: new Map(), rows: [] };
  const rows = await new Promise((resolve, reject) => {
    const placeholders = uniq.map(() => 'UPPER(?)').join(',');
    db.query(
      `SELECT PKEY, PRODUCTID, PRODUCTNAME, QTYINSTOCK, UNITOFMEASURE
       FROM PRODUCT WHERE UPPER(PRODUCTID) IN (${placeholders})`,
      uniq.map((s) => s.toUpperCase()),
      (err, r) => (err ? reject(err) : resolve(r || []))
    );
  });
  const bySku = new Map();
  for (const r of rows) {
    const key = String(r.PRODUCTID || '').trim().toUpperCase();
    if (!bySku.has(key)) {
      bySku.set(key, {
        pkey: r.PKEY,
        code: String(r.PRODUCTID || '').trim(),
        name: String(r.PRODUCTNAME || '').trim(),
        qty: Number(r.QTYINSTOCK) || 0,
        unit: Number(r.UNITOFMEASURE) || 21,
      });
    }
  }
  return { bySku, rows };
}

async function refreshTokenAndSave(client, cfg, shop, idx) {
  const res = await client.refreshAccessToken({
    shopId: shop.shopId,
    refreshToken: shop.refreshToken,
  });
  // access_token/get returns flat: { access_token, refresh_token, ... }
  const r = (res && res.response && res.response.access_token) ? res.response : res;
  shop.accessToken = r.access_token || shop.accessToken;
  if (r.refresh_token) shop.refreshToken = r.refresh_token;
  cfg.shops[idx] = shop;
  saveConfig(cfg);
  return shop;
}

/**
 * Fetch PROCESSED orders for one shop and build a preview:
 * [{orderSn, status, items:[{sku, qty, price, match, pkey, name}], ok, total}]
 */
async function fetchPreview(db, cfg, idx) {
  const shop = cfg.shops[idx];
  if (!shop || !shop.active) return { error: 'Shop not configured/active' };
  if (!cfg.partnerId || !cfg.partnerKey) return { error: 'Partner credentials missing' };
  if (!shop.shopId || !shop.accessToken || !shop.refreshToken) return { error: 'Shop credentials missing' };
  const client = new ShopeeClient(cfg);

  let list;
  try {
    list = await client.getOrderList({
      shopId: shop.shopId,
      accessToken: shop.accessToken,
      days: Number(cfg.daysBack) || 7,
    });
  } catch (e) {
    // try refreshing the access token once
    await refreshTokenAndSave(client, cfg, shop, idx);
    list = await client.getOrderList({
      shopId: shop.shopId,
      accessToken: shop.accessToken,
      days: Number(cfg.daysBack) || 7,
    });
  }

  const syncedRefs = new Set();
  try {
    const sns = list.map((o) => o.orderSn);
    if (sns.length) {
      const ph = sns.map(() => '?').join(',');
      const params = [...sns, ...sns];
      const rows = await new Promise((resolve, reject) => {
        db.query(
          `SELECT REFERENCE, GSTADD_NAME FROM SALESINVOICE WHERE REFERENCE IN (${ph}) OR GSTADD_NAME IN (${ph})`,
          params,
          (err, r) => (err ? reject(err) : resolve(r || []))
        );
      });
      rows.forEach((r) => {
        syncedRefs.add(String(r.REFERENCE || '').trim());
        syncedRefs.add(String(r.GSTADD_NAME || '').trim());
      });
    }
  } catch (e) {
    // non-fatal: fall back to log only
  }

  const logSet = new Set(loadLog().map((l) => l.orderSn));
  const allSkus = [];
  const details = [];
  for (const o of list) {
    let d = null;
    try {
      d = await client.getOrderDetail({ shopId: shop.shopId, accessToken: shop.accessToken, orderSn: o.orderSn });
    } catch (e) {
      try {
        await refreshTokenAndSave(client, cfg, shop, idx);
        d = await client.getOrderDetail({ shopId: shop.shopId, accessToken: shop.accessToken, orderSn: o.orderSn });
      } catch (e2) {
        d = null;
      }
    }
    if (!d) continue;
    details.push(d);
    d.items.forEach((it) => allSkus.push(it.sku));
  }

  const { bySku } = await matchProducts(db, allSkus);

  const orders = details.map((d) => {
    const items = d.items.map((it) => {
      const p = bySku.get(String(it.sku || '').trim().toUpperCase());
      const price = it.paidPrice > 0 ? it.paidPrice : it.originalPrice; // paid price (after voucher)
      return {
        sku: it.sku,
        variant: it.variant || '',
        name: it.name,
        imageUrl: it.imageUrl || '',
        qty: it.qty,
        price,
        match: Boolean(p),
        pkey: p ? p.pkey : null,
        productName: p ? p.name : '',
        stockNow: p ? p.qty : null,
        unit: p ? p.unit : 21,
      };
    });
    const total = items.reduce((s, i) => s + i.qty * i.price, 0);
    return {
      orderSn: d.orderSn,
      currency: d.currency,
      buyerName: d.buyerName || '',
      payTime: d.payTime || '',
      total: Math.round(total * 100) / 100,
      items,
      ok: items.every((i) => i.match),
      alreadySynced: syncedRefs.has(d.orderSn) || logSet.has(d.orderSn),
    };
  });

  return { orders };
}

/** Sync a list of orders for a shop: writes POS transactions, logs results. */
async function syncOrders(db, cfg, idx, orderSns) {
  const shop = cfg.shops[idx];
  const client = new ShopeeClient(cfg);
  const results = [];
  for (const sn of orderSns) {
    let d = null;
    try {
      d = await client.getOrderDetail({ shopId: shop.shopId, accessToken: shop.accessToken, orderSn: sn });
    } catch (e) {
      try {
        await refreshTokenAndSave(client, cfg, shop, idx);
        d = await client.getOrderDetail({ shopId: shop.shopId, accessToken: shop.accessToken, orderSn: sn });
      } catch (e2) {
        results.push({ orderSn: sn, status: 'error', message: e2.message });
        continue;
      }
    }
    const skus = d.items.map((i) => i.sku);
    const { bySku } = await matchProducts(db, skus);
    const items = d.items
      .map((it) => {
        const p = bySku.get(String(it.sku || '').trim().toUpperCase());
        if (!p) return null;
        return { pkey: p.pkey, qty: it.qty, unitPrice: it.paidPrice > 0 ? it.paidPrice : it.originalPrice };
      })
      .filter(Boolean);
    const unmatched = d.items.filter((it) => !bySku.get(String(it.sku || '').trim().toUpperCase()));
    if (unmatched.length) {
      results.push({ orderSn: sn, status: 'skipped', message: 'Unmatched SKUs: ' + unmatched.map((u) => u.sku).join(', ') });
      continue;
    }
    try {
      const r = await createCashSale(db, {
        customer: { pkey: Number(shop.customerPkey), name: shop.name },
        items,
        orderId: sn,
      });
      results.push(Object.assign({ orderSn: sn, status: r.created ? 'created' : 'exists' }, r));
    } catch (e) {
      results.push({ orderSn: sn, status: 'error', message: e.message });
    }
  }
  const done = results.filter((r) => r.status === 'created');
  appendLog(
    done.map((r) => ({
      orderSn: r.orderSn,
      shopName: shop.name,
      customerPkey: shop.customerPkey,
      transNo: r.transNo,
      pkey: r.pkey,
      total: r.total,
      at: new Date().toISOString(),
    }))
  );
  return results;
}

module.exports = { loadConfig, saveConfig, loadLog, appendLog, fetchPreview, syncOrders, matchProducts };
