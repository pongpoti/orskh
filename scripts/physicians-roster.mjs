// Roster CSV -> rows of the table physicians, and what applying it would change. Pure (no files, no database), so
// tests/unit/sync-physicians.test.ts imports it; scripts/sync-physicians.mjs does the reading and writing.

/** @typedef {{ line: number, phone: string, name: string, dept: string | null }} RosterEntry */
/** @typedef {{ phone: string, name: string, dept: string | null, active: boolean }} PhysicianRow */
/**
 * @typedef {{
 *   added: RosterEntry[],
 *   changed: (RosterEntry & { before: PhysicianRow })[],
 *   reactivated: (RosterEntry & { before: PhysicianRow })[],
 *   deactivated: PhysicianRow[],
 *   unchanged: number,
 * }} RosterDiff
 */

// Same pattern as PHONE_RE in lib/phone.ts (a unit test keeps the two identical): Thai mobile numbers, canonical form.
export const PHONE_RE = /^0[689]\d{8}$/;

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
 * As normalizePhone() in lib/phone.ts: NFKC, Thai digits to ASCII, spaces, dashes, dots and parentheses removed;
 * 0XXXXXXXXX, 66XXXXXXXXX and +66XXXXXXXXX (also with the 0 kept: +660XXXXXXXXX) accepted. Returns the canonical
 * "0812345678", or null.
 * @param {unknown} input
 * @returns {string | null}
 */
export function normalizePhone(input) {
  if (typeof input !== "string" || input.length > 40) return null;
  let v = input
    .normalize("NFKC")
    .replace(/[\u0E50-\u0E59]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/[\s\-.()\u2010-\u2015]/g, "");
  if (/^\+66\d{9}$/.test(v)) v = `0${v.slice(3)}`;
  else if (/^66\d{9}$/.test(v)) v = `0${v.slice(2)}`;
  // "+66 (0) 81 234 5678", "+66 081-234-5678": the country code written before the national number with its 0.
  else if (/^\+?660\d{9}$/.test(v)) v = v.replace(/^\+?66/, "");
  return PHONE_RE.test(v) ? v : null;
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
 * Roster CSV (header phone,name,dept; one row per mobile number, a second number as another row with the same
 * name) -> entries, or every problem found, each with its line number. Blank lines are skipped; an empty dept is null.
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
  if (!header || header.fields.map((f) => f.trim().toLowerCase()).join(",") !== "phone,name,dept") {
    return { entries: [], errors: [`line ${header?.line ?? 1}: the header must be phone,name,dept`] };
  }
  const errors = [];
  const entries = [];
  const seen = new Map();
  for (const { line, fields } of rows) {
    if (fields.length !== 3) {
      errors.push(`line ${line}: expected 3 columns (phone,name,dept), found ${fields.length}`);
      continue;
    }
    const phone = normalizePhone(fields[0]);
    const name = cleanText(fields[1]);
    const dept = cleanText(fields[2]) || null;
    const before = errors.length;
    if (!phone) errors.push(`line ${line}: invalid Thai mobile number ${JSON.stringify(fields[0].trim())}`);
    if (!name) errors.push(`line ${line}: name is empty`);
    for (const [label, v] of [["name", name], ["dept", dept ?? ""]]) {
      if (v.length > TEXT_MAX) errors.push(`line ${line}: ${label} is longer than ${TEXT_MAX} characters`);
      if (CONTROL_RE.test(v)) errors.push(`line ${line}: ${label} contains control characters`);
    }
    if (errors.length > before || !phone) continue;
    if (seen.has(phone)) {
      errors.push(`line ${line}: duplicate phone ${phone} (first on line ${seen.get(phone)})`);
      continue;
    }
    seen.set(phone, line);
    entries.push({ line, phone, name, dept });
  }
  if (!errors.length && !entries.length) errors.push("no physicians in the CSV (it would deactivate everyone)");
  return { entries, errors };
}

/**
 * What applying the roster changes in the table: added (new numbers), changed (active rows with another name or
 * dept), reactivated (inactive rows that are in the CSV again, with its name and dept) and deactivated (active rows
 * missing from the CSV). Rows are never deleted. Lists are sorted by phone.
 * @param {PhysicianRow[]} current
 * @param {RosterEntry[]} entries
 * @returns {RosterDiff}
 */
export function diffRoster(current, entries) {
  const byPhone = new Map(current.map((r) => [r.phone, r]));
  const inCsv = new Set(entries.map((e) => e.phone));
  const added = [];
  const changed = [];
  const reactivated = [];
  let unchanged = 0;
  for (const e of entries) {
    const row = byPhone.get(e.phone);
    if (!row) added.push(e);
    else if (!row.active) reactivated.push({ ...e, before: row });
    else if (row.name !== e.name || (row.dept ?? null) !== e.dept) changed.push({ ...e, before: row });
    else unchanged++;
  }
  const deactivated = current.filter((r) => r.active && !inCsv.has(r.phone));
  /** @param {{ phone: string }} a @param {{ phone: string }} b */
  const order = (a, b) => (a.phone < b.phone ? -1 : a.phone > b.phone ? 1 : 0);
  return {
    added: added.sort(order),
    changed: changed.sort(order),
    reactivated: reactivated.sort(order),
    deactivated: deactivated.sort(order),
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
  section("added", "+", d.added, (e) => `${e.phone}  ${who(e)}`);
  section("changed", "~", d.changed, (e) => {
    const parts = [];
    if (e.before.name !== e.name) parts.push(`name ${show(e.before.name)} -> ${show(e.name)}`);
    if ((e.before.dept ?? null) !== e.dept) parts.push(`dept ${show(e.before.dept ?? null)} -> ${show(e.dept)}`);
    return `${e.phone}  ${parts.join(", ")}`;
  });
  section("reactivated", "^", d.reactivated, (e) => `${e.phone}  ${who(e)}`);
  section("deactivated", "-", d.deactivated, (r) => `${r.phone}  ${who(r)}`);
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
 * Numbers with a row that is inactive once the roster is applied: every row whose number is not in the CSV.
 * @param {PhysicianRow[]} current
 * @param {RosterEntry[]} entries
 * @returns {string[]}
 */
export function offRoster(current, entries) {
  const inCsv = new Set(entries.map((e) => e.phone));
  return current
    .filter((r) => !inCsv.has(r.phone))
    .map((r) => r.phone)
    .sort();
}

/**
 * Warning for numbers that are off the roster but still have an approved access request: lib/authz.ts keeps
 * authorizing them until the request is revoked, which the script leaves to the operator (README, "Adding or
 * removing physicians"). The last line is the revoking UPDATE (numbers as SQL literals).
 * @param {string[]} phones
 * @returns {string[]}
 */
export function formatStillApproved(phones) {
  if (!phones.length) return [];
  const list = phones.map((p) => `'${p.replaceAll("'", "''")}'`).join(", ");
  return [
    `off the roster but still authorized by an approved access request (${phones.length}), so they keep signing in:`,
    ...phones.map((p) => `  ! ${p}`),
    "  revoke in SQL if they should lose access (takes effect within 60 s):",
    `  UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE status = 'approved' AND phone IN (${list});`,
  ];
}
