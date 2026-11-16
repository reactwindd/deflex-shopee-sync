'use strict';
/**
 * OBM POS cash-sale writer (Firebird).
 * Replicates exactly what the OBM POS app writes for a "Cash Sales" transaction:
 *   SALESINVOICE + SALESINVOICEITEM + AFTSALESINVOICE mirror
 *   + 2 ACCOUNTTRANSACTIONS rows (CR 1020 CASH SALES / DR 6300A CASH AT HAND)
 *   + PRODUCT.QTYINSTOCK & STOCKLOCATION.QTY decrement
 * Idempotent per Shopee Order ID via SALESINVOICE.REFERENCE.
 */
const Firebird = require('node-firebird');
const { DB } = require('./db');

const ACCT_CASH_SALES = 4;   // 1020 CASH SALES (credit)
const ACCT_CASH_HAND = 115;  // 6300A CASH AT HAND (debit)

function attach() {
  return new Promise((resolve, reject) => {
    Firebird.attach(DB, (err, db) => (err ? reject(err) : resolve(db)));
  });
}

function txQuery(tr, sql, params = []) {
  return new Promise((resolve, reject) => {
    tr.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function pad5(n) {
  return String(n).padStart(5, '0');
}

/** Next YY-CS##### number, e.g. 26-CS05517.
 *  Note: TRANSNO is NOT unique-constrained and is cosmetic; OBM derives it in
 *  lockstep with PKEY. We keep MAX+1 here (the tiny race window on a
 *  non-unique column is acceptable and cannot fail an insert). */
async function nextTransNo(tr) {
  const yy = String(new Date().getFullYear()).slice(2);
  const rows = await txQuery(
    tr,
    `SELECT MAX(TRANSNO) AS M FROM SALESINVOICE WHERE TRANSNO LIKE ?`,
    [`${yy}-CS%`]
  );
  const last = String(rows[0].M || '');
  const m = last.match(/(\d+)\s*$/);
  const n = (m ? parseInt(m[1], 10) : 0) + 1;
  return `${yy}-CS${pad5(n)}`;
}

function nowStamp() {
  const d = new Date();
  const p = (x, n = 2) => String(x).padStart(n, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return { date, txTime: `1899-12-30 ${time}`, full: `${date} ${time}` };
}

/**
 * Create one POS cash sale. Returns { created: boolean, transNo, pkey }.
 * @param {object} opts
 * @param {{pkey:number, name:string}} opts.customer
 * @param {Array<{pkey:number, qty:number, unitPrice:number}>} opts.items
 * @param {string} opts.orderId  Shopee Order ID → SALESINVOICE.REFERENCE
 * @param {string} [opts.txDate] 'YYYY-MM-DD' (default: today)
 */
async function createCashSale(db, opts) {
  const { customer, items, orderId } = opts;
  if (!customer || !customer.pkey) throw new Error('Missing customer');
  if (!Array.isArray(items) || !items.length) throw new Error('No items');
  if (!orderId) throw new Error('Missing orderId');

  const ts = nowStamp();
  const txDate = opts.txDate || ts.date;
  const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);

  // ---- product data (names, units) --------------------------------------
  const pkeys = [...new Set(items.map((i) => i.pkey))];
  const prodRows = await new Promise((resolve, reject) => {
    db.query(
      `SELECT PKEY, PRODUCTID, PRODUCTNAME, UNITOFMEASURE FROM PRODUCT WHERE PKEY IN (${pkeys.map(() => '?').join(',')})`,
      pkeys,
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
  const prods = new Map(prodRows.map((r) => [r.PKEY, r]));

  // ---- run inside one transaction ---------------------------------------
  return new Promise((resolve, reject) => {
    db.transaction(Firebird.ISOLATION_READ_COMMITTED, async (err, tr) => {
      if (err) return reject(err);
      try {
        // idempotency: this Order ID already recorded?
        // (checks both the sync tool's REFERENCE and the manual-entry field
        //  GSTADD_NAME — OBM's "Additional Customer Name")
        const existing = await txQuery(tr, `SELECT PKEY FROM SALESINVOICE WHERE REFERENCE = ? OR GSTADD_NAME = ?`, [orderId, orderId]);
        if (existing.length) {
          await new Promise((res, rej) => tr.rollback((e) => (e ? rej(e) : res())));
          return resolve({ created: false, reason: 'already-synced', pkey: existing[0].PKEY });
        }

        // new pkey — use OBM's own generator (atomic + matches the POS app).
        // MAX(PKEY)+1 would race against a concurrent POS sale AND desynchronize
        // SALESINVOICE_KEYGEN (the POS relies on it staying ahead of MAX(PKEY)).
        const genRow = await txQuery(tr, `SELECT GEN_ID(SALESINVOICE_KEYGEN, 1) AS PKEY FROM RDB$DATABASE`);
        const pkey = Number(genRow[0].PKEY);
        const transNo = await nextTransNo(tr);

        // 1) header — Order ID goes to GSTADD_NAME ("Additional Customer Name"
        //    in the OBM POS dialog) AND REFERENCE for searchability.
        await txQuery(
          tr,
          `INSERT INTO SALESINVOICE
             (PKEY, PURKEY, TXDATE, TXTIME, TRANSNO, CUSTOMER, CUSTOMERNAME,
              TOTALAMT, AMTPAID, INVOICETYPE, ISINVOICE, STATUS, GSTTYPE,
              BATCHNO, COUNTER, SHIFT, REFERENCE, GSTADD_NAME, DTCREATED, DTLASTMODIFIED)
           VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, 'I', 'N', 'N', 'S', 0, 0, 0, ?, ?, ?, ?)`,
          [
            pkey,
            txDate, ts.txTime, transNo, customer.pkey, customer.name,
            total, total,
            orderId, orderId,
            ts.full, ts.full,
          ]
        );

        // 2) items
        let itemNo = 0;
        for (const it of items) {
          itemNo += 1;
          const prod = prods.get(it.pkey);
          const name = prod ? String(prod.PRODUCTNAME || '').trim() : '';
          const unit = prod ? Number(prod.UNITOFMEASURE) || 21 : 21;
          const cost = Math.round(it.qty * it.unitPrice * 100) / 100;
          await txQuery(
            tr,
            `INSERT INTO SALESINVOICEITEM
               (FORKEY, PURKEY, ITEMNO, LINE, STOCK, UNIT, QTY, UNITPRICE,
                PERCENT, TAX, COST, ACCT, TXDATE, DESCRIPTION, RATE, LOCATION)
             VALUES (?, 0, ?, '', ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, 0, 'STORE')`,
            [pkey, itemNo, it.pkey, unit, it.qty, it.unitPrice, cost, txDate, name]
          );
        }

        // 3) AFT mirror (POS sync bookkeeping)
        await txQuery(
          tr,
          `INSERT INTO AFTSALESINVOICE (PKEY, TRANSMITTED, OLDCODE, DELETED, UNDELETED, DATECHANGED)
           VALUES (?, 'F', '', 'F', 'F', ?)`,
          [pkey, ts.full]
        );

        // 4) GL postings
        for (const [acct, drcr] of [[ACCT_CASH_SALES, 'C'], [ACCT_CASH_HAND, 'D']]) {
          await txQuery(
            tr,
            `INSERT INTO ACCOUNTTRANSACTIONS
               (ACCOUNT, SOURCETRANSACTION, SOURCETRANSACTIONTYPE, TXDATE, LINE,
                AMOUNT, DRCR, CATEGORY, RECONC, COSTCENTRE, DESCRIPTION,
                DEBTOR, CREDITOR, REFERENCE, COUNTER, TAXCODE)
             VALUES (?, ?, 7, ?, 1, ?, ?, '', 0, 0, ?, ?, 0, ?, 0, 0)`,
            [acct, pkey, txDate, total, drcr, customer.name, customer.pkey, orderId]
          );
        }

        // 5) stock decrement
        for (const it of items) {
          await txQuery(tr, `UPDATE PRODUCT SET QTYINSTOCK = QTYINSTOCK - ? WHERE PKEY = ?`, [it.qty, it.pkey]);
          await txQuery(tr, `UPDATE STOCKLOCATION SET QTY = QTY - ? WHERE STOCK = ? AND LOCATION = 'STORE'`, [it.qty, it.pkey]);
        }

        await new Promise((res, rej) => tr.commit((e) => (e ? rej(e) : res())));
        resolve({ created: true, pkey, transNo, total });
      } catch (e) {
        await new Promise((res) => tr.rollback(() => res()));
        reject(e);
      }
    });
  });
}

module.exports = { attach, createCashSale, ACCT_CASH_SALES, ACCT_CASH_HAND };
