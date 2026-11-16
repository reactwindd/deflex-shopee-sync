@echo off
rem Start the Shopee -> OBM sync server on the OFFICE machine.
rem The Firebird database is local, so no Tailscale hop is needed.
cd /d "%~dp0"

set DB_HOST=localhost
set DB_PORT=3050
set "DB_DATABASE=C:\OBMProf\Data\DEFLEX MARKETING.FDB"
set DB_USER=SYSDBA
set DB_PASSWORD=masterkey

node server.js
