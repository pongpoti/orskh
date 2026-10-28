import "./_setup";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { createPool } from "@/lib/db";
import {
  diffRoster,
  formatDiff,
  formatStillApproved,
  isEmptyDiff,
  isMassDeactivation,
  offRoster,
  parseCsv,
  parseRoster,
} from "../../scripts/physicians-roster.mjs";
import { TEST_DB } from "./_setup";

const SARA_AM = "นายแพทย์ สมศักดิ์ น้ำใจ"; // ำ (U+0E33) must survive: NFKC would split it

describe("physician roster CSV (scripts/physicians-roster.mjs)", () => {
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

  test("roster: normalized emails, Thai names kept (NFC, single spaces), empty dept is null, blank lines skipped", () => {
    const { entries, errors } = parseRoster(
      [
        " Email , NAME ,Dept",
        ` Doc.One@Example.COM ,"สมชาย   ใจดี ", ศัลยกรรมทั่วไป `,
        "",
        "ｄｏｃ２＠ｅｘａｍｐｌｅ．ｃｏｍ,สมหญิง รักดี,",
        `alt.doc2@example.com,${SARA_AM.normalize("NFD")},"ศัลยกรรม, ออร์โธปิดิกส์"`,
        "",
      ].join("\r\n"),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(entries, [
      { line: 2, email: "doc.one@example.com", name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป" },
      { line: 4, email: "doc2@example.com", name: "สมหญิง รักดี", dept: null },
      { line: 5, email: "alt.doc2@example.com", name: SARA_AM, dept: "ศัลยกรรม, ออร์โธปิดิกส์" },
    ]);
  });

  test("roster: every problem is reported with its line number", () => {
    const { errors } = parseRoster(
      [
        "email,name,dept",
        "doc@example.com,สมชาย,",
        "not-an-email,สมหญิง,",
        "Doc@Example.com,ซ้ำ,",
        "x@example.com,  ,ศัลยกรรม",
        "y@example.com,only two",
        "z@example.com,a,b,c",
        `w@example.com,${"ก".repeat(201)},`,
        "v@example.com,bad\u0007name,",
        "u@example.com,\u202Eevil,",
        "t@example.com,ชื่อ,\u2066ตา\u2069",
      ].join("\n"),
    );
    assert.deepEqual(errors, [
      'line 3: invalid email "not-an-email"',
      "line 4: duplicate email doc@example.com (first on line 2)",
      "line 5: name is empty",
      "line 6: expected 3 columns (email,name,dept), found 2",
      "line 7: expected 3 columns (email,name,dept), found 4",
      "line 8: name is longer than 200 characters",
      "line 9: name contains control characters",
      "line 10: name contains control characters",
      "line 11: dept contains control characters",
    ]);
    assert.deepEqual(parseRoster("mail,name,dept\na@example.com,A,\n").errors, ["line 1: the header must be email,name,dept"]);
    assert.deepEqual(parseRoster("\n\nemail,name\n").errors, ["line 3: the header must be email,name,dept"]);
    assert.deepEqual(parseRoster("").errors, ["line 1: the header must be email,name,dept"]);
    assert.deepEqual(parseRoster("email,name,dept\n\n").errors, ["no physicians in the CSV (it would deactivate everyone)"]);
  });

  test("diff: added, changed (name or dept), reactivated, deactivated; nothing is ever deleted", () => {
    const current = [
      { email: "same@example.com", name: "เหมือนเดิม", dept: null, active: true },
      { email: "rename@example.com", name: "ชื่อเก่า", dept: "ศัลยกรรม", active: true },
      { email: "move@example.com", name: "ย้ายแผนก", dept: null, active: true },
      { email: "back@example.com", name: "กลับมา", dept: null, active: false },
      { email: "gone@example.com", name: "ลาออก", dept: "ตา", active: true },
      { email: "long.gone@example.com", name: "ลาออกนานแล้ว", dept: null, active: false },
    ];
    const { entries } = parseRoster(
      [
        "email,name,dept",
        "same@example.com,เหมือนเดิม,",
        "rename@example.com,ชื่อใหม่,ศัลยกรรม",
        "move@example.com,ย้ายแผนก,สูติ",
        "back@example.com,กลับมา,หู คอ จมูก",
        "new@example.com,คนใหม่,",
      ].join("\n"),
    );
    const d = diffRoster(current, entries);
    assert.deepEqual(d.added.map((e) => e.email), ["new@example.com"]);
    assert.deepEqual(d.changed.map((e) => e.email), ["move@example.com", "rename@example.com"]);
    assert.deepEqual(d.reactivated.map((e) => [e.email, e.dept]), [["back@example.com", "หู คอ จมูก"]]);
    assert.deepEqual(d.deactivated.map((r) => r.email), ["gone@example.com"], "inactive rows stay as they are");
    assert.equal(d.unchanged, 1);
    assert.equal(isEmptyDiff(d), false);
    assert.deepEqual(formatDiff(d), [
      "added (1):",
      "  + new@example.com  คนใหม่",
      "changed (2):",
      '  ~ move@example.com  dept - -> "สูติ"',
      '  ~ rename@example.com  name "ชื่อเก่า" -> "ชื่อใหม่"',
      "reactivated (1):",
      "  ^ back@example.com  กลับมา (หู คอ จมูก)",
      "deactivated (1):",
      "  - gone@example.com  ลาออก (ตา)",
      "unchanged: 1",
    ]);
    const same = diffRoster(current.slice(0, 1), entries.slice(0, 1));
    assert.equal(isEmptyDiff(same), true);
    assert.deepEqual(formatDiff(same), ["unchanged: 1"]);
    // off the roster afterwards: deactivated now, or inactive already and still missing from the CSV
    assert.deepEqual(offRoster(current, entries), ["gone@example.com", "long.gone@example.com"]);
  });

  test("mass deactivation: more than 5 rows and more than 10% of the active ones", () => {
    const rows = (n: number, active = true) =>
      Array.from({ length: n }, (_, i) => ({ email: `d${i}@example.com`, name: "ก", dept: null, active }));
    const off = (current: ReturnType<typeof rows>, n: number) =>
      isMassDeactivation({ added: [], changed: [], reactivated: [], deactivated: current.slice(0, n), unchanged: 0 }, current);
    assert.equal(off(rows(8), 5), false, "5 rows are never mass");
    assert.equal(off(rows(8), 6), true, "6 of 8");
    assert.equal(off(rows(100), 10), false, "10% of 100");
    assert.equal(off(rows(100), 11), true, "11 of 100");
    assert.equal(off([...rows(60), ...rows(3, false)], 6), false, "6 of 60 active (inactive rows do not count)");
  });

  test("approved access requests off the roster: listed with the revoking UPDATE (quotes escaped)", () => {
    assert.deepEqual(formatStillApproved([]), []);
    assert.deepEqual(formatStillApproved(["gone@example.com", "o'neil@example.com"]), [
      "off the roster but still authorized by an approved access request (2), so they keep signing in:",
      "  ! gone@example.com",
      "  ! o'neil@example.com",
      "  revoke in SQL if they should lose access (takes effect within 60 s):",
      "  UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE status = 'approved' AND email IN ('gone@example.com', 'o''neil@example.com');",
    ]);
  });
});

describe("scripts/sync-physicians.mjs against the test database", () => {
  const pool = createPool(TEST_DB);
  const dir = mkdtempSync(join(tmpdir(), "orskh-roster-")); // outside the repository, like the real roster
  let n = 0;

  function sync(csv: string | null, ...args: string[]) {
    return syncWith(TEST_DB, csv, ...args);
  }

  function syncWith(url: string, csv: string | null, ...args: string[]) {
    let input: string | undefined;
    if (csv !== null && args.includes("-")) input = csv;
    else if (csv !== null) args.push(writeCsv(csv));
    const r = spawnSync(process.execPath, ["scripts/sync-physicians.mjs", ...args], {
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
    const file = join(dir, `roster-${++n}.csv`);
    writeFileSync(file, csv);
    return file;
  }

  async function rows() {
    const { rows } = await pool.query<{ email: string; name: string; dept: string | null; active: boolean; updated_at: Date }>(
      "SELECT email, name, dept, active, updated_at FROM physicians ORDER BY email",
    );
    return rows;
  }

  const ROSTER = [
    "email,name,dept",
    "Doc.One@Example.com,สมชาย ใจดี,ศัลยกรรมทั่วไป",
    "doc.one.alt@example.com,สมชาย ใจดี,ศัลยกรรมทั่วไป",
    `doc2@example.com,${SARA_AM},`,
  ].join("\n");

  before(async () => {
    await pool.query("DROP TABLE IF EXISTS physicians");
  });
  after(async () => {
    rmSync(dir, { recursive: true, force: true });
    await pool.query("TRUNCATE physicians");
    await pool.end();
  });

  test("dry run by default: prints the diff and writes nothing (not even the table)", async () => {
    const r = sync(ROSTER);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /CSV: 3 emails, 2 names/);
    assert.match(r.out, /table physicians does not exist yet/);
    assert.match(r.out, /added \(3\):\n {2}\+ doc\.one\.alt@example\.com {2}สมชาย ใจดี \(ศัลยกรรมทั่วไป\)\n/);
    assert.match(r.out, /dry run: nothing was written/);
    const { rows } = await pool.query("SELECT to_regclass('physicians') AS t");
    assert.equal(rows[0].t, null);
  });

  test("--apply creates the table from db/schema.sql and writes the roster; a second run changes nothing", async () => {
    const r = sync(ROSTER, "--apply");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /applied/);
    const first = await rows();
    assert.deepEqual(
      first.map(({ email, name, dept, active }) => ({ email, name, dept, active })),
      [
        { email: "doc.one.alt@example.com", name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป", active: true },
        { email: "doc.one@example.com", name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป", active: true },
        { email: "doc2@example.com", name: SARA_AM, dept: null, active: true },
      ],
    );
    const again = sync(ROSTER, "--apply");
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /unchanged: 3\nnothing to change\n$/);
    assert.deepEqual(await rows(), first, "nothing rewritten (updated_at kept)");
  });

  test("--apply deactivates rows missing from the CSV, updates and reactivates them; never deletes a row", async () => {
    const changed = ["email,name,dept", "doc.one@example.com,สมชาย ใจดี,ศัลยกรรมระบบปัสสาวะ", `doc2@example.com,${SARA_AM},`].join("\n");
    const r = sync(changed, "--apply");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /changed \(1\):\n {2}~ doc\.one@example\.com {2}dept "ศัลยกรรมทั่วไป" -> "ศัลยกรรมระบบปัสสาวะ"\n/);
    assert.match(r.out, /deactivated \(1\):\n {2}- doc\.one\.alt@example\.com/);
    let now = await rows();
    assert.equal(now.length, 3, "the row is kept");
    assert.deepEqual(now.map((x) => [x.email, x.active, x.dept]), [
      ["doc.one.alt@example.com", false, "ศัลยกรรมทั่วไป"],
      ["doc.one@example.com", true, "ศัลยกรรมระบบปัสสาวะ"],
      ["doc2@example.com", true, null],
    ]);
    // back on the roster: reactivated (stdin this time)
    const back = sync(ROSTER, "-", "--apply");
    assert.equal(back.code, 0, back.err);
    assert.match(back.out, /reactivated \(1\):\n {2}\^ doc\.one\.alt@example\.com/);
    now = await rows();
    assert.deepEqual(now.map((x) => [x.email, x.active, x.dept]), [
      ["doc.one.alt@example.com", true, "ศัลยกรรมทั่วไป"],
      ["doc.one@example.com", true, "ศัลยกรรมทั่วไป"],
      ["doc2@example.com", true, null],
    ]);
  });

  test("refuses invalid rows (with line numbers), a CSV inside the repository, a folder, non-UTF-8 input, a malformed DATABASE_URL (not echoed); writes nothing", async () => {
    const before = await rows();
    const bad = sync("email,name,dept\ndoc.one@example.com,A,\nDOC.ONE@example.com,B,\nnope,C,\n", "--apply");
    assert.equal(bad.code, 1);
    assert.match(bad.err, /line 3: duplicate email doc\.one@example\.com \(first on line 2\)/);
    assert.match(bad.err, /line 4: invalid email "nope"/);
    assert.match(bad.err, /2 problem\(s\) in .*; nothing was written/);
    const inside = sync(null, "--apply", "package.json");
    assert.equal(inside.code, 1);
    assert.match(inside.err, /must live outside the repository/);
    const latin = join(dir, "latin.csv");
    writeFileSync(latin, Buffer.from("email,name,dept\na@example.com,\xe0\xb8,\n", "latin1"));
    const notUtf8 = sync(null, "--apply", latin);
    assert.equal(notUtf8.code, 1);
    assert.match(notUtf8.err, /is not UTF-8 text/);
    const usage = sync(null, "--apply");
    assert.equal(usage.code, 2);
    const folder = sync(null, "--apply", dir);
    assert.equal(folder.code, 1);
    assert.match(folder.err, /^cannot read .*: EISDIR\n$/, "its own message, no stack trace");
    const badUrl = syncWith("postgres://user:s3cretpw@ho st:5432/db", ROSTER, "--apply");
    assert.equal(badUrl.code, 1);
    assert.equal(badUrl.err, "DATABASE_URL is not a valid URL (set it in env or .env.local)\n");
    assert.deepEqual(await rows(), before);
  });

  test("off the roster but approved in Telegram: reported with the revoking UPDATE, dry run and --apply", async () => {
    await pool.query("DELETE FROM access_requests WHERE email LIKE 'doc%@example.com'");
    await pool.query(
      `INSERT INTO access_requests (email, line_sub, first_name, last_name, position, status, decided_at)
       VALUES ('doc.one.alt@example.com', 'U1', 'ก', 'ข', 'doctor', 'approved', now()),
              ('doc2@example.com', 'U2', 'ก', 'ข', 'doctor', 'approved', now())`,
    );
    try {
      const without = ["email,name,dept", "doc.one@example.com,สมชาย ใจดี,ศัลยกรรมทั่วไป", `doc2@example.com,${SARA_AM},`].join("\n");
      const warning =
        /off the roster but still authorized by an approved access request \(1\), so they keep signing in:\n {2}! doc\.one\.alt@example\.com\n.*\n {2}UPDATE access_requests SET status = 'rejected', decided_at = now\(\) WHERE status = 'approved' AND email IN \('doc\.one\.alt@example\.com'\);\n/;
      const dry = sync(without);
      assert.equal(dry.code, 0, dry.err);
      assert.match(dry.out, warning);
      const r = sync(without, "--apply");
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /applied \(the site sees it within 60 s\)\n/);
      assert.match(r.out, warning);
      // still reported on the next run while the request stands; never for an email on the roster (doc2)
      assert.match(sync(without).out, warning);
      await pool.query("UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE email = 'doc.one.alt@example.com'");
      assert.doesNotMatch(sync(without).out, /approved access request/);
    } finally {
      await pool.query("DELETE FROM access_requests WHERE email LIKE 'doc%@example.com'");
      assert.equal(sync(ROSTER, "--apply").code, 0);
    }
  });

  test("--apply refuses to deactivate more than 5 rows and 10% of the active ones unless --allow-mass-deactivate", async () => {
    const big = [ROSTER, ...Array.from({ length: 8 }, (_, i) => `mass${i}@example.com,หมอ ${i},`)].join("\n");
    assert.equal(sync(big, "--apply").code, 0); // 11 active
    const before = await rows();
    const partial = ROSTER; // e.g. one department's sheet: 8 of 11 would go
    const dry = sync(partial);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /--apply will refuse this: it deactivates 8 of 11 active physicians at once/);
    const refused = sync(partial, "--apply");
    assert.equal(refused.code, 1);
    assert.match(refused.out, /deactivated \(8\):/);
    assert.match(refused.err, /^refused, nothing was written: this deactivates 8 of 11 active physicians at once .*--allow-mass-deactivate/);
    assert.deepEqual(await rows(), before, "nothing written");
    const allowed = sync(partial, "--apply", "--allow-mass-deactivate");
    assert.equal(allowed.code, 0, allowed.err);
    assert.match(allowed.out, /applied/);
    assert.equal((await rows()).filter((x) => x.active).length, 3);
  });
});
