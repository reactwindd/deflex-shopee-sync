#!/usr/bin/env bash
# Start the Shopee -> OBM sync server against the LOCAL test database (Docker Firebird).
set -e
cd "$(dirname "$0")"

unset DB_HOST DB_PORT DB_DATABASE DB_USER DB_PASSWORD

exec node server.js
