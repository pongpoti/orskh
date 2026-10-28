-- Idempotent schema, applied lazily once per server instance by lib/db.ts.
-- Keep identical to SCHEMA_SQL in lib/schema.ts (a unit test enforces this).

CREATE TABLE IF NOT EXISTS otp_codes (
  id          bigserial   PRIMARY KEY,
  email       text        NOT NULL,
  line_sub    text        NOT NULL,
  code_hash   text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at     timestamptz,
  ip          text
);
CREATE INDEX IF NOT EXISTS otp_codes_email_sub_idx ON otp_codes (email, line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_codes_email_created_idx ON otp_codes (email, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_sub_created_idx ON otp_codes (line_sub, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_ip_created_idx ON otp_codes (ip, created_at);
CREATE INDEX IF NOT EXISTS otp_codes_created_idx ON otp_codes (created_at);

CREATE TABLE IF NOT EXISTS line_bindings (
  line_sub      text        PRIMARY KEY,
  email         text        NOT NULL,
  display_name  text,
  verified_at   timestamptz NOT NULL,
  last_login_at timestamptz
);
CREATE INDEX IF NOT EXISTS line_bindings_email_idx ON line_bindings (email);

CREATE TABLE IF NOT EXISTS login_events (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  line_sub    text,
  email       text,
  event       text        NOT NULL,
  ip          text,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS login_events_at_idx ON login_events (at DESC);
CREATE INDEX IF NOT EXISTS login_events_email_idx ON login_events (email, at DESC);
CREATE INDEX IF NOT EXISTS login_events_sub_idx ON login_events (line_sub, at DESC);

-- Physicians who may sign in (active rows) and their names for the sign-in alert (any row). One row per email:
-- alternate addresses are extra rows with the same name. Changes apply within 60 s, without a redeploy. Load a
-- roster with scripts/sync-physicians.mjs, or remove someone with
-- UPDATE physicians SET active = false, updated_at = now() WHERE email = lower('...').
CREATE TABLE IF NOT EXISTS physicians (
  email       text        PRIMARY KEY CHECK (email = lower(email) AND email = btrim(email) AND email <> ''),
  name        text        NOT NULL CHECK (btrim(name) <> ''),
  dept        text,                      -- department or subspecialty in Thai, shown in the sign-in alert
  active      boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Access requests from verified emails that are not on the physician list (decided in Telegram).
-- An email is authorized while it has an approved row; revoke with
-- UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE email = lower('...') AND status = 'approved'.
CREATE TABLE IF NOT EXISTS access_requests (
  id           bigserial   PRIMARY KEY,
  email        text        NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS access_requests_one_pending_idx ON access_requests (email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS access_requests_email_idx ON access_requests (email, created_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_sub_idx ON access_requests (line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS access_requests_approved_idx ON access_requests (email) WHERE status = 'approved';
