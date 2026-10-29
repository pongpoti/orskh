// Users CSV -> rows of the table users, and what applying it would change. Pure (no files, no database), so
// tests/unit/sync-users.test.ts imports it; scripts/sync-users.mjs does the reading and writing.

/** @typedef {"DR" | "RN" | "PN" | "PCA"} UserType */
/** @typedef {{ line: number, firstName: string, lastName: string, type: UserType, subtype: string }} UserEntry */
/**
 * @typedef {{ id: string, first_name: string, last_name: string, type: string, subtype: string, active: boolean,
 *   claimed: boolean }} UserRow
 */
/**
 * @typedef {{
 *   added: UserEntry[],
 *   changed: (UserEntry & { before: UserRow })[],
 *   reactivated: (UserEntry & { before: UserRow })[],
 *   deactivated: UserRow[],
 *   unchanged: number,
 * }} UserDiff
 */

/** Same list as USER_TYPES in src/lib/user-labels.ts and the CHECK on users.type (a unit test keeps them equal). */
export const USER_TYPES = /** @type {const} */ (["DR", "RN", "PN", "PCA"]);

/** The header of Pong's list, in this order. */
export const HEADER = ["first_name", "last_name", "type", "subtype"];

/** Longest first or last name accepted (a longer cell is a shifted column, not a name). */
export const NAME_MAX = 100;

/**
 * A subtype is a code such as ORTHO (doctors) or OR, ANES (nurses). The table only requires it to be non-empty
 * (users.subtype is NOT NULL); the script is stricter so that a shifted column or a typo is caught.
 */
export const SUBTYPE_RE = /^[A-Z][A-Z0-9_]{0,31}$/;

// Refused in names after cleanName(): control characters (tabs and line breaks are spaces by then).
const CONTROL_RE = /\p{Cc}/u;

/**
 * --apply refuses to deactivate more than MASS_MIN rows when that is also more than MASS_SHARE of the active rows,
 * unless --allow-mass-deactivate: such a CSV is more likely partial (one unit's sheet) than a real change.
 */
export const MASS_MIN = 5;
export const MASS_SHARE = 0.1;

/**
 * As normaliseName() in src/lib/surgeons.ts: invisible format characters (zero-width spaces, direction marks and
 * overrides, soft hyphens) dropped, runs of white space made one space, trimmed, then NFC (never NFKC, which splits
 * the Thai vowel sara am).
 * @param {string} v
 */
export function cleanName(v) {
  return v.replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim().normalize("NFC");
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
 * The key of a row: one person, by first and last name (the table's unique constraint users_name_key). The type is not
 * part of it: a person whose type changes keeps their row (and their claim). @param {{ firstName: string, lastName: string }} e
 */
export function entryKey(e) {
  return `${e.firstName}\u0000${e.lastName}`;
}

/** @param {UserRow} r */
function rowKey(r) {
  return `${r.first_name}\u0000${r.last_name}`;
}

/**
 * Users CSV (header first_name,last_name,type,subtype) -> entries, or every problem found, each with its line number.
 * Names are cleaned (cleanName()); type and subtype are upper-cased, and subtype is required (users.subtype is NOT
 * NULL). Blank lines are skipped.
 * @param {string} text
 * @returns {{ entries: UserEntry[], errors: string[] }}
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
  if (!header || header.fields.map((f) => f.trim().toLowerCase()).join(",") !== HEADER.join(",")) {
    return { entries: [], errors: [`line ${header?.line ?? 1}: the header must be ${HEADER.join(",")}`] };
  }
  const errors = [];
  const entries = [];
  const seen = new Map();
  for (const { line, fields } of rows) {
    if (fields.length !== HEADER.length) {
      errors.push(`line ${line}: expected ${HEADER.length} columns (${HEADER.join(",")}), found ${fields.length}`);
      continue;
    }
    const firstName = cleanName(fields[0]);
    const lastName = cleanName(fields[1]);
    const type = cleanName(fields[2]).toUpperCase();
    const subtype = cleanName(fields[3]).toUpperCase();
    const before = errors.length;
    for (const [label, v] of [["first_name", firstName], ["last_name", lastName]]) {
      if (!v) errors.push(`line ${line}: ${label} is empty`);
      else if (CONTROL_RE.test(v)) errors.push(`line ${line}: ${label} contains control characters`);
      else if (Array.from(v).length > NAME_MAX) errors.push(`line ${line}: ${label} is longer than ${NAME_MAX} characters`);
    }
    if (!(/** @type {readonly string[]} */ (USER_TYPES).includes(type))) {
      errors.push(`line ${line}: invalid type ${JSON.stringify(fields[2].trim().slice(0, 20))} (DR, RN, PN or PCA)`);
    }
    if (!subtype) {
      errors.push(`line ${line}: subtype is empty (a code such as ORTHO or OR is required)`);
    } else if (!SUBTYPE_RE.test(subtype)) {
      errors.push(`line ${line}: invalid subtype ${JSON.stringify(fields[3].trim().slice(0, 40))} (a code such as ORTHO or OR)`);
    }
    if (errors.length > before) continue;
    const entry = { line, firstName, lastName, type: /** @type {UserType} */ (type), subtype };
    const key = entryKey(entry);
    if (seen.has(key)) {
      errors.push(`line ${line}: duplicate ${firstName} ${lastName} (first on line ${seen.get(key)}; a name can appear once)`);
      continue;
    }
    seen.set(key, line);
    entries.push(entry);
  }
  if (!errors.length && !entries.length) errors.push("no users in the CSV (it would deactivate everyone)");
  return { entries, errors };
}

