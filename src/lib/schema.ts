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

-- The list of people who may claim their name: table users, shared with the rest of the project, which created and
-- loaded it in production and owns it. This statement mirrors that table's DDL exactly (tests/unit/schema.test.ts
-- compares it with the text in README "Who may sign in"), so it is a no-op where users exists and identical locally.
-- The sign-in only reads users: it never adds columns to it and never writes it at runtime (only scripts/sync-users.mjs
-- does). Ids stay stable and removals are active = false, never deletes. Claims live in user_claims.
CREATE TABLE IF NOT EXISTS users (
  id          integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name  text        NOT NULL CHECK (btrim(first_name) <> ''),
  last_name   text        NOT NULL CHECK (btrim(last_name) <> ''),
  type        text        NOT NULL CHECK (type IN ('DR','RN','PN','PCA')),
  subtype     text        NOT NULL CHECK (btrim(subtype) <> ''),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_name_key UNIQUE (first_name, last_name)
);

-- Every claim of a name (never deleted) and the Telegram messages that announced it, with their undo button. After
-- the SMS code, someone whose number is not authorized picks their type and name on /login/claim; the first claim of
-- a name wins. A claim is current while undone_at IS NULL: then it authorizes its number if the user is active
-- (lib/authz.ts) and names it on the board and in alerts. The partial unique indexes keep one current claim per user,
-- per number and per LINE account. undo_reason: 'admin' (the Telegram undo button; blocks that number and LINE account
-- from claiming for 24 h), 'inactive' (closed by the app when the same number or LINE account claims again while its
-- name is inactive, e.g. a corrected spelling; no block), 'manual' (released by hand in SQL; no block).
CREATE TABLE IF NOT EXISTS user_claims (
  id           bigserial   PRIMARY KEY,
  user_id      integer     NOT NULL REFERENCES users (id),
  phone        text        NOT NULL CHECK (phone ~ '^0[689][0-9]{8}$'),
  line_sub     text        NOT NULL,          -- LINE account that made the claim
  line_name    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ip           text,
  undone_at    timestamptz,
  undone_by    bigint,                        -- Telegram id of whoever pressed undo (NULL otherwise)
  undo_reason  text        CHECK (undo_reason IN ('admin', 'inactive', 'manual')),
  tg_messages  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CHECK ((undone_at IS NULL) = (undo_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_claims_current_user_key ON user_claims (user_id) WHERE undone_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_claims_current_phone_key ON user_claims (phone) WHERE undone_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_claims_current_line_sub_key ON user_claims (line_sub) WHERE undone_at IS NULL;
CREATE INDEX IF NOT EXISTS user_claims_phone_idx ON user_claims (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS user_claims_sub_idx ON user_claims (line_sub, created_at DESC);
CREATE INDEX IF NOT EXISTS user_claims_user_idx ON user_claims (user_id, created_at DESC);

-- Access requests from verified numbers that hold no claimed name (decided in Telegram). position is a user type.
-- A number is authorized while it has an approved row; revoke with
-- UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE phone = '0812345678' AND status = 'approved'.
CREATE TABLE IF NOT EXISTS access_requests (
  id           bigserial   PRIMARY KEY,
  phone        text        NOT NULL,
  line_sub     text        NOT NULL,
  line_name    text,
  first_name   text        NOT NULL,
  last_name    text        NOT NULL,
  position     text        NOT NULL CHECK (position IN ('DR', 'RN', 'PN', 'PCA')),
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

-- Databases made before positions became user types (doctor/nurse): move them over once.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'access_requests'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%doctor%'
  ) THEN
    ALTER TABLE access_requests DROP CONSTRAINT access_requests_position_check;
    UPDATE access_requests SET position = CASE position WHEN 'doctor' THEN 'DR' ELSE 'RN' END
    WHERE position IN ('doctor', 'nurse');
    ALTER TABLE access_requests ADD CONSTRAINT access_requests_position_check CHECK (position IN ('DR', 'RN', 'PN', 'PCA'));
  END IF;
END $$;
`;
