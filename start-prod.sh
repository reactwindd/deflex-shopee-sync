#!/usr/bin/env bash
# Start the Shopee -> OBM sync server against the PRODUCTION database
# (office Firebird 2.5, reached over Tailscale at 100.106.121.26).
set -e
cd "$(dirname "$0")"

export DB_HOST=100.106.121.26
export DB_PORT=3050
export DB_DATABASE='C:\OBMProf\Data\DEFLEX MARKETING.FDB'
export DB_USER=SYSDBA
export DB_PASSWORD=masterkey

exec node server.js