/** @param {{ type: string, first_name?: string, last_name?: string, firstName?: string, lastName?: string }} a */
function sortKey(a) {
  return `${USER_TYPES.indexOf(/** @type {UserType} */ (a.type))}\u0000${a.firstName ?? a.first_name}\u0000${a.lastName ?? a.last_name}`;
}

/**
 * What applying the CSV changes in the table, by (first_name, last_name): added (new people), changed (active rows
 * with another type or subtype), reactivated (inactive rows that are in the CSV again, with its type and subtype) and
 * deactivated (active rows missing from the CSV). Rows are never deleted and ids never change; claims (user_claims) are
 * never part of a change. Lists are sorted by type, then name.
 * @param {UserRow[]} current
 * @param {UserEntry[]} entries
 * @returns {UserDiff}
 */
export function diffRoster(current, entries) {
  const byKey = new Map(current.map((r) => [rowKey(r), r]));
  const inCsv = new Set(entries.map(entryKey));
  const added = [];
  const changed = [];
  const reactivated = [];
  let unchanged = 0;
  for (const e of entries) {
    const row = byKey.get(entryKey(e));
    if (!row) added.push(e);
    else if (!row.active) reactivated.push({ ...e, before: row });
    else if (row.type !== e.type || row.subtype !== e.subtype) changed.push({ ...e, before: row });
    else unchanged++;
  }
  const deactivated = current.filter((r) => r.active && !inCsv.has(rowKey(r)));
  /** @param {any} a @param {any} b */
  const order = (a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0);
  return {
    added: added.sort(order),
    changed: changed.sort(order),
    reactivated: reactivated.sort(order),
    deactivated: deactivated.sort(order),
    unchanged,
  };
}

/**
 * The diff as text lines for the terminal (names included, for review before --apply).
 * @param {UserDiff} d
 * @returns {string[]}
 */
export function formatDiff(d) {
  /** @param {string | null} v */
  const show = (v) => (v === null ? "-" : JSON.stringify(v));
  /** @param {{ type: string, firstName: string, lastName: string, subtype: string | null }} e */
  const who = (e) => `${e.type}  ${e.firstName} ${e.lastName}${e.subtype ? ` (${e.subtype})` : ""}`;
  const out = [];
  /** @template T @param {string} title @param {string} mark @param {T[]} list @param {(x: T) => string} fn */
  const section = (title, mark, list, fn) => {
    if (!list.length) return;
    out.push(`${title} (${list.length}):`);
    for (const x of list) out.push(`  ${mark} ${fn(x)}`);
  };
  section("added", "+", d.added, who);
  section("changed", "~", d.changed, (e) => {
    const parts = [];
    if (e.before.type !== e.type) parts.push(`type ${show(e.before.type)} -> ${show(e.type)}`);
    if (e.before.subtype !== e.subtype) parts.push(`subtype ${show(e.before.subtype ?? null)} -> ${show(e.subtype)}`);
    return `${e.type}  ${e.firstName} ${e.lastName}  ${parts.join(", ")}`;
  });
  section("reactivated", "^", d.reactivated, who);
  section("deactivated", "-", d.deactivated, (r) =>
    `${who({ type: r.type, firstName: r.first_name, lastName: r.last_name, subtype: r.subtype })}${r.claimed ? "  [claimed: stops signing in]" : ""}`,
  );
  out.push(`unchanged: ${d.unchanged}`);
  return out;
}

/**
 * Counts only, no names: the CSV per type, and the changes.
 * @param {UserEntry[]} entries
 * @param {UserDiff} d
 * @returns {string[]}
 */
export function formatSummary(entries, d) {
  const perType = USER_TYPES.map((t) => `${t} ${entries.filter((e) => e.type === t).length}`).join(", ");
  const claimedOff = d.deactivated.filter((r) => r.claimed).length;
  return [
    `CSV: ${entries.length} names (${perType})`,
    `summary: added ${d.added.length}, changed ${d.changed.length}, reactivated ${d.reactivated.length}, ` +
      `deactivated ${d.deactivated.length}${claimedOff ? ` (${claimedOff} claimed)` : ""}, unchanged ${d.unchanged}`,
  ];
}

/** True when applying the diff writes nothing. @param {UserDiff} d */
export function isEmptyDiff(d) {
  return !d.added.length && !d.changed.length && !d.reactivated.length && !d.deactivated.length;
}

/**
 * True when the diff deactivates more than MASS_MIN rows and more than MASS_SHARE of the active ones.
 * @param {UserDiff} d
 * @param {UserRow[]} current
 */
export function isMassDeactivation(d, current) {
  const active = current.filter((r) => r.active).length;
  return d.deactivated.length > MASS_MIN && d.deactivated.length > active * MASS_SHARE;
}

/**
 * Warning for claimed names that the CSV deactivates: their numbers stop signing in (lib/authz.ts) unless they also
 * have an approved access request. Counts only; the names are in the diff above.
 * @param {UserDiff} d
 * @returns {string[]}
 */
export function formatClaimedOff(d) {
  const n = d.deactivated.filter((r) => r.claimed).length;
  if (!n) return [];
  return [
    `${n} deactivated name(s) were claimed: those numbers stop signing in within 60 s (unless they have an approved access request).`,
  ];
}
