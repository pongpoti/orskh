import "./_setup";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createPool, ensureSchema } from "@/lib/db";
import { USER_TYPES as APP_TYPES } from "@/lib/user-labels";
import { normaliseName } from "@/lib/surgeons";
import { PRODUCTION_USERS_DDL } from "./production-users-ddl";
import {
  cleanName,
  diffRoster,
  formatClaimedOff,
  formatDiff,
  formatSummary,
  isEmptyDiff,
  isMassDeactivation,
  parseCsv,
  parseRoster,
  USER_TYPES,
} from "../../scripts/users-roster.mjs";
import { TEST_DB } from "./_setup";

// Invented names only. ำ (U+0E33, sara am) must survive: NFKC would split it.
const SARA_AM = "น้ำใจ";
const HEADER = "first_name,last_name,type,subtype";

type Row = { id: string; first_name: string; last_name: string; type: string; subtype: string; active: boolean; claimed: boolean };
const row = (id: number, first: string, last: string, type: string, subtype: string, active = true, claimed = false): Row => ({
  id: String(id),
  first_name: first,
  last_name: last,
  type,
  subtype,
  active,
  claimed,
});

describe("users CSV (scripts/users-roster.mjs)", () => {
  test("CSV: BOM, CRLF, quoted fields with commas, quotes and line breaks, line numbers", () => {
    const csv = '﻿a,b,c\r\n"x, y","say ""hi""",\r\n"two\nlines",z,\n\nlast,1,2';
    assert.deepEqual(parseCsv(csv), [
      { line: 1, fields: ["a", "b", "c"] },
      { line: 2, fields: ["x, y", 'say "hi"', ""] },
      { line: 3, fields: ["two\nlines", "z", ""] },
      { line: 5, fields: [""] },
      { line: 6, fields: ["last", "1", "2"] },
    ]);
    assert.throws(() => parseCsv('a,b\n"open,c\n'), /line 2: a quoted field is never closed/);
  });

  test("no users CSV is committed (Pong's list stays outside the repository)", () => {
    assert.equal(execFileSync("git", ["ls-files", "*.csv"], { encoding: "utf8" }).trim(), "");
  });

  test("types are the app's and the table's", () => {
    assert.deepEqual([...USER_TYPES], [...APP_TYPES]);
  });

  test("names are cleaned like the admin page's surgeon names: NFC, single spaces, invisible characters removed", () => {
    for (const v of ["  สมชาย   ใจดี ", "สม​ชาย", "‮สมชาย‬", "ใจ­ดี", `${SARA_AM}`.normalize("NFD"), "Mary  O'Neil", "ณัฐ\tพงศ์"]) {
      assert.equal(cleanName(v), normaliseName(v), JSON.stringify(v));
    }
    assert.equal(cleanName(SARA_AM.normalize("NFD")), SARA_AM);
    assert.equal(cleanName(" สม​ชาย ⁦ใจดี⁩ "), "สมชาย ใจดี");
  });

  test("Pong's format: BOM, CRLF, any case in type and subtype, blank lines skipped", () => {
    const { entries, errors } = parseRoster(
      [
        `﻿${HEADER}`,
        " สมชาย , ใจดี ,dr, ortho ",
        "",
        `สมหญิง,${SARA_AM.normalize("NFD")},RN,OR`,
        "กมล,ทอง​ดี,pn,anes",
        '"ปราณี","สาย  บุญ",PCA,or',
        "",
      ].join("\r\n"),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(entries, [
      { line: 2, firstName: "สมชาย", lastName: "ใจดี", type: "DR", subtype: "ORTHO" },
      { line: 4, firstName: "สมหญิง", lastName: SARA_AM, type: "RN", subtype: "OR" },
      { line: 5, firstName: "กมล", lastName: "ทองดี", type: "PN", subtype: "ANES" },
      { line: 6, firstName: "ปราณี", lastName: "สาย บุญ", type: "PCA", subtype: "OR" },
    ]);
  });

  test("every problem is reported with its line number; a name may appear once (whatever the type); subtype is required", () => {
    const { errors } = parseRoster(
      [
        HEADER,
        "สมชาย,ใจดี,DR,ORTHO",
        "สมชาย,ใจดี,RN,OR", // another type: still the same person (users_name_key is first and last name)
        "สมชาย, ใจดี ,dr,GENSX",
        "  ,ใจดี,DR,ORTHO",
        "สมชาย,​,DR,ORTHO",
        "ก,ข,NURSE,OR",
        "ก,ข,,OR",
        "ก,ข,RN,or-1",
        "ก,ข,RN",
        "ก,ข,RN,OR,extra",
        `${"ก".repeat(101)},ข,DR,ORTHO`,
        "bad\u0007name,ข,DR,ORTHO",
        "ค,ง,RN,",
        "จ,ฉ,PN, \u200b ",
      ].join("\n"),
    );
    assert.deepEqual(errors, [
      "line 3: duplicate สมชาย ใจดี (first on line 2; a name can appear once)",
      "line 4: duplicate สมชาย ใจดี (first on line 2; a name can appear once)",
      "line 5: first_name is empty",
      "line 6: last_name is empty",
      'line 7: invalid type "NURSE" (DR, RN, PN or PCA)',
      'line 8: invalid type "" (DR, RN, PN or PCA)',
      'line 9: invalid subtype "or-1" (a code such as ORTHO or OR)',
      "line 10: expected 4 columns (first_name,last_name,type,subtype), found 3",
      "line 11: expected 4 columns (first_name,last_name,type,subtype), found 5",
      "line 12: first_name is longer than 100 characters",
      "line 13: first_name contains control characters",
      "line 14: subtype is empty (a code such as ORTHO or OR is required)",
      "line 15: subtype is empty (a code such as ORTHO or OR is required)",
    ]);
    // the old physician roster (with numbers) and other headers are refused
    for (const csv of ["phone,name,dept\n0812345678,A,\n", "first_name,last_name,type\nก,ข,DR\n", "\n\nname,type\n", ""]) {
      assert.match(parseRoster(csv).errors[0], /^line \d+: the header must be first_name,last_name,type,subtype$/, csv);
    }
    assert.deepEqual(parseRoster(`${HEADER}\n\n`).errors, ["no users in the CSV (it would deactivate everyone)"]);
  });

  test("diff by (first name, last name): added, changed type or subtype, reactivated, deactivated; claims are not part of it", () => {
    const current = [
      row(1, "เหมือน", "เดิม", "DR", "ORTHO", true, true),
      row(2, "ย้าย", "แผนก", "DR", "GENSX", true, true),
      row(3, "กลับ", "มา", "RN", "OR", false, true),
      row(4, "ลา", "ออก", "PN", "ANES", true, true),
      row(5, "ลา", "นานแล้ว", "PCA", "OR", false),
      row(6, "เปลี่ยน", "ตำแหน่ง", "PN", "OR"), // becomes a nurse: same row, new type
      row(7, "ไม่มี", "ในไฟล์", "RN", "OR"),
      row(8, "คง", "เดิม", "RN", "ANES"),
    ];
    const { entries } = parseRoster(
      [HEADER, "เหมือน,เดิม,DR,ORTHO", "ย้าย,แผนก,DR,URO", "กลับ,มา,PN,ANES", "เปลี่ยน,ตำแหน่ง,RN,OR", "คน,ใหม่,PCA,OR", "คง,เดิม,RN,ANES"].join("\n"),
    );
    const d = diffRoster(current, entries);
    assert.deepEqual(d.added.map((e) => `${e.type} ${e.firstName}`), ["PCA คน"]);
    assert.deepEqual(d.changed.map((e) => [e.before.id, e.type, e.subtype]), [["2", "DR", "URO"], ["6", "RN", "OR"]]);
    assert.deepEqual(d.reactivated.map((e) => [e.before.id, e.type, e.subtype]), [["3", "PN", "ANES"]]);
    assert.deepEqual(d.deactivated.map((r) => r.id), ["7", "4"], "by type, then name; inactive rows stay as they are");
    assert.equal(d.unchanged, 2);
    assert.equal(isEmptyDiff(d), false);
    assert.deepEqual(formatDiff(d), [
      "added (1):",
      "  + PCA  คน ใหม่ (OR)",
      "changed (2):",
      '  ~ DR  ย้าย แผนก  subtype "GENSX" -> "URO"',
      '  ~ RN  เปลี่ยน ตำแหน่ง  type "PN" -> "RN"',
      "reactivated (1):",
      "  ^ PN  กลับ มา (ANES)",
      "deactivated (2):",
      "  - RN  ไม่มี ในไฟล์ (OR)",
      "  - PN  ลา ออก (ANES)  [claimed: stops signing in]",
      "unchanged: 2",
    ]);
    assert.deepEqual(formatSummary(entries, d), [
      "CSV: 6 names (DR 2, RN 2, PN 1, PCA 1)",
      "summary: added 1, changed 2, reactivated 1, deactivated 2 (1 claimed), unchanged 2",
    ]);
    const both = diffRoster([row(1, "ก", "ข", "PN", "OR")], parseRoster(`${HEADER}\nก,ข,RN,ANES`).entries);
    assert.deepEqual(formatDiff(both).slice(0, 2), ["changed (1):", '  ~ RN  ก ข  type "PN" -> "RN", subtype "OR" -> "ANES"']);
    assert.deepEqual(formatClaimedOff(d), [
      "1 deactivated name(s) were claimed: those numbers stop signing in within 60 s (unless they have an approved access request).",
    ]);
    const same = diffRoster(current.slice(0, 1), entries.slice(0, 1));
    assert.equal(isEmptyDiff(same), true);
    assert.deepEqual(formatDiff(same), ["unchanged: 1"]);
    assert.deepEqual(formatClaimedOff(same), []);
  });

  test("mass deactivation: more than 5 rows and more than 10% of the active ones", () => {
    const rows = (n: number, active = true) => Array.from({ length: n }, (_, i) => row(i, "ก", `ข${i}`, "RN", "OR", active));
    const off = (current: Row[], n: number) =>
      isMassDeactivation({ added: [], changed: [], reactivated: [], deactivated: current.slice(0, n), unchanged: 0 }, current);
    assert.equal(off(rows(8), 5), false, "5 rows are never mass");
    assert.equal(off(rows(8), 6), true, "6 of 8");
    assert.equal(off(rows(100), 10), false, "10% of 100");
    assert.equal(off(rows(100), 11), true, "11 of 100");
    assert.equal(off([...rows(60), ...rows(3, false)], 6), false, "6 of 60 active (inactive rows do not count)");
  });
});

describe("scripts/sync-users.mjs against the test database", () => {
  const pool = createPool(TEST_DB);
  const dir = mkdtempSync(join(tmpdir(), "orskh-users-")); // outside the repository, like Pong's list
  let n = 0;

  function sync(csv: string | null, ...args: string[]) {
    return syncWith(TEST_DB, csv, ...args);
  }

  function syncWith(url: string, csv: string | null, ...args: string[]) {
    let input: string | undefined;
    if (csv !== null && args.includes("-")) input = csv;
    else if (csv !== null) args.push(writeCsv(csv));
    const r = spawnSync(process.execPath, ["scripts/sync-users.mjs", ...args], {
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
      input,
    });
    for (const secret of ["postgres:postgres", "s3cretpw"]) {
      assert.ok(!`${r.stdout}${r.stderr}`.includes(secret), "no credentials printed");
    }
    return { code: r.status, out: r.stdout, err: r.stderr };
  }

  function writeCsv(csv: string): string {
    const file = join(dir, `all-users-${++n}.csv`);
    writeFileSync(file, csv);
    return file;
  }

  async function rows() {
    const { rows } = await pool.query<{
      id: string;
      first_name: string;
      last_name: string;
      type: string;
      subtype: string;
      active: boolean;
      created_at: Date;
      updated_at: Date;
    }>("SELECT id::text AS id, first_name, last_name, type, subtype, active, created_at, updated_at FROM users ORDER BY id");
    return rows;
  }
  const brief = async () => (await rows()).map((r) => [`${r.type} ${r.first_name} ${r.last_name}`, r.subtype, r.active]);
  const claims = async () =>
    (await pool.query("SELECT id::text AS id, user_id::text AS user_id, phone, line_sub, undone_at, undo_reason FROM user_claims ORDER BY id"))
      .rows;

  const LIST = [
    `﻿${HEADER}`,
    "สมชาย,ใจดี,DR,ORTHO",
    `สมหญิง,${SARA_AM},DR,GENSX`,
    "ปราณี,สายบุญ,RN,OR",
    "วิไล,แสงทอง,RN,ANES",
    "สุดา,คำดี,PN,OR",
    "บุญมี,ใจซื่อ,PCA,OR",
  ].join("\r\n");

  before(async () => {
    await pool.query("DROP TABLE IF EXISTS user_claims, users");
  });
  after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pool.query("TRUNCATE user_claims, users RESTART IDENTITY");
    await pool.end();
  });

  test("dry run by default: prints the diff and the counts per type, writes nothing (not even the table)", async () => {
    const r = sync(LIST);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /table users does not exist yet/);
    assert.match(r.out, /added \(6\):\n {2}\+ DR {2}สมชาย ใจดี \(ORTHO\)\n/);
    assert.match(r.out, /\nCSV: 6 names \(DR 2, RN 2, PN 1, PCA 1\)\nsummary: added 6, changed 0, reactivated 0, deactivated 0, unchanged 0\n/);
    assert.match(r.out, /dry run: nothing was written/);
    const { rows } = await pool.query("SELECT to_regclass('users') AS t");
    assert.equal(rows[0].t, null);
  });

  test("--apply creates the tables from db/schema.sql and writes the list (ids from the identity); a second run changes nothing", async () => {
    const r = sync(LIST, "--apply");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /applied/);
    assert.deepEqual(await brief(), [
      ["DR สมชาย ใจดี", "ORTHO", true],
      [`DR สมหญิง ${SARA_AM}`, "GENSX", true],
      ["RN ปราณี สายบุญ", "OR", true],
      ["RN วิไล แสงทอง", "ANES", true],
      ["PN สุดา คำดี", "OR", true],
      ["PCA บุญมี ใจซื่อ", "OR", true],
    ]);
    assert.deepEqual((await rows()).map((x) => x.id), ["1", "2", "3", "4", "5", "6"]);
    const first = await rows();
    const again = sync(LIST, "--apply");
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /unchanged: 6\n.*\n.*unchanged 6\nnothing to change\n$/);
    assert.deepEqual(await rows(), first, "nothing rewritten (updated_at kept)");
    const dry = sync(LIST);
    assert.match(dry.out, /summary: added 0, changed 0, reactivated 0, deactivated 0, unchanged 6\n/);
  });

  test("--apply changes type and subtype, deactivates and reactivates by name; ids stay, updated_at moves, claims are never touched", async () => {
    // ปราณี and สุดา hold claims (as /api/auth/claim makes them)
    await ensureSchema(pool);
    const [, , pranee, , suda] = await rows();
    await pool.query(
      "INSERT INTO user_claims (user_id, phone, line_sub) VALUES ($1, '0900000101', 'U-pranee'), ($2, '0900000102', 'U-suda')",
      [pranee.id, suda.id],
    );
    const claimsBefore = await claims();
    const before = await rows();

    // ปราณี moves from RN to PN (same row, same claim); สมชาย changes department; สุดา leaves; a new person arrives
    const changed = [
      HEADER,
      "สมชาย,ใจดี,DR,URO",
      `สมหญิง,${SARA_AM},DR,GENSX`,
      "ปราณี,สายบุญ,PN,ANES",
      "วิไล,แสงทอง,RN,ANES",
      "บุญมี,ใจซื่อ,PCA,OR",
      "คนใหม่,มาใหม่,RN,OR",
    ].join("\n");
    const r = sync(changed, "--apply");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /added \(1\):\n {2}\+ RN {2}คนใหม่ มาใหม่ \(OR\)\n/);
    assert.match(r.out, /changed \(2\):\n {2}~ DR {2}สมชาย ใจดี {2}subtype "ORTHO" -> "URO"\n {2}~ PN {2}ปราณี สายบุญ {2}type "RN" -> "PN", subtype "OR" -> "ANES"\n/);
    assert.match(r.out, /deactivated \(1\):\n {2}- PN {2}สุดา คำดี \(OR\) {2}\[claimed: stops signing in\]\n/);
    assert.match(r.out, /1 deactivated name\(s\) were claimed: those numbers stop signing in within 60 s/);
    let now = await rows();
    assert.equal(now.length, 7, "no row deleted");
    assert.deepEqual(
      now.map((x) => [x.id, x.first_name, x.type, x.subtype, x.active]),
      [
        ["1", "สมชาย", "DR", "URO", true],
        ["2", "สมหญิง", "DR", "GENSX", true],
        ["3", "ปราณี", "PN", "ANES", true],
        ["4", "วิไล", "RN", "ANES", true],
        ["5", "สุดา", "PN", "OR", false],
        ["6", "บุญมี", "PCA", "OR", true],
        ["7", "คนใหม่", "RN", "OR", true],
      ],
    );
    for (const i of [0, 2, 4]) assert.ok(now[i].updated_at > before[i].updated_at, `updated_at moved on ${now[i].first_name}`);
    for (const i of [1, 3, 5]) assert.deepEqual(now[i].updated_at, before[i].updated_at, `updated_at kept on ${now[i].first_name}`);
    for (const i of [0, 1, 2, 3, 4, 5]) assert.deepEqual(now[i].created_at, before[i].created_at);
    assert.deepEqual(await claims(), claimsBefore, "user_claims untouched");

    // back in the list (stdin this time): reactivated, so its claim authorizes again; the new person stays until gone
    const back = sync(LIST, "-", "--apply");
    assert.equal(back.code, 0, back.err);
    assert.match(back.out, /reactivated \(1\):\n {2}\^ PN {2}สุดา คำดี \(OR\)\n/);
    now = await rows();
    assert.deepEqual(now.map((x) => [x.id, x.first_name, x.type, x.subtype, x.active]), [
      ["1", "สมชาย", "DR", "ORTHO", true],
      ["2", "สมหญิง", "DR", "GENSX", true],
      ["3", "ปราณี", "RN", "OR", true],
      ["4", "วิไล", "RN", "ANES", true],
      ["5", "สุดา", "PN", "OR", true],
      ["6", "บุญมี", "PCA", "OR", true],
      ["7", "คนใหม่", "RN", "OR", false],
    ]);
    assert.deepEqual(await claims(), claimsBefore, "user_claims untouched");
    await pool.query("DELETE FROM user_claims");
  });

  test("works on a users table made with the production DDL and rows loaded by someone else (their ids are kept)", async () => {
    await pool.query("DROP TABLE user_claims, users");
    await pool.query(PRODUCTION_USERS_DDL);
    await pool.query(
      `INSERT INTO users (first_name, last_name, type, subtype) VALUES
         ('บุญมี', 'ใจซื่อ', 'PCA', 'OR'), ('สมชาย', 'ใจดี', 'DR', 'ORTHO'), ('ปราณี', 'สายบุญ', 'RN', 'OR')`,
    );
    await pool.query("DELETE FROM users WHERE first_name = 'ปราณี'"); // a gap in the ids, as a real table may have
    const r = sync(LIST, "--apply");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /summary: added 4, changed 0, reactivated 0, deactivated 0, unchanged 2\n/);
    const now = await rows();
    assert.deepEqual(now.slice(0, 2).map((x) => [x.id, x.first_name]), [["1", "บุญมี"], ["2", "สมชาย"]]);
    assert.ok(now.slice(2).every((x) => Number(x.id) > 3), "new ids come from the identity");
  });

  test("refuses invalid rows (with line numbers), a CSV inside the repository, a folder, non-UTF-8 input, a malformed DATABASE_URL (not echoed); writes nothing", async () => {
    const before = await rows();
    const bad = sync(`${HEADER}\nก,ข,DR,ORTHO\nก, ข ,RN,OR\nค,ง,MD,OR\nจ,ฉ,RN,\n`, "--apply");
    assert.equal(bad.code, 1);
    assert.match(bad.err, /line 3: duplicate ก ข \(first on line 2; a name can appear once\)/);
    assert.match(bad.err, /line 4: invalid type "MD"/);
    assert.match(bad.err, /line 5: subtype is empty/);
    assert.match(bad.err, /3 problem\(s\) in .*; nothing was written/);
    const inside = sync(null, "--apply", "package.json");
    assert.equal(inside.code, 1);
    assert.match(inside.err, /must live outside the repository \(it holds real names\)/);
    const latin = join(dir, "latin.csv");
    writeFileSync(latin, Buffer.from(`${HEADER}\n\xe0\xb8,b,DR,ORTHO\n`, "latin1"));
    const notUtf8 = sync(null, "--apply", latin);
    assert.equal(notUtf8.code, 1);
    assert.match(notUtf8.err, /is not UTF-8 text/);
    const usage = sync(null, "--apply");
    assert.equal(usage.code, 2);
    const folder = sync(null, "--apply", dir);
    assert.equal(folder.code, 1);
    assert.match(folder.err, /^cannot read .*: EISDIR\n$/, "its own message, no stack trace");
    const badUrl = syncWith("postgres://user:s3cretpw@ho st:5432/db", LIST, "--apply");
    assert.equal(badUrl.code, 1);
    assert.equal(badUrl.err, "DATABASE_URL is not a valid URL (set it in env or .env.local)\n");
    assert.deepEqual(await rows(), before);
  });

  test("--apply refuses to deactivate more than 5 rows and 10% of the active ones unless --allow-mass-deactivate", async () => {
    const big = [LIST, ...Array.from({ length: 8 }, (_, i) => `ทดสอบ,คนที่${i},RN,OR`)].join("\r\n");
    assert.equal(sync(big, "--apply").code, 0); // 14 active
    const before = await rows();
    const partial = LIST; // e.g. one unit's sheet: 8 of 14 would go
    const dry = sync(partial);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /--apply will refuse this: it deactivates 8 of 14 active names at once/);
    const refused = sync(partial, "--apply");
    assert.equal(refused.code, 1);
    assert.match(refused.out, /deactivated \(8\):/);
    assert.match(refused.err, /^refused, nothing was written: this deactivates 8 of 14 active names at once .*--allow-mass-deactivate/);
    assert.deepEqual(await rows(), before, "nothing written");
    const allowed = sync(partial, "--apply", "--allow-mass-deactivate");
    assert.equal(allowed.code, 0, allowed.err);
    assert.match(allowed.out, /applied/);
    assert.equal((await rows()).filter((x) => x.active).length, 6);
    assert.equal((await rows()).length, 14, "deactivated, never deleted");
  });
});
