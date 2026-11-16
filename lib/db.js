'use strict';
/**
 * Firebird connection for the Shopee → OBM sync.
 * Self-contained so the sync repo has no external folder dependencies.
 *
 * Configured via environment variables (set by the start scripts):
 *   DB_HOST       Firebird server host          (default: localhost)
 *   DB_PORT       port                          (default: 3050)
 *   DB_DATABASE   server-local path or alias    (default: docker test copy)
 *   DB_USER       Firebird user                 (default: SYSDBA)
 *   DB_PASSWORD   password                      (default: masterkey)
 */
const Firebird = require('node-firebird');

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3050),
  database: process.env.DB_DATABASE || '/firebird/data/DEV_DEFLEX.FDB',
  user: process.env.DB_USER || 'SYSDBA',
  password: process.env.DB_PASSWORD || 'masterkey',
  blobAsText: true,
};

function attach() {
  return new Promise((resolve, reject) => {
    Firebird.attach(DB, (err, db) => (err ? reject(err) : resolve(db)));
  });
}

function query(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

module.exports = { DB, attach, query };
