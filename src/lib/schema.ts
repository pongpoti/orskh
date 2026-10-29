// Generated copy of db/schema.sql (bundled so no filesystem access is needed at runtime).
// Keep identical to db/schema.sql; tests/unit/schema.test.ts enforces it.
export const SCHEMA_SQL = `-- Idempotent schema, applied lazily once per server instance by lib/db.ts.
-- Keep identical to SCHEMA_SQL in lib/schema.ts (a unit test enforces this).
-- Phone numbers are Thai mobile numbers in the canonical form 0812345678 (lib/phone.ts).

-- One row per code sent by SMS. A row is written (as a reservation that cannot be verified yet) before the SMS goes
-- out and completed once it was accepted. It is deleted again only when sending certainly failed (so such a failure
-- costs nobody a quota); when the SMS may have gone out (a timeout, an unreadable answer) it stays as a reservation
-- that can never be verified but still counts for every limit and the daily cap.
-- Provider mode (deeSMSX) stores the provider's token, encrypted with a key derived from OTP_PEPPER; local mode
-- (development and tests) stores code_hash, an HMAC of the code. ref is the reference shown beside the code.
CREATE TABLE IF NOT EXISTS otp_codes (
  id              bigserial   PRIMARY KEY,
  phone           text        NOT NULL,
  line_sub        text        NOT NULL,
  code_hash       text,
  provider_token  text,
  ref             text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at         timestamptz,
  ip              text
);
CREATE INDEX IF NOT EXISTS otp_codes_phone_sub_idx ON otp_codes (phone, line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_phone_created_idx ON otp_codes (phone, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_sub_created_idx ON otp_codes (line_sub, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_ip_created_idx ON otp_codes (ip, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_created_idx ON otp_codes (created_at);

CREATE TABLE IF NOT EXISTS line_bindings (
  line_sub      text        PRIMARY KEY,
  phone         text        NOT NULL,
  display_name  text,
  verified_at   timestamptz NOT NULL,
  last_login_at timestamptz
);
CREATE INDEX IF NOT EXISTS line_bindings_phone_idx ON line_bindings (phone);

CREATE TABLE IF NOT EXISTS login_events (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  line_sub    text,
  phone       text,
  event       text        NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS login_events_at_idx ON login_events (at DESC);
CREATE INDEX IF NOT EXISTS login_events_phone_idx ON login_events (phone, at DESC);
CREATE INDEX IF NOT EXISTS login_events_sub_idx ON login_events (line_sub, at DESC);

-- Physicians who may sign in (active rows) and their names for the board and the sign-in alert (any row). One row
-- per mobile number: a second number is another row with the same name. Changes apply within 60 s, without a
-- redeploy. Load a roster with scripts/sync-physicians.mjs, or remove someone with
-- UPDATE physicians SET active = false, updated_at = now() WHERE phone = '0812345678'.
CREATE TABLE IF NOT EXISTS physicians (
  phone       text        PRIMARY KEY CHECK (phone ~ '^0[689][0-9]{8}$'),
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  dept        text,                      -- department or subspecialty in Thai, shown in the sign-in alert
  active      boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Access requests from verified numbers that are not on the physician list (decided in Telegram).
-- A number is authorized while it has an approved row; revoke with
-- UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE phone = '0812345678' AND status = 'approved'.
CREATE TABLE IF NOT EXISTS access_requests (
  id           bigserial   PRIMARY KEY,
  phone        text        NOT NULL,
  line_sub     text        NOT NULL,
  line_name    text,
  first_name   text        NOT NULL,
  last_name    text        NOT NULL,
  position     text        NOT NULL CHECK (position IN ('doctor', 'nurse')),
  status       text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  ip           text,
  decided_at   timestamptz,
  decided_by   bigint,
  tg_messages  jsonb       NOT NULL DEFAULT '[]'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_idx ON access_requests (phone) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS access_requests_phone_idx ON access_requests (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_sub_idx ON access_requests (line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_approved_idx ON access_requests (phone) WHERE status = 'approved';
`;
