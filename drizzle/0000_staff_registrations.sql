CREATE TABLE IF NOT EXISTS staff_registrations (
  line_user_id text PRIMARY KEY,
  line_display_name text,
  job text NOT NULL,
  physician_id text,
  physician_name text,
  specialty text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_registrations_job_check CHECK (job IN ('physician', 'nurse'))
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_registrations_physician_id_key
  ON staff_registrations (physician_id);
