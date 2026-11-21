/* Nepal Accounts (Accounting + Inventory) — schema.
 *
 * Ported from the NepalAccounts demo (SQLite, 23 incremental migrations) as ONE consolidated,
 * additive migration: every table is `acc_`-prefixed (eHajiri already owns `fiscal_years`, `users`,
 * `items`…), `CREATE TABLE IF NOT EXISTS` throughout, nothing existing is altered or dropped.
 *
 * Creating these tables is harmless on a tenant that never enables the module — they stay empty.
 * Seed data (NFRS chart of accounts, units, fiscal year, company row, default quotation template)
 * is NOT inserted here: it is created lazily, once, the first time an enabled tenant opens the
 * module (see server/services/accounts/seed.js).
 *
 * Conventions kept from the demo so the ported SQL stays close to the original:
 *   - on/off flags are INTEGER 0/1 (not BOOLEAN)
 *   - dates are DATE (server/db.js already returns DATE as a plain 'YYYY-MM-DD' string)
 *   - money is NUMERIC(14,2) (the accounts layer parses NUMERIC to JS numbers)
 *   - "username" columns hold the eHajiri users.username of whoever acted
 */
export const ACCOUNTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS acc_company (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  name            TEXT NOT NULL DEFAULT 'My Company Pvt. Ltd.',
  name_np         TEXT,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  pan             TEXT,
  vat_registered  INTEGER NOT NULL DEFAULT 1,
  vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 13,
  date_display    TEXT NOT NULL DEFAULT 'BS',
  smtp_host       TEXT,
  smtp_port       INTEGER NOT NULL DEFAULT 587,
  smtp_user       TEXT,
  smtp_password   TEXT,
  smtp_from       TEXT,
  smtp_tls        INTEGER NOT NULL DEFAULT 1,
  wa_gateway_url  TEXT,
  wa_method       TEXT NOT NULL DEFAULT 'GET',
  auto_email_si   INTEGER NOT NULL DEFAULT 0,
  auto_email_pb   INTEGER NOT NULL DEFAULT 0,
  auto_wa_si      INTEGER NOT NULL DEFAULT 0,
  auto_wa_pb      INTEGER NOT NULL DEFAULT 0,
  alert_days      INTEGER NOT NULL DEFAULT 7,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS acc_fiscal_years (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,            -- 2083/84
  start_date  DATE NOT NULL,                   -- 1 Shrawan
  end_date    DATE NOT NULL,                   -- last day of Ashadh
  is_closed   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS acc_groups (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_np           TEXT,
  nature            TEXT NOT NULL CHECK (nature IN ('A','L','E','I','X')),
  parent_id         INTEGER REFERENCES acc_groups(id),
  is_system         INTEGER NOT NULL DEFAULT 0,
  sort              INTEGER NOT NULL DEFAULT 0,
  bank_account_name TEXT,
  bank_account_no   TEXT,
  bank_branch       TEXT,
  address           TEXT,
  phone             TEXT,
  contact_person    TEXT,
  contact_mobile    TEXT,
  qr_image          TEXT,
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ
);

-- Ledgers (the demo's "accounts"). kind: general | cash | bank | party | tax
CREATE TABLE IF NOT EXISTS acc_ledgers (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_np           TEXT,
  group_id          INTEGER NOT NULL REFERENCES acc_groups(id),
  kind              TEXT NOT NULL DEFAULT 'general',
  system_key        TEXT UNIQUE,
  opening_balance   NUMERIC(14,2) NOT NULL DEFAULT 0,      -- + Dr / - Cr
  pan               TEXT,
  phone             TEXT,
  address           TEXT,
  active            INTEGER NOT NULL DEFAULT 1,
  party_type        TEXT,                                  -- customer | supplier
  email             TEXT,
  contact_person    TEXT,
  credit_limit      NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit_days       INTEGER NOT NULL DEFAULT 0,
  price_level       TEXT NOT NULL DEFAULT 'mrp',           -- mrp | dealer | partner
  whatsapp          TEXT,
  office_phone      TEXT,
  bank_account_no   TEXT,
  bank_branch       TEXT,
  contact_mobile    TEXT,
  qr_image          TEXT,
  bank_account_name TEXT,
  bank_group_id     INTEGER REFERENCES acc_groups(id),
  transport_name    TEXT,
  transport_phone   TEXT,
  transport_address TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_acc_ledgers_group ON acc_ledgers(group_id);

CREATE TABLE IF NOT EXISTS acc_party_contacts (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES acc_ledgers(id),
  name        TEXT NOT NULL,
  post        TEXT,
  dept        TEXT,
  mobile1     TEXT,
  mobile2     TEXT,
  email       TEXT,
  remarks     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_acc_contacts_account ON acc_party_contacts(account_id);

-- JV Journal, PV Payment, RV Receipt, CV Contra (manual) + PB/PR/SI/SR (auto-posted from bills).
-- Never deleted by users: cancelled with a reason, the number stays used.
CREATE TABLE IF NOT EXISTS acc_vouchers (
  id             SERIAL PRIMARY KEY,
  fy_id          INTEGER NOT NULL REFERENCES acc_fiscal_years(id),
  vtype          TEXT NOT NULL CHECK (vtype IN ('JV','PV','RV','CV','PB','PR','SI','SR')),
  seq            INTEGER NOT NULL,
  voucher_no     TEXT NOT NULL UNIQUE,
  vdate          DATE NOT NULL,
  narration      TEXT,
  reference      TEXT,
  amount         NUMERIC(14,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','cancelled')),
  cancel_reason  TEXT,
  created_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by   TEXT,
  cancelled_at   TIMESTAMPTZ,
  source_doc_id  INTEGER,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ,
  edit_count     INTEGER NOT NULL DEFAULT 0,
  kind           TEXT,
  UNIQUE (fy_id, vtype, seq)
);
CREATE INDEX IF NOT EXISTS ix_acc_v_date ON acc_vouchers(vdate);

CREATE TABLE IF NOT EXISTS acc_voucher_lines (
  id          SERIAL PRIMARY KEY,
  voucher_id  INTEGER NOT NULL REFERENCES acc_vouchers(id),
  account_id  INTEGER NOT NULL REFERENCES acc_ledgers(id),
  dr          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cr          NUMERIC(14,2) NOT NULL DEFAULT 0,
  note        TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_acc_vl_account ON acc_voucher_lines(account_id);
CREATE INDEX IF NOT EXISTS ix_acc_vl_voucher ON acc_voucher_lines(voucher_id);

CREATE TABLE IF NOT EXISTS acc_audit_log (
  id          SERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username    TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  detail      TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS ix_acc_audit_at ON acc_audit_log(at);

CREATE TABLE IF NOT EXISTS acc_units (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

-- category (parent_id NULL) and sub-category (parent_id = category)
CREATE TABLE IF NOT EXISTS acc_item_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES acc_item_categories(id)
);

CREATE TABLE IF NOT EXISTS acc_items (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  name_np          TEXT,
  category_id      INTEGER REFERENCES acc_item_categories(id),
  unit_id          INTEGER NOT NULL REFERENCES acc_units(id),
  barcode          TEXT,
  hs_code          TEXT,
  vat_applicable   INTEGER NOT NULL DEFAULT 1,            -- 0 = VAT exempt
  purchase_price   NUMERIC(14,2) NOT NULL DEFAULT 0,
  mrp              NUMERIC(14,2) NOT NULL DEFAULT 0,
  dealer_price     NUMERIC(14,2) NOT NULL DEFAULT 0,
  partner_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  reorder_level    NUMERIC(14,3) NOT NULL DEFAULT 0,
  opening_qty      NUMERIC(14,3) NOT NULL DEFAULT 0,
  opening_rate     NUMERIC(14,2) NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  item_type        TEXT NOT NULL DEFAULT 'goods',
  service_months   INTEGER NOT NULL DEFAULT 0,
  warranty_months  INTEGER NOT NULL DEFAULT 0,
  track_serial     INTEGER NOT NULL DEFAULT 0,
  dealer_pct       NUMERIC(6,2) NOT NULL DEFAULT 0,
  partner_pct      NUMERIC(6,2) NOT NULL DEFAULT 0,
  image_file       TEXT,
  website          TEXT,
  features         TEXT,
  specs            TEXT,                                  -- JSON [[name, value], ...]
  vat_type         TEXT NOT NULL DEFAULT 'inclusive',
  rate_updated_at  TIMESTAMPTZ,
  rate_updated_by  TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ
);

-- QT Quotation, PO Purchase Order, PB Purchase, PR Purchase Return (debit note),
-- SO Sales Order, SI Sales Invoice, SR Sales Return (credit note)
CREATE TABLE IF NOT EXISTS acc_docs (
  id                  SERIAL PRIMARY KEY,
  fy_id               INTEGER NOT NULL REFERENCES acc_fiscal_years(id),
  doc_type            TEXT NOT NULL CHECK (doc_type IN ('QT','PO','PB','PR','SO','SI','SR')),
  seq                 INTEGER NOT NULL,
  doc_no              TEXT NOT NULL UNIQUE,
  doc_date            DATE NOT NULL,
  party_id            INTEGER REFERENCES acc_ledgers(id),
  party_name          TEXT,
  party_pan           TEXT,
  party_address       TEXT,
  payment_mode        TEXT NOT NULL DEFAULT 'credit',     -- credit | cash | cheque | bank
  cash_account_id     INTEGER REFERENCES acc_ledgers(id),
  ref_doc_id          INTEGER REFERENCES acc_docs(id),
  supplier_bill_no    TEXT,
  supplier_bill_date  DATE,
  vat_bill            INTEGER NOT NULL DEFAULT 1,
  price_level         TEXT,
  gross               NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable             NUMERIC(14,2) NOT NULL DEFAULT 0,
  exempt              NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  total               NUMERIC(14,2) NOT NULL DEFAULT 0,
  narration           TEXT,
  status              TEXT NOT NULL,                      -- posted | cancelled | open | billed
  voucher_id          INTEGER REFERENCES acc_vouchers(id),
  print_count         INTEGER NOT NULL DEFAULT 0,
  cancel_reason       TEXT,
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by        TEXT,
  cancelled_at        TIMESTAMPTZ,
  due_date            DATE,
  cheque_details      TEXT,
  updated_by          TEXT,
  updated_at          TIMESTAMPTZ,
  edit_count          INTEGER NOT NULL DEFAULT 0,
  cheque_no           TEXT,
  cheque_date         DATE,
  cheque_bank         TEXT,
  txn_id              TEXT,
  pay_proof           TEXT,
  followup_user       TEXT,
  followup_date       DATE,
  followup_note       TEXT,
  challan_no          TEXT,
  vat_bill_no         TEXT,
  pay_voucher_id      INTEGER,
  paid_amount         NUMERIC(14,2),
  transport_name      TEXT,
  transport_bill_no   TEXT,
  transport_file      TEXT,
  transport_by        TEXT,
  transport_at        TIMESTAMPTZ,
  qt_subject          TEXT,
  qt_attn             TEXT,
  qt_validity         TEXT,
  qt_template_id      INTEGER,
  qt_terms            TEXT,                               -- JSON [[term, details], ...]
  qt_notes            TEXT,
  qt_client_logo      TEXT,
  UNIQUE (fy_id, doc_type, seq)
);
CREATE INDEX IF NOT EXISTS ix_acc_doc_type_date ON acc_docs(doc_type, doc_date);
CREATE INDEX IF NOT EXISTS ix_acc_doc_party ON acc_docs(party_id);

CREATE TABLE IF NOT EXISTS acc_doc_lines (
  id               SERIAL PRIMARY KEY,
  doc_id           INTEGER NOT NULL REFERENCES acc_docs(id),
  item_id          INTEGER NOT NULL REFERENCES acc_items(id),
  qty              NUMERIC(14,3) NOT NULL,
  rate             NUMERIC(14,2) NOT NULL,
  discount_pct     NUMERIC(6,2) NOT NULL DEFAULT 0,
  discount         NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount           NUMERIC(14,2) NOT NULL,                -- after discount, before VAT
  vat_applicable   INTEGER NOT NULL,
  vat              NUMERIC(14,2) NOT NULL DEFAULT 0,
  note             TEXT,
  sort             INTEGER NOT NULL DEFAULT 0,
  service_from     DATE,
  service_to       DATE,
  warranty_months  INTEGER NOT NULL DEFAULT 0,
  vat_inclusive    INTEGER NOT NULL DEFAULT 0,
  rate_excl        NUMERIC(14,4)
);
CREATE INDEX IF NOT EXISTS ix_acc_line_doc ON acc_doc_lines(doc_id);

-- Stock movements. fixed_rate=1: valued at \`rate\` (opening, purchase, purchase return);
-- fixed_rate=0: valued at the running weighted average (sale, sales return).
CREATE TABLE IF NOT EXISTS acc_stock_moves (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES acc_items(id),
  doc_id      INTEGER REFERENCES acc_docs(id),
  move_date   DATE NOT NULL,
  kind        TEXT NOT NULL,        -- opening | purchase | purchase_return | sale | sales_return
  qty_in      NUMERIC(14,3) NOT NULL DEFAULT 0,
  qty_out     NUMERIC(14,3) NOT NULL DEFAULT 0,
  rate        NUMERIC(14,4) NOT NULL DEFAULT 0,
  fixed_rate  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_acc_move_item ON acc_stock_moves(item_id, move_date);

CREATE TABLE IF NOT EXISTS acc_serials (
  id              SERIAL PRIMARY KEY,
  item_id         INTEGER NOT NULL REFERENCES acc_items(id),
  serial_no       TEXT NOT NULL,
  status          TEXT NOT NULL,        -- in_stock | sold | returned | cancelled
  in_doc_id       INTEGER REFERENCES acc_docs(id),
  out_doc_id      INTEGER REFERENCES acc_docs(id),
  warranty_until  DATE,
  UNIQUE (item_id, serial_no)
);

CREATE TABLE IF NOT EXISTS acc_line_serials (
  line_id    INTEGER NOT NULL REFERENCES acc_doc_lines(id),
  serial_id  INTEGER NOT NULL REFERENCES acc_serials(id),
  PRIMARY KEY (line_id, serial_id)
);

CREATE TABLE IF NOT EXISTS acc_notifications (
  id          SERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  channel     TEXT NOT NULL,            -- email | whatsapp
  doc_id      INTEGER REFERENCES acc_docs(id),
  party_id    INTEGER REFERENCES acc_ledgers(id),
  recipient   TEXT,
  subject     TEXT,
  status      TEXT NOT NULL,            -- sent | failed | skipped
  error       TEXT,
  created_by  TEXT
);

CREATE TABLE IF NOT EXISTS acc_approvals (
  id            SERIAL PRIMARY KEY,
  entity        TEXT NOT NULL,          -- doc | voucher
  entity_id     INTEGER NOT NULL,
  entity_no     TEXT,
  action        TEXT NOT NULL DEFAULT 'delete',
  reason        TEXT,
  requested_by  TEXT NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS acc_reminders (
  id           SERIAL PRIMARY KEY,
  doc_id       INTEGER REFERENCES acc_docs(id),
  kind         TEXT NOT NULL,           -- cheque | followup
  remind_on    DATE NOT NULL,
  title        TEXT NOT NULL,
  assigned_to  TEXT,
  status       TEXT NOT NULL DEFAULT 'open',      -- open | done
  done_by      TEXT,
  done_at      TIMESTAMPTZ,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  priority     TEXT NOT NULL DEFAULT 'normal',    -- low | normal | high | urgent
  note         TEXT
);
CREATE INDEX IF NOT EXISTS ix_acc_reminders_open ON acc_reminders(status, remind_on);

CREATE TABLE IF NOT EXISTS acc_cheques (
  id               SERIAL PRIMARY KEY,
  doc_id           INTEGER REFERENCES acc_docs(id),
  party_id         INTEGER REFERENCES acc_ledgers(id),
  direction        TEXT NOT NULL CHECK (direction IN ('received','issued')),
  cheque_no        TEXT NOT NULL,
  cheque_bank      TEXT,
  cheque_date      DATE NOT NULL,
  amount           NUMERIC(14,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','bounced','cancelled')),
  bank_account_id  INTEGER REFERENCES acc_ledgers(id),
  cleared_date     DATE,
  voucher_id       INTEGER REFERENCES acc_vouchers(id),
  note             TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       TEXT,
  updated_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_acc_cheques_party ON acc_cheques(party_id);
CREATE INDEX IF NOT EXISTS ix_acc_cheques_doc ON acc_cheques(doc_id);

CREATE TABLE IF NOT EXISTS acc_quote_templates (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  is_default      INTEGER NOT NULL DEFAULT 0,
  color1          TEXT NOT NULL DEFAULT '#2E7D32',
  color2          TEXT NOT NULL DEFAULT '#6CBE45',
  color3          TEXT NOT NULL DEFAULT '#0B6FB8',
  logo_file       TEXT,
  cover_file      TEXT,
  sign_file       TEXT,
  stamp_file      TEXT,
  profile_files   TEXT,                 -- JSON [{"file":..,"pages":"2-5","label":..}, ...]
  website         TEXT,
  phones          TEXT,
  address         TEXT,
  prepared_name   TEXT,
  prepared_post   TEXT,
  prepared_phone  TEXT,
  prepared_email  TEXT,
  validity        TEXT,
  terms           TEXT,                 -- JSON [[term, details], ...]
  notes           TEXT,
  paper           TEXT NOT NULL DEFAULT 'A4',
  created_by      TEXT,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ
);
ALTER TABLE acc_quote_templates ADD COLUMN IF NOT EXISTS brand_zk_file  TEXT;
ALTER TABLE acc_quote_templates ADD COLUMN IF NOT EXISTS brand_yoi_file TEXT;

-- Uploaded files (product photos, bank QR, quotation logos/covers/profile PDFs, payment proofs,
-- transport bills). Kept in the tenant's own DB — not on disk — because every tenant runs from the
-- same code directory, so a shared uploads folder would mix tenants; this also puts them inside
-- the normal database backup.
CREATE TABLE IF NOT EXISTS acc_files (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, name)
);
`;
