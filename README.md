# DEFLEX Shopee → OBM Sync

Automatically sync **Shopee orders** into the **OBM (DEFLEX) POS/accounting
system** by writing them directly into its Firebird database — exactly as the
OBM POS app would, but without the manual typing.

---

## Problem

DEFLEX runs on **OBM**, a Windows POS/accounting package backed by a
**Firebird 2.5** database. Two kinds of sales happen every day:

1. **Shopee online orders** — dozens a day, each with line items (SKU, qty,
   price). These must be entered into OBM as **cash sales**, one order at a
   time, by hand.
2. **Physical (walk-in) customers** — entered at the counter as usual.

Manual entry of Shopee orders is slow, error-prone, and risks double-entry
(typing an order that's already been keyed in). This tool automates the
Shopee side while leaving manual counter sales untouched.

## Solution

A small Node.js service that:

1. **Fetches** Shopee orders that are **Processed** (arranged for shipment,
   airway bill printed) via the Shopee Open Platform v2 API.
2. **Matches** every order line's SKU to the OBM product catalog
   (variation orders use the variation SKU, not the parent SKU).
3. **Writes** each order into OBM as a POS **cash sale** — header, line items,
   GL postings, and stock decrements — mirroring the OBM POS app's own writes.
4. **Stores the Shopee Order ID** in the invoice's *Additional Customer Name*
   field (`SALESINVOICE.GSTADD_NAME`) so it can be traced back.
5. Is **idempotent** — an order already in OBM (manually or by a previous
   sync) is detected and skipped, never double-entered.

The result: Shopee sales flow in automatically, counter sales stay manual, and
the two never collide.

## Architecture

```
┌──────────────┐   HTTP (Tailscale)   ┌───────────────────────────────────┐
│   Tablet     │ ───────────────────▶ │  Sync server  (Node + Express)    │
│  React UI    │                      │  :8082                            │
└──────────────┘                      │                                   │
                                      │  ┌─────────────┐ ┌──────────────┐  │
                                      │  │ Shopee API  │ │ Firebird 2.5 │  │
                                      │  │ client      │ │ writer       │  │
                                      │  └──────┬──────┘ └──────┬───────┘  │
                                      └─────────┼───────────────┼──────────┘
                                                │               │
                                   Shopee Open Platform   OBM Firebird DB
                                   (order list/detail)    (SALESINVOICE, …)
```

### Components

| Path | Role |
|---|---|
| `web/` | **Frontend** — React 19 + TypeScript, built on Meta's [Astryx](https://github.com/meta/astryx) design system. Built bundle in `web/dist/`. |
| `server.js` | **Backend** — Express HTTP server + JSON API + Shopee OAuth callback. |
| `lib/shopee.js` | Shopee Open Platform v2 client (HMAC signing, OAuth, order list/detail). |
| `lib/sync.js` | Orchestration: fetch → SKU match → idempotency check → sync + log. |
| `lib/obm.js` | OBM writer: builds the cash-sale transaction in one Firebird transaction. |
| `lib/db.js` | Firebird connection (configurable via environment variables). |

### What a sync writes (one Firebird transaction per order)

| Table | Content |
|---|---|
| `SALESINVOICE` | header (`TRANSNO` = `YY-CS#####`, customer = shopee 1/2, fully paid, Order ID → `REFERENCE` + `GSTADD_NAME`) |
| `SALESINVOICEITEM` | one row per item (SKU → product, qty, paid price) |
| `AFTSALESINVOICE` | POS mirror row |
| `ACCOUNTTRANSACTIONS` | CR 1020 CASH SALES + DR 6300A CASH AT HAND |
| `PRODUCT` / `STOCKLOCATION` | stock decremented |

### Key design decisions

- **Order status = `PROCESSED`** — after "To process" / before "Shipping"
  (arranged for mass shipment, airway bill + packaging list printed).
- **Variation SKU** — for variation items (`model_id > 0`) the *variation* SKU
  (`model_sku`) is used; the junk parent SKU (`PC`/`SET`/`1PC`) is ignored.
- **Paid price** — the line price recorded is the paid price after voucher
  (`model_discounted_price`, falling back to the original).
- **Idempotency** — an order is skipped if its ID is already in
  `SALESINVOICE.GSTADD_NAME` (the *Additional Customer Name* field) or
  `REFERENCE`. This covers both sync-created and manually-entered orders.
- **Concurrency-safe keys** — the primary key comes from OBM's own generator
  `SALESINVOICE_KEYGEN` (`GEN_ID(..., 1)`), so syncing while the POS app is
  running cannot collide or desynchronize the sequence.
- **Only `shopee 1` (279) and `shopee sales2` (283)** are synced; Shopee 3 and
  Lazada are intentionally excluded.

## Prerequisites

- **Node.js LTS** (18+). Download from <https://nodejs.org>.
- A **Firebird 2.5** database (the OBM database) reachable from the machine
  running the sync — ideally on the same machine (`localhost`).

## Setup (office machine — recommended)

Run the sync **on the same machine as OBM**, so the database is `localhost`
and the site is always-on with the office PC.

```bash
# 1. install Node.js LTS (see above)

# 2. clone
git clone https://github.com/<you>/deflex-shopee-sync.git
cd deflex-shopee-sync

# 3. install backend dependencies
npm install

# 4. create config.json from the template and fill in credentials
copy config.example.json config.json   # Windows
#   (or copy your existing config.json — it holds your Shopee tokens)

# 5. run
start-office.bat
#    or: node server.js
```

Open `http://localhost:8082` (or the machine's Tailscale IP) and sign in.

### Auto-start on boot (Windows Task Scheduler)

So you can just turn the PC on:

1. Open **Task Scheduler** → **Create Basic Task…**.
2. **Trigger** → *When the computer starts*.
3. **Action** → *Start a program* → browse to `start-office.bat`
   (or set Program = `node.exe`, Arguments = `server.js`, Start in = the repo
   folder).
4. Tick *Open the Properties dialog* → set **Run whether user is logged on or
   not** (run with highest privileges if the DB requires it).

The site is then up as soon as the PC boots.

## Configuration

### `config.json` (Shopee credentials — keep secret)

```jsonc
{
  "partnerId": "…",       // Shopee Open Platform partner ID
  "partnerKey": "…",      // partner key
  "daysBack": 7,          // how many days of orders to fetch
  "sellerCenterUrl": "https://seller.shopee.com.my/portal/sale/order/",
  "adminPassword": "…",   // login password for this web app
  "shops": [
    { "name": "shopee 1", "shopId": "", "accessToken": "", "refreshToken": "",
      "customerPkey": 279, "active": true },
    { "name": "shopee sales2", "shopId": "", "accessToken": "", "refreshToken": "",
      "customerPkey": 283, "active": true }
  ]
}
```

The Shopee tokens can also be obtained through the UI: **Settings → Connect to
Shopee** runs the OAuth flow and stores them automatically. Access tokens
expire (~4 h) and are refreshed automatically.

### Database connection (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DB_HOST` | `localhost` | Firebird server host |
| `DB_PORT` | `3050` | Firebird port |
| `DB_DATABASE` | `/firebird/data/DEV_DEFLEX.FDB` | server-local DB path or alias |
| `DB_USER` | `SYSDBA` | Firebird user |
| `DB_PASSWORD` | `masterkey` | Firebird password |

The start scripts set these for you:
- `start-office.bat` — office machine (Firebird on `localhost`).
- `start-prod.sh` / `start-local.sh` — the Linux dev/test machine.

## Daily use

1. In Shopee Seller Center, arrange orders via **Mass Arrange Shipment** so
   they reach **Processed** (airway bill + packaging list printed).
2. Open the app → **Fetch Shopee orders**.
   - If everything is already in OBM you'll see *"Everything is synced and up
     to date"* — nothing to do.
3. Tick the orders to sync (or **Select all ready**) → **Sync N selected**.
4. Each order becomes a `26-CS…` cash sale in OBM with its Shopee Order ID in
   *Additional Customer Name*.
5. To look up an order in Seller Centre, **hover its Order ID and click** to
   copy it, then paste into the Seller Centre search.

## Development

```bash
# backend
npm install

# frontend (only if you edit web/src)
cd web && npm install && npm run build && cd ..
```

The frontend source lives in `web/src` (React + TypeScript + Astryx). The
built bundle in `web/dist/` is committed so a fresh clone runs without
building the frontend.

### Project structure

```
shopee-sync/
├── server.js           # Express backend + API + OAuth callback
├── lib/
│   ├── db.js           # Firebird connection (env-configured)
│   ├── shopee.js       # Shopee API client
│   ├── sync.js         # fetch → match → idempotency → sync
│   └── obm.js          # OBM cash-sale writer
├── web/                # React frontend (source + built dist/)
├── config.example.json # config template (copy to config.json)
├── start-office.bat    # Windows launcher (office machine)
├── start-prod.sh       # Linux launcher → office over Tailscale
└── start-local.sh      # Linux launcher → local test DB
```

## Security notes

- **Never commit `config.json`** — it holds your Shopee partner key and access
  tokens (`.gitignore`d). Distribute it out-of-band.
- The Firebird password is the standard `SYSDBA`/`masterkey` default; change it
  in OBM and update `DB_PASSWORD` if you've hardened it.
- Access the UI over **Tailscale** (or a private network), not the open
  internet.
