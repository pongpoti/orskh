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

  test("roster: canonical numbers, Thai names kept (NFC, single spaces), empty dept is null, blank lines skipped", () => {
    const { entries, errors } = parseRoster(
      [
        " Phone , NAME ,Dept",
        ` 081-234-5678 ,"สมชาย   ใจดี ", ศัลยกรรมทั่วไป `,
        "",
        "０９０-０００-０００２,สมหญิง รักดี,",
        `+66 80 000 0002,${SARA_AM.normalize("NFD")},"ศัลยกรรม, ออร์โธปิดิกส์"`,
        "",
      ].join("\r\n"),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(entries, [
      { line: 2, phone: "0812345678", name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป" },
      { line: 4, phone: "0900000002", name: "สมหญิง รักดี", dept: null },
      { line: 5, phone: "0800000002", name: SARA_AM, dept: "ศัลยกรรม, ออร์โธปิดิกส์" },
    ]);
  });

  test("roster: every problem is reported with its line number", () => {
    const { errors } = parseRoster(
      [
        "phone,name,dept",
        "0812345678,สมชาย,",
        "not-a-number,สมหญิง,",
        "081-234-5678,ซ้ำ,",
        "0900000101,  ,ศัลยกรรม",
        "0900000102,only two",
        "0900000103,a,b,c",
        `0900000104,${"ก".repeat(201)},`,
        "0900000105,bad\u0007name,",
        "0900000106,\u202Eevil,",
        "0900000107,ชื่อ,\u2066ตา\u2069",
        "021234567,โทรศัพท์บ้าน,",
      ].join("\n"),
    );
    assert.deepEqual(errors, [
      'line 3: invalid Thai mobile number "not-a-number"',
      "line 4: duplicate phone 0812345678 (first on line 2)",
      "line 5: name is empty",
      "line 6: expected 3 columns (phone,name,dept), found 2",
      "line 7: expected 3 columns (phone,name,dept), found 4",
      "line 8: name is longer than 200 characters",
      "line 9: name contains control characters",
      "line 10: name contains control characters",
      "line 11: dept contains control characters",
      'line 12: invalid Thai mobile number "021234567"',
    ]);
    // a roster from the email sign-in is refused: its first column is not a phone number
    assert.deepEqual(parseRoster("email,name,dept\ndoc@example.com,A,\n").errors, ["line 1: the header must be phone,name,dept"]);
    assert.deepEqual(parseRoster("tel,name,dept\n0812345678,A,\n").errors, ["line 1: the header must be phone,name,dept"]);
    assert.deepEqual(parseRoster("\n\nphone,name\n").errors, ["line 3: the header must be phone,name,dept"]);
    assert.deepEqual(parseRoster("").errors, ["line 1: the header must be phone,name,dept"]);
    assert.deepEqual(parseRoster("phone,name,dept\n\n").errors, ["no physicians in the CSV (it would deactivate everyone)"]);
  });

  test("diff: added, changed (name or dept), reactivated, deactivated; nothing is ever deleted", () => {
    const current = [
      { phone: "0810000001", name: "เหมือนเดิม", dept: null, active: true },
      { phone: "0810000003", name: "ชื่อเก่า", dept: "ศัลยกรรม", active: true },
      { phone: "0810000002", name: "ย้ายแผนก", dept: null, active: true },
      { phone: "0810000004", name: "กลับมา", dept: null, active: false },
      { phone: "0810000005", name: "ลาออก", dept: "ตา", active: true },
      { phone: "0810000006", name: "ลาออกนานแล้ว", dept: null, active: false },
    ];
    const { entries } = parseRoster(
      [
        "phone,name,dept",
        "0810000001,เหมือนเดิม,",
        "0810000003,ชื่อใหม่,ศัลยกรรม",
        "0810000002,ย้ายแผนก,สูติ",
        "0810000004,กลับมา,หู คอ จมูก",
        "0810000007,คนใหม่,",
      ].join("\n"),
    );
    const d = diffRoster(current, entries);
    assert.deepEqual(d.added.map((e) => e.phone), ["0810000007"]);
    assert.deepEqual(d.changed.map((e) => e.phone), ["0810000002", "0810000003"]);
    assert.deepEqual(d.reactivated.map((e) => [e.phone, e.dept]), [["0810000004", "หู คอ จมูก"]]);
    assert.deepEqual(d.deactivated.map((r) => r.phone), ["0810000005"], "inactive rows stay as they are");
    assert.equal(d.unchanged, 1);
    assert.equal(isEmptyDiff(d), false);
    assert.deepEqual(formatDiff(d), [
      "added (1):",
      "  + 0810000007  คนใหม่",
      "changed (2):",
      '  ~ 0810000002  dept - -> "สูติ"',
      '  ~ 0810000003  name "ชื่อเก่า" -> "ชื่อใหม่"',
      "reactivated (1):",
      "  ^ 0810000004  กลับมา (หู คอ จมูก)",
      "deactivated (1):",
      "  - 0810000005  ลาออก (ตา)",
      "unchanged: 1",
    ]);
    const same = diffRoster(current.slice(0, 1), entries.slice(0, 1));
    assert.equal(isEmptyDiff(same), true);
    assert.deepEqual(formatDiff(same), ["unchanged: 1"]);
    // off the roster afterwards: deactivated now, or inactive already and still missing from the CSV
    assert.deepEqual(offRoster(current, entries), ["0810000005", "0810000006"]);
  });

  test("mass deactivation: more than 5 rows and more than 10% of the active ones", () => {
    const rows = (n: number, active = true) =>
      Array.from({ length: n }, (_, i) => ({ phone: `08100001${String(i).padStart(2, "0")}`, name: "ก", dept: null, active }));
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
    assert.deepEqual(formatStillApproved(["0810000005", "0810000006'"]), [
      "off the roster but still authorized by an approved access request (2), so they keep signing in:",
      "  ! 0810000005",
      "  ! 0810000006'",
      "  revoke in SQL if they should lose access (takes effect within 60 s):",
      "  UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE status = 'approved' AND phone IN ('0810000005', '0810000006''');",
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
    const { rows } = await pool.query<{ phone: string; name: string; dept: string | null; active: boolean; updated_at: Date }>(
      "SELECT phone, name, dept, active, updated_at FROM physicians ORDER BY phone",
    );
    return rows;
  }

  const ROSTER = [
    "phone,name,dept",
    "+66812345678,สมชาย ใจดี,ศัลยกรรมทั่วไป",
    "080-000-0001,สมชาย ใจดี,ศัลยกรรมทั่วไป",
    `0900000002,${SARA_AM},`,
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
    assert.match(r.out, /CSV: 3 numbers, 2 names/);
    assert.match(r.out, /table physicians does not exist yet/);
    assert.match(r.out, /added \(3\):\n {2}\+ 0800000001 {2}สมชาย ใจดี \(ศัลยกรรมทั่วไป\)\n/);
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
      first.map(({ phone, name, dept, active }) => ({ phone, name, dept, active })),
      [
        { phone: "0800000001", name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป", active: true },
        { phone: "0812345678", name: "สมชาย ใจดี", dept: "ศัลยกรรมทั่วไป", active: true },
        { phone: "0900000002", name: SARA_AM, dept: null, active: true },
      ],
    );
    const again = sync(ROSTER, "--apply");
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /unchanged: 3\nnothing to change\n$/);
    assert.deepEqual(await rows(), first, "nothing rewritten (updated_at kept)");
  });

  test("--apply deactivates rows missing from the CSV, updates and reactivates them; never deletes a row", async () => {
    const changed = ["phone,name,dept", "0812345678,สมชาย ใจดี,ศัลยกรรมระบบปัสสาวะ", `0900000002,${SARA_AM},`].join("\n");
    const r = sync(changed, "--apply");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /changed \(1\):\n {2}~ 0812345678 {2}dept "ศัลยกรรมทั่วไป" -> "ศัลยกรรมระบบปัสสาวะ"\n/);
    assert.match(r.out, /deactivated \(1\):\n {2}- 0800000001/);
    let now = await rows();
    assert.equal(now.length, 3, "the row is kept");
    assert.deepEqual(now.map((x) => [x.phone, x.active, x.dept]), [
      ["0800000001", false, "ศัลยกรรมทั่วไป"],
      ["0812345678", true, "ศัลยกรรมระบบปัสสาวะ"],
      ["0900000002", true, null],
    ]);
    // back on the roster: reactivated (stdin this time)
    const back = sync(ROSTER, "-", "--apply");
    assert.equal(back.code, 0, back.err);
    assert.match(back.out, /reactivated \(1\):\n {2}\^ 0800000001/);
    now = await rows();
    assert.deepEqual(now.map((x) => [x.phone, x.active, x.dept]), [
      ["0800000001", true, "ศัลยกรรมทั่วไป"],
      ["0812345678", true, "ศัลยกรรมทั่วไป"],
      ["0900000002", true, null],
    ]);
  });

  test("refuses invalid rows (with line numbers), a CSV inside the repository, a folder, non-UTF-8 input, a malformed DATABASE_URL (not echoed); writes nothing", async () => {
    const before = await rows();
    const bad = sync("phone,name,dept\n0812345678,A,\n081 234 5678,B,\nnope,C,\n", "--apply");
    assert.equal(bad.code, 1);
    assert.match(bad.err, /line 3: duplicate phone 0812345678 \(first on line 2\)/);
    assert.match(bad.err, /line 4: invalid Thai mobile number "nope"/);
    assert.match(bad.err, /2 problem\(s\) in .*; nothing was written/);
    const inside = sync(null, "--apply", "package.json");
    assert.equal(inside.code, 1);
    assert.match(inside.err, /must live outside the repository/);
    const latin = join(dir, "latin.csv");
    writeFileSync(latin, Buffer.from("phone,name,dept\n0812345678,\xe0\xb8,\n", "latin1"));
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
    await pool.query("DELETE FROM access_requests WHERE phone IN ('0800000001', '0900000002')");
    await pool.query(
      `INSERT INTO access_requests (phone, line_sub, first_name, last_name, position, status, decided_at)
       VALUES ('0800000001', 'U1', 'ก', 'ข', 'doctor', 'approved', now()),
              ('0900000002', 'U2', 'ก', 'ข', 'doctor', 'approved', now())`,
    );
    try {
      const without = ["phone,name,dept", "0812345678,สมชาย ใจดี,ศัลยกรรมทั่วไป", `0900000002,${SARA_AM},`].join("\n");
      const warning =
        /off the roster but still authorized by an approved access request \(1\), so they keep signing in:\n {2}! 0800000001\n.*\n {2}UPDATE access_requests SET status = 'rejected', decided_at = now\(\) WHERE status = 'approved' AND phone IN \('0800000001'\);\n/;
      const dry = sync(without);
      assert.equal(dry.code, 0, dry.err);
      assert.match(dry.out, warning);
      const r = sync(without, "--apply");
      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /applied \(the site sees it within 60 s\)\n/);
      assert.match(r.out, warning);
      // still reported on the next run while the request stands; never for a number on the roster (0900000002)
      assert.match(sync(without).out, warning);
      await pool.query("UPDATE access_requests SET status = 'rejected', decided_at = now() WHERE phone = '0800000001'");
      assert.doesNotMatch(sync(without).out, /approved access request/);
    } finally {
      await pool.query("DELETE FROM access_requests WHERE phone IN ('0800000001', '0900000002')");
      assert.equal(sync(ROSTER, "--apply").code, 0);
    }
  });

  test("--apply refuses to deactivate more than 5 rows and 10% of the active ones unless --allow-mass-deactivate", async () => {
    const big = [ROSTER, ...Array.from({ length: 8 }, (_, i) => `0830000${String(i).padStart(3, "0")},หมอ ${i},`)].join("\n");
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
