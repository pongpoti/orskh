/**
 * The DDL of the production table `users`, exactly as the workstream that owns it created it in Neon (agreed with its
 * owner: ids stay stable, removals are active = false, the sign-in never adds columns or writes the table at runtime).
 * db/schema.sql must mirror it (tests/unit/schema.test.ts), and README "Who may sign in" quotes it.
 */
export const PRODUCTION_USERS_DDL =
  "CREATE TABLE users (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, first_name text NOT NULL CHECK (btrim(first_name) <> ''), last_name text NOT NULL CHECK (btrim(last_name) <> ''), type text NOT NULL CHECK (type IN ('DR','RN','PN','PCA')), subtype text NOT NULL CHECK (btrim(subtype) <> ''), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT users_name_key UNIQUE (first_name, last_name));";

/** Whitespace-insensitive form for comparing DDL texts: runs of white space are one space, none next to ( ) , ; */
export function normalizeDdl(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/\s*([(),;])\s*/g, "$1")
    .trim();
}
