// Roster CSV -> rows of the table physicians, and what applying it would change. Pure (no files, no database), so
// tests/unit/sync-physicians.test.ts imports it; scripts/sync-physicians.mjs does the reading and writing.

/** @typedef {{ line: number, email: string, name: string, dept: string | null }} RosterEntry */
/** @typedef {{ email: string, name: string, dept: string | null, active: boolean }} PhysicianRow */
/**
 * @typedef {{
 *   added: RosterEntry[],
 *   changed: (RosterEntry & { before: PhysicianRow })[],
 *   reactivated: (RosterEntry & { before: PhysicianRow })[],
 *   deactivated: PhysicianRow[],
 *   unchanged: number,
 * }} RosterDiff
 */

// Same pattern as EMAIL_RE in lib/email.ts (a unit test keeps the two identical).
export const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Longest name or department accepted (a longer cell is a shifted column, not a name). */
export const TEXT_MAX = 200;

// Refused in names and departments (after cleanText): control characters, and the bidirectional controls that flat()
// in lib/telegram.ts removes from alerts (they could make the diff printed for review read differently).
const CONTROL_RE = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/**
 * --apply refuses to deactivate more than MASS_MIN rows when that is also more than MASS_SHARE of the active rows,
 * unless --allow-mass-deactivate: such a CSV is more likely partial (one department's sheet) than a real change.
 */
export const MASS_MIN = 5;
export const MASS_SHARE = 0.1;

/**
 * NFKC + trim + lowercase, as normalizeEmail() in lib/email.ts. Returns null when not a plausible address.
 * @param {string} input
 * @returns {string | null}
 */
export function normalizeEmail(input) {
  if (typeof input !== "string" || input.length > 320) return null;
  const v = input.normalize("NFKC").trim().toLowerCase();
  if (v.length < 3 || v.length > 254 || !EMAIL_RE.test(v)) return null;
  return v;
}

/**
 * Names and departments: NFC (never NFKC, which splits the Thai vowel sara am), single spaces, trimmed.
 * @param {string} v
 */
