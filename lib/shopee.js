'use strict';
/**
 * Minimal Shopee Open Platform API v2 client.
 * Docs: https://open.shopee.com/
 */
const crypto = require('crypto');

const BASE = 'https://partner.shopeemobile.com';

function sign(partnerId, partnerKey, path, timestamp, accessToken, shopId) {
  let base = `${partnerId}${path}${timestamp}`;
  if (accessToken) base += accessToken;
  if (shopId) base += shopId;
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex');
}

class ShopeeClient {
  constructor({ partnerId, partnerKey }) {
    this.partnerId = partnerId;
    this.partnerKey = partnerKey;
  }

  async _call({ method, path, query = {}, body = null, shopId, accessToken }) {
    const ts = Math.floor(Date.now() / 1000);
    const auth = sign(this.partnerId, this.partnerKey, path, ts, accessToken || '', shopId || 0);
    const qs = new URLSearchParams({
      partner_id: String(this.partnerId),
      timestamp: String(ts),
      sign: auth,
      ...(shopId ? { shop_id: String(shopId) } : {}),
      ...(accessToken ? { access_token: accessToken } : {}),
      ...query,
    });
    const url = `${BASE}${path}?${qs}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (json.error) {
      if (Array.isArray(json.error) && json.error.length) {
        const err = json.error[0];
        throw new Error(`Shopee API: ${err.message || ''} (${err.error || ''})`);
      }
      if (typeof json.error === 'string' && json.error !== '') {
        throw new Error(`Shopee API: ${json.message || ''} (${json.error})`);
      }
    }
    return json;
  }

  /** Exchange refresh_token for a new access_token (+ refresh_token). */
  async refreshAccessToken({ shopId, refreshToken }) {
    return this._call({
      method: 'POST',
      path: '/api/v2/auth/access_token/get',
      body: { refresh_token: refreshToken, partner_id: Number(this.partnerId), shop_id: Number(shopId) },
      shopId: 0,
      accessToken: '',
    });
  }

  /**
   * Step 1 of the auth flow: build the authorization link (opened directly
   * in the browser — it is the Shopee login/approve page itself).
   * Sign base: partner_id + path + timestamp (public API).
   */
  authPartnerUrl({ redirect }) {
    const path = '/api/v2/shop/auth_partner';
    const ts = Math.floor(Date.now() / 1000);
    const auth = sign(this.partnerId, this.partnerKey, path, ts, '', 0);
    const qs = new URLSearchParams({
      partner_id: String(this.partnerId),
      timestamp: String(ts),
      sign: auth,
      redirect,
    });
    return `${BASE}${path}?${qs}`;
  }

  /**
   * Step 2: exchange the callback code for access_token + refresh_token.
   * Public API — shop_id goes in the body only, not in the base string.
   */
  async getTokenByCode({ code, shopId }) {
    return this._call({
      method: 'POST',
      path: '/api/v2/auth/token/get',
      body: { code, shop_id: Number(shopId), partner_id: Number(this.partnerId) },
      shopId: 0,
      accessToken: '',
    });
  }

  /**
   * List orders. Returns { response: { order_list: [{order_sn, order_status}] } }
   * Default status PROCESSED: arranged for shipment / airway bill printed,
   * between READY_TO_SHIP and SHIPPED.
   */
  async getOrderList({ shopId, accessToken, status = 'PROCESSED', days = 7 }) {
    const from = Math.floor((Date.now() - days * 86400 * 1000) / 1000);
    const to = Math.floor(Date.now() / 1000);
    const res = await this._call({
      method: 'GET',
      path: '/api/v2/order/get_order_list',
      query: {
        time_range_field: 'update_time',
        time_from: String(from),
        time_to: String(to),
        page_size: '100',
        order_status: status,
        response_optional_fields: 'order_status',
      },
      shopId,
      accessToken,
    });
    const list = res.response && res.response.order_list ? res.response.order_list : [];
    return list.map((o) => ({ orderSn: o.order_sn, status: o.order_status }));
  }

  /** Order detail with items. */
  async getOrderDetail({ shopId, accessToken, orderSn }) {
    const res = await this._call({
      method: 'GET',
      path: '/api/v2/order/get_order_detail',
      query: {
        order_sn_list: orderSn,
        response_optional_fields:
          'buyer_user_name,currency,total_amount,pay_time,item_list',
      },
      shopId,
      accessToken,
    });
    const d = res.response && res.response.order_list ? res.response.order_list[0] : null;
    if (!d) return null;
    const items = (d.item_list || []).map((it) => {
      const isVariation = Boolean(it.model_id) && Number(it.model_id) > 0;
      const modelSku = it.model_sku || '';
      const itemSku = it.item_sku || '';
      return {
        // variation items: use the variation SKU (model_sku); fall back to
        // the parent SKU only when the variation has none.
        sku: isVariation ? (modelSku || itemSku) : (itemSku || modelSku),
        name: it.item_name || it.model_name || '',
        variant: isVariation ? (it.model_name || '') : '',
        imageUrl: (it.image_info && it.image_info.image_url) || '',
        qty: Number(it.model_quantity_purchased) || 0,
        originalPrice: Number(it.model_original_price) || 0,
        paidPrice: Number(it.model_discounted_price) || 0,
      };
    });
    return {
      orderSn: d.order_sn || orderSn,
      currency: d.currency || '',
      totalAmount: Number(d.total_amount) || 0,
      buyerName: d.buyer_user_name || '',
      payTime: d.pay_time ? String(d.pay_time) : '',
      items,
    };
  }
}

module.exports = { ShopeeClient, sign };