function cleanText(v) {
  return v.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * Splits CSV text into records with the line each one starts on: RFC 4180 ("quoted" fields, "" for a quote inside
 * one), CRLF or LF line ends, an optional UTF-8 BOM (Excel's "CSV UTF-8" writes one). Throws on an unclosed quote.
 * @param {string} text
 * @returns {{ line: number, fields: string[] }[]}
 */
export function parseCsv(text) {
  const records = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === "\n") line++;
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      fields.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      records.push({ line: start, fields });
      fields = [];
      field = "";
      start = ++line;
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error(`line ${start}: a quoted field is never closed`);
  if (field !== "" || fields.length) {
    fields.push(field);
    records.push({ line: start, fields });
  }
  return records;
}

/**
 * Roster CSV (header email,name,dept; one row per email, alternate addresses as extra rows with the same name)
 * -> entries, or every problem found, each with its line number. Blank lines are skipped; an empty dept is null.
 * @param {string} text
 * @returns {{ entries: RosterEntry[], errors: string[] }}
 */
export function parseRoster(text) {
  let records;
  try {
    records = parseCsv(text);
  } catch (e) {
    return { entries: [], errors: [/** @type {Error} */ (e).message] };
  }
  const rows = records.filter((r) => r.fields.some((f) => f.trim() !== ""));
  const header = rows.shift();
  if (!header || header.fields.map((f) => f.trim().toLowerCase()).join(",") !== "email,name,dept") {
    return { entries: [], errors: [`line ${header?.line ?? 1}: the header must be email,name,dept`] };
  }
  const errors = [];
  const entries = [];
  const seen = new Map();
  for (const { line, fields } of rows) {
    if (fields.length !== 3) {
      errors.push(`line ${line}: expected 3 columns (email,name,dept), found ${fields.length}`);
      continue;
    }
    const email = normalizeEmail(fields[0]);
    const name = cleanText(fields[1]);
    const dept = cleanText(fields[2]) || null;
    const before = errors.length;
    if (!email) errors.push(`line ${line}: invalid email ${JSON.stringify(fields[0].trim())}`);
    if (!name) errors.push(`line ${line}: name is empty`);
    for (const [label, v] of [["name", name], ["dept", dept ?? ""]]) {
      if (v.length > TEXT_MAX) errors.push(`line ${line}: ${label} is longer than ${TEXT_MAX} characters`);
      if (CONTROL_RE.test(v)) errors.push(`line ${line}: ${label} contains control characters`);
    }
    if (errors.length > before || !email) continue;
    if (seen.has(email)) {
      errors.push(`line ${line}: duplicate email ${email} (first on line ${seen.get(email)})`);
      continue;
    }
    seen.set(email, line);
    entries.push({ line, email, name, dept });
  }
  if (!errors.length && !entries.length) errors.push("no physicians in the CSV (it would deactivate everyone)");
  return { entries, errors };
}

/**
 * What applying the roster changes in the table: added (new emails), changed (active rows with another name or
 * dept), reactivated (inactive rows that are in the CSV again, with its name and dept) and deactivated (active rows
 * missing from the CSV). Rows are never deleted. Lists are sorted by email.
 * @param {PhysicianRow[]} current
 * @param {RosterEntry[]} entries
 * @returns {RosterDiff}
 */
export function diffRoster(current, entries) {
  const byEmail = new Map(current.map((r) => [r.email, r]));
  const inCsv = new Set(entries.map((e) => e.email));
  const added = [];
  const changed = [];
  const reactivated = [];
  let unchanged = 0;
  for (const e of entries) {
    const row = byEmail.get(e.email);
    if (!row) added.push(e);
    else if (!row.active) reactivated.push({ ...e, before: row });
    else if (row.name !== e.name || (row.dept ?? null) !== e.dept) changed.push({ ...e, before: row });
    else unchanged++;
  }
  const deactivated = current.filter((r) => r.active && !inCsv.has(r.email));
  /** @param {{ email: string }} a @param {{ email: string }} b */
  const byMail = (a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0);
  return {
    added: added.sort(byMail),
    changed: changed.sort(byMail),
    reactivated: reactivated.sort(byMail),
    deactivated: deactivated.sort(byMail),
    unchanged,
  };
}

/**
 * The diff as text lines for the terminal.
 * @param {RosterDiff} d
 * @returns {string[]}
 */
export function formatDiff(d) {
  /** @param {{ name: string, dept: string | null }} p */
  const who = (p) => (p.dept ? `${p.name} (${p.dept})` : p.name);
  /** @param {string | null} v */
  const show = (v) => (v === null ? "-" : JSON.stringify(v));
  const out = [];
  /** @template T @param {string} title @param {string} mark @param {T[]} list @param {(x: T) => string} fn */
  const section = (title, mark, list, fn) => {
    if (!list.length) return;
    out.push(`${title} (${list.length}):`);
    for (const x of list) out.push(`  ${mark} ${fn(x)}`);
  };
  section("added", "+", d.added, (e) => `${e.email}  ${who(e)}`);
  section("changed", "~", d.changed, (e) => {
    const parts = [];
    if (e.before.name !== e.name) parts.push(`name ${show(e.before.name)} -> ${show(e.name)}`);
    if ((e.before.dept ?? null) !== e.dept) parts.push(`dept ${show(e.before.dept ?? null)} -> ${show(e.dept)}`);
    return `${e.email}  ${parts.join(", ")}`;
  });
  section("reactivated", "^", d.reactivated, (e) => `${e.email}  ${who(e)}`);
  section("deactivated", "-", d.deactivated, (r) => `${r.email}  ${who(r)}`);
  out.push(`unchanged: ${d.unchanged}`);
  return out;
}

/** True when applying the diff writes nothing. @param {RosterDiff} d */
export function isEmptyDiff(d) {
  return !d.added.length && !d.changed.length && !d.reactivated.length && !d.deactivated.length;
}

/**
 * True when the diff deactivates more than MASS_MIN rows and more than MASS_SHARE of the active ones.
 * @param {RosterDiff} d
 * @param {PhysicianRow[]} current
 */
export function isMassDeactivation(d, current) {
  const active = current.filter((r) => r.active).length;
  return d.deactivated.length > MASS_MIN && d.deactivated.length > active * MASS_SHARE;
}

/**
 * Emails with a row that is inactive once the roster is applied: every row whose email is not in the CSV.
 * @param {PhysicianRow[]} current
 * @param {RosterEntry[]} entries
 * @returns {string[]}
 */
export function offRoster(current, entries) {
  const inCsv = new Set(entries.map((e) => e.email));
  return current
    .filter((r) => !inCsv.has(r.email))
    .map((r) => r.email)
    .sort();
}

/**
 * Warning for emails that are off the roster but still have an approved access request: lib/authz.ts keeps
 * authorizing them until the request is revoked, which the script leaves to the operator (README, "Adding or
 * removing physicians"). The last line is the revoking UPDATE (emails as SQL literals).
 * @param {string[]} emails
 * @returns {string[]}
 */
export function formatStillApproved(emails) {
  if (!emails.length) return [];
  const list = emails.map((e) => `'${e.replaceAll("'", "''")}'`).join(", ");
  return [
    `off the roster but still authorized by an approved access request (${emails.length}), so they keep signing in:`,
    ...emails.map((e) => `  ! ${e}`),
    "  revoke in SQL if they should lose access (takes effect within 60 s):",
    `  UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE status = 'approved' AND email IN (${list});`,
  ];
}
