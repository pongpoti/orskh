# orskh

Operating-suite board. Staff sign in with LINE and a one-time code sent by SMS, then pick a room on the floor plan to see that day’s cases.

The board shows **today** only, dated in Thai with the Buddhist year (Thailand time, so it turns over at midnight in Bangkok). There is no paging between days. At the weekend and on Thai public and special holidays the suite runs no list, so the board shows no cases and every OR keeps the plain colour with no department. Holidays come from the Bank of Thailand's Financial Institutions' Holidays API (public holidays, substitution days and the special holidays the cabinet announces), fetched again every six hours, plus any dates in `EXTRA_HOLIDAYS` (`src/lib/holidays.ts`). When an export is loaded it covers one week, so each weekday shows that weekday's cases from it; at the weekend the plan is shown with no cases. In development, `/preview?day=tue` shows another weekday of this week and `/preview?holiday=วันปิยมหาราช` shows the holiday view.

## Case data

**No case data is loaded at the moment** (the 28 Sep – 2 Oct 2026 export was removed on 27 Oct 2026), so every room shows as having no cases and the plan follows this week's allocation. Cases come from an export of the OR system, not from a live feed: `python3 scripts/build_week.py path/to/export.xls` (needs `pandas` and `xlrd`) rewrites `src/data/week-data.ts`. Only the day, department, status, procedure name, surgeon and shift are kept; patient fields never reach the repo.

- Rows whose `วันที่` equals `วันที่ผ่าตัด` are dropped (same-day entries).
- Following the utilisation report, Tha Chalom hospital cases are cut, and so is vascular surgery on Tuesday to Thursday (Tha Chalom's quota).
- The export's room column is not trusted and is not even stored. Every case is placed by the report's rules: dressing cases go to OR 1, emergency cases to OR 8 (obstetrics-gynaecology stays in its own room), and anything else to a room its department holds that day, spread across them when it holds several. A case whose department holds no room that day is left off the board.
- OR 1 is exclusive to dressing cases from any sub-specialty, checked before everything else (even emergency). A case is a dressing case when its operation name matches the hospital's keyword regex (dressing, d/s, ds and dw as whole words, ทำแผล, ล้างแผล, เปลี่ยนแผล, change vac, vac d) and does not also name debridement/db, scrub, graft, suture, closure, escharotomy, fasciotomy, excision, incision or amputation. The hospital's last step (every item in the operation-items column must be a dressing) is skipped because the export has no such column, so this is the broader definition.
- The SCOPE room (OR 3) is exclusive: it takes only cases by a GENSX-labelled surgeon whose operation name matches `egd, gastroscop, esophagoscop, ogd, colono, sigmoido, ercp, endoscop, eus` (case-insensitive, whole word for the short ones) and does not match `remove fb, foreign body, fb`. Such cases go nowhere else; other general-surgery cases use the GENSX rooms. The export has one operation-name column, so only that is matched.
- The export has no start or end times, so cases are listed by position (ลำดับ), with the shift flagged when it is out of hours.
- Surgeons are matched to the supplied physician list (`src/lib/physicians.ts`). Who may sign in is a separate list, the `users` table (see Sign-in).

Room allocation comes from the proposed OR schedule (ตารางห้องผ่าตัดที่เสนอ, 27 Oct 2026; `src/lib/allocation.ts`). Every OR has one department all day, except OR 10 on Friday (vascular in the morning, nephrology in the afternoon) and OR 5 on Tuesday, which is paediatric surgery in weeks 2 and 4 of the month and general surgery in weeks 1, 3 and 5. Periods the schedule marks as over quota (*) are shown like any other. The per-department half-day periods are checked by a test against the schedule's legend (130 a week). Department names and colours come from the hospital's department colour list (October 2026); each OR takes its department's colour and code as its label (OR 1 reads "dressing", vascular reads "VASCULAR"). Three colours are darkened or lightened by an invisible amount so their labels clear 4.5:1. Every OR is filled with its department's colour for the day, whether or not it has cases; a room with no department would use the list's "unknown" gray. Recovery rooms share the service-area beige and the old circulation zone is a walkway.

## Design

The look follows the SAKHONMSO P4P dashboard: shadcn/ui's design language with a deep brown primary and a tan accent, frosted-glass panels over a warm gradient, and an "OR" text mark on a brown tile. Text is Inter for Latin and Noto Sans Thai Looped for Thai (looped letters keep their heads and read better on a phone), with extra line height for Thai. The layout is kept short: one app bar holds the mark, today's date and the account menu (a popover behind the avatar, with a plain sign-out button where popovers are unsupported), and the floor plan takes the rest. On a desktop the plan fills the full height beside the room's case column, which widens with the screen (26rem, 30rem from 1280px, 34rem from 1536px), and the layout spreads to 120rem. Tokens (colour, surfaces, status, shadows) live at the top of `src/app/globals.css`; shared pieces are `.btn` (`-primary`, `-secondary`, `-ghost`), `.field`, `.card`, `.pill`, `.badge`, `.chip` and `.notice`, plus `AuthShell` and `BrandMark` in `src/components`. The app is built to be usable by everyone:

- Text and status pairs meet WCAG AA (4.5:1); department labels are checked by a test.
- One blue focus ring on every control, and keyboard focus on a room outlines its wall.
- Touch targets are at least 44px. Pinch-zoom is left on.
- Colour is never the only cue: room markers differ by shape (live = circle, delayed = diamond), rooms carry a text code, cancelled cases are struck through, and each case's status is read out to screen readers.
- The LINE button keeps LINE's own green and white, which is the one deliberate exception to the contrast rule.


## Stack

Next.js 16, React 19, Tailwind CSS 4, Postgres (Neon in production) through `pg`, `jose` for tokens, [deeSMSX](https://deesmsx.com) for the SMS codes (plain `fetch`, no SDK); the admin page's surgeon list goes through drizzle (`src/db`). The sign-in is the one from skh-or-schedule, restyled for this board.

## Sign-in

1. **LINE Login** (OAuth with PKCE). The LINE account's id is the session's `sub`.
2. **Mobile number and SMS code.** On `/login/verify` (ยืนยันเบอร์มือถือ) the user types a Thai mobile number (10 digits starting 06, 08 or 09; `081-234-5678`, `081 234 5678` and `+66 81 234 5678` all work, Thai digits too) and gets a 6-digit code by SMS. The code works for 5 minutes, once, with 5 attempts. The screen shows the number and the SMS's reference (รหัสอ้างอิง), so the user can tell which SMS is the latest. After the first correct code the LINE account is bound to that number for 180 days, so later visits skip this step.
3. **Authorized?** A number may open the board when it has a current claim on an active user of the `users` table (a claimed name, table `user_claims`), it has an approved access request, or it is in `ALLOWED_PHONES`.
4. **Claim a name (first time).** A correct code for a number that is not authorized yet leads to `/login/claim` (ยืนยันชื่อของคุณ): pick the position (แพทย์, พยาบาล, ผู้ช่วยพยาบาล, พนักงานช่วยเหลือคนไข้), then your own name from the `users` list (searchable by first or last name), then confirm. The first claim of a name wins; a name someone already claimed shows as taken. The name is then bound to the number and the LINE account and the board opens at once; every claim is posted to Telegram with an undo button. Claims are open only while Telegram is set up with at least one person who can press that button (see Telegram); otherwise the code leads straight to the access request. Whoever cannot find their name, or finds it taken, sends an **access request** instead (`/login/request`); an administrator approves or rejects it in Telegram, and the waiting page signs the user in once approved.
5. **Session**: a signed cookie for 30 days. Authorization is checked again on every request (against a list cached for at most 60 s), so a removed number loses access within a minute.

The top bar shows the claimed full name from the `users` table, through the number's current claim (or the name given in an approved access request, otherwise the LINE name). The account menu behind the avatar shows the name, the role (`แพทย์ · ออร์โธปิดิกส์`, `พยาบาล · ห้องผ่าตัด`) and the number (`081-234-5678`).

Every number is stored in one form, `0812345678` (`src/lib/phone.ts`; `scripts/phone.mjs`, used by dev-session, repeats the same rules and a test checks that both agree). deeSMSX is sent `66812345678`.

The live board is [https://orskh.vercel.app](https://orskh.vercel.app). Guests are sent to `/login`.

### How a code is sent

In production (`SMS_PROVIDER=deesmsx`, the default and the only mode allowed on Vercel) deeSMSX makes the code, sends the SMS and checks the code: the app calls `POST /otp/request` (`to`, `sender`, `lang=th`, `isShowRef`) and stores the returned token encrypted (AES-GCM with a key derived from `OTP_PEPPER`), and on a guess calls `POST /otp/verify` with the token and the typed code. The app enforces its own limits on top (they also count sends whose outcome is unclear, see below), the 5-minute life, the 5 attempts and single use, and never logs the API keys, the token or the code; it logs only deeSMSX's reference code (for example `code 102`).

Before deeSMSX is called, a row is reserved in `otp_codes` under a database lock, so the daily cap and the limits hold even for double taps and several servers. What happens to that row depends on whether the SMS may have gone out:

- **Certainly not sent**: one of deeSMSX's documented refusals (99, 9, 100, 102, 204), or the request never left (no DNS answer, connection refused). The row is deleted: the failure uses no quota and starts no countdown.
- **Maybe sent**: no answer within 10 s, a dropped connection, an answer that is not JSON (such as a gateway's HTML 504), 101 ("Unsuccess"), an unknown code, or a success without a usable token. deeSMSX may already have sent and billed the SMS, so the row is kept. It can never be verified, but it counts for the 60 s countdown, every limit and `SMS_DAILY_CAP` like a sent code, so a slow or failing deeSMSX can never be used to send SMS past the limits. Three of these within 15 minutes on one server give a Telegram alert.

What the user sees:

| deeSMSX answer | Message |
| --- | --- |
| 99 (bad number) | ส่ง SMS ไปที่เบอร์นี้ไม่ได้ กรุณาตรวจสอบเบอร์มือถือ |
| 9 (key or secret), 100 (sender), 204 (no OTP template) | ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล, plus a Telegram alert |
| 102 (out of credit) | ขณะนี้ระบบส่ง SMS ไม่ได้ กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล, plus a Telegram alert |
| maybe sent (see above) | ส่งรหัสไม่สำเร็จ หากได้รับ SMS ภายหลัง รหัสนั้นใช้ไม่ได้ กรุณารอ 1 นาทีแล้วขอรหัสใหม่, with a countdown on the button |

A reference (`ref`) in an unexpected format does not fail a delivered code: it is shown cleaned (printable characters, at most 16), or not at all.

If deeSMSX cannot be reached while a code is being checked, the attempt is not counted and the typed code stays in the box for another try. deeSMSX's own expiry (201) or reuse (202) is shown as "รหัสหมดอายุหรือใช้ไปแล้ว กรุณาขอรหัสใหม่".

In local mode (`SMS_PROVIDER=console` or `file`, development and tests only) the app makes the code itself, stores only an HMAC of it (`OTP_PEPPER`), and writes the SMS to the log or to a JSON file `{to, text, code, ref, at}` in `SMS_OUTBOX_DIR`. Limits, cap and screens are the same.

## Environment variables

Copy `.env.example` to `.env.local` for local work. Names only here; values live in Vercel and `.env.local`.

| Name | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | yes | Canonical origin, `https://orskh.vercel.app`. Requests to other hosts are redirected to it in production |
| `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` | yes | LINE Login channel. The secret is server only |
| `SESSION_SECRET` | yes | 32+ characters (`openssl rand -base64 32`). Signs the session and the other sign-in cookies. Rotating it signs everyone out |
| `OTP_PEPPER` | yes | 16+ characters. Key for the stored code HMACs and for encrypting deeSMSX tokens at rest |
| `DATABASE_URL` | yes | Postgres (Neon pooled connection string). Server only |
| `DEESMSX_API_KEY`, `DEESMSX_SECRET_KEY` | yes | deeSMSX API keys (from the API settings in my.deesmsx.com). Server only |
| `DEESMSX_SENDER` | no | SMS sender name. Default `deeSMS.OTP`, deeSMSX's shared OTP sender. Set it to `ORSKH` once that name is approved (see deeSMSX) |
| `SMS_DAILY_CAP` | no | At most this many codes in any 24 hours, for everyone together. Default `300`. See Cost control |
| `ALLOWED_PHONES` | no | Break-glass list of mobile numbers, comma-separated (any common way of writing them). These stay authorized without a database read. Keep it empty or one administrator. Needs a redeploy to change |
| `AUTH_ADMIN_LINE_IDS` | no | Comma-separated LINE user ids (the session's `sub`) of the admins, who may open `/admin`. Unset or empty means no admin. See Admin page |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | for name claims | Sign-in alerts, SMS alerts, access-request decisions, and name claims with their undo button. Chat IDs comma-separated; the numeric (person) IDs are also who may approve and undo. Name claims need both settings and at least one numeric ID; without them every new number goes to the access request. Off when either is unset |
| `BOT_API_TOKEN` | no | Bank of Thailand API token for the Financial Institutions' Holidays API (free, from [portal.api.bot.or.th](https://portal.api.bot.or.th)). Server only. Without it only weekends and `EXTRA_HOLIDAYS` close the board |
| `EXTRA_HOLIDAYS` | no | Closures the API does not list, comma-separated `YYYY-MM-DD`, each optionally `=name` |
| `SMS_PROVIDER`, `SMS_OUTBOX_DIR`, `DEESMSX_API_URL`, `LINE_AUTH_URL`, `LINE_API_URL`, `TELEGRAM_API_URL` | dev only | Local SMS mode (`console` or `file`), the mock deeSMSX, mock LINE and Telegram. Ignored when `VERCEL` is set: there the app always uses the real deeSMSX |

If `DATABASE_URL` or the deeSMSX keys are missing in production, pages still build and serve, the sign-in endpoints answer "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล", and the log names the missing variables.

### LINE

In the LINE Developers console, open the Login channel and set the callback to:

`https://orskh.vercel.app/api/auth/line/callback`

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout. Issue a new channel secret if the current one was ever pasted into a chat, ticket or commit.

### deeSMSX

Setup, in order (prices as listed by deeSMSX in October 2026; check before paying):

1. Register at [deesmsx.com](https://deesmsx.com) with the hospital's or your own details. The free trial cannot use the API, so it is no use for this app.
2. Buy the **Starter** package (350 THB plus VAT). Credits are per SMS; a Thai message of up to 70 characters is one SMS.
3. In my.deesmsx.com, open the API settings and copy the **apiKey** and **secretKey** into Vercel as `DEESMSX_API_KEY` and `DEESMSX_SECRET_KEY` (Production only, marked sensitive). Never paste them into a chat, ticket or commit; if that happens, issue new ones there.
4. Set up the **OTP template** in my.deesmsx.com (without one, deeSMSX answers 204 "Please Settings In my.deesmsx.com"). Keep it short and Thai, with the code and **no link**, for example `รหัส ORSKH ของคุณคือ {code} ใช้ได้ 5 นาที ห้ามบอกผู้อื่น` (use the code placeholder deeSMSX shows in its editor). Do **not** put the reference in the template: the app sends `isShowRef=1`, so deeSMSX appends ` [Ref : XXXX]` itself. The template plus that suffix must stay within 70 Thai characters (one SMS): the example is 56 characters, 69 with the suffix, so add nothing to it. deeSMSX makes a 6-digit code, which is what the app requires. Set its validity to 5 minutes if deeSMSX offers the setting; the app stops accepting a code after 5 minutes anyway.
5. Start with the shared sender **deeSMS.OTP** (leave `DEESMSX_SENDER` unset). It works at once, but users see deeSMSX's name, not ours, and deeSMSX sends its own fixed OTP text (code and reference): deeSMSX says the system sender's text cannot be edited. The template from step 4 takes effect only once `DEESMSX_SENDER=ORSKH` is approved and set (step 6).
6. Then ask deeSMSX to **whitelist the sender name `ORSKH`**: send the request with a copy of your ID card. Approval takes about 1 to 2 working days. Choose carefully: on packages under 5,000 THB the name cannot be changed later. Once approved, set `DEESMSX_SENDER=ORSKH` in Vercel and redeploy.
7. Deploy, sign in once yourself with your own number and check that the SMS arrives and shows the same reference as the screen. On `deeSMS.OTP` expect deeSMSX's standard wording, not your template. After switching to `ORSKH`, check again: your template's text, the reference exactly once, and one credit used per code in my.deesmsx.com.

deeSMSX has no sandbox; local work and the tests use the mock (`tests/mock-deesmsx.mjs`) or local mode instead.

What the deeSMSX documentation leaves open, and how the app copes: it says deeSMSX makes a 6-digit code (which matches the app) but not how long a code lives (the app keeps its own 5-minute limit), whether errors always come with an error status (the examples use HTTP 500; the app reads the JSON whatever the status, and treats an answer it cannot read as "maybe sent"), whether the reference code arrives as `error` or `code`, as text or a number (both are accepted), or what rate limits deeSMSX applies (the app's own limits are well below any likely one).

### Thai SMS rules

- **No links** in the code SMS. Thai operators filter messages with links, more so from senders that are not registered, and a code SMS needs none.
- **Registered sender names only.** A sender name must be approved for the provider before it can be used (the whitelist step above); until then use the provider's shared sender.
- **One SMS = 70 Thai characters** (140 English characters by deeSMSX's count). A longer Thai text is billed as two or more. The template above plus deeSMSX's ` [Ref : XXXX]` fits in one, with 1 character to spare.
- Send only the code, to the person who asked for it, and nothing for marketing.

### Cost control

Every code is a paid SMS, so sending is capped:

- **Per person**: 3 codes per number per 15 minutes, 6 per number and LINE account per 24 hours, 5 per LINE account per hour, at most 5 different numbers per LINE account per 24 hours, 20 per IP address per hour, 60 s between sends. A send deeSMSX certainly refused counts for none of these; one that may have gone out (a timeout, an unreadable answer) counts like a sent code.
- **For everyone together**: `SMS_DAILY_CAP` codes in any 24 hours (default 300, a rolling window). At the cap nobody gets a code: the page says "ระบบส่ง SMS ครบจำนวนของวันนี้แล้ว กรุณาลองใหม่ภายหลัง หรือติดต่อผู้ดูแล" and Telegram is told once an hour. People already bound to their LINE account still sign in, since they need no code. If the cap is reached by real use, raise it in Vercel and redeploy.
- **Telegram alerts** (when Telegram is set up): when half the cap is used in 24 hours, when the cap is reached, when deeSMSX's credit drops under 100, when credit runs out, when deeSMSX refuses our settings, and when three sends within 15 minutes end without knowing whether the SMS went out. Each kind is sent at most once an hour (credit and volume once every 6 hours) per server.
- Access-request decisions send no SMS: the waiting page signs the user in by itself.

### Telegram (needed for name claims)

Create a bot with @BotFather and put its token in `TELEGRAM_BOT_TOKEN`. Use a bot of its own, not skh-or-schedule's: a bot has a single webhook, and each app takes it over when it registers, so taps on one app's messages would reach the other. The same people can press **Start** in both bots and use the same chat IDs. (The buttons also carry an orskh-only tag, so a stray tap from the other app is refused rather than deciding a request here.) Each person who should get alerts and decide requests presses **Start** in the bot; put their numeric chat IDs in `TELEGRAM_CHAT_ID`. The app registers its own webhook (`/api/telegram/webhook`) and derives the webhook secret from the bot token and `SESSION_SECRET`, so there is nothing else to set. Every SMS-code sign-in sends an alert with the name, LINE name, number and time, every name claim sends a message with an undo button (see Claims), plus the SMS alerts above.

The undo button is the only check on a claim, so **claims are open only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, valid, and `TELEGRAM_CHAT_ID` holds at least one numeric (person) chat ID**: group IDs (negative) and `@channel` names get the messages, but only a person's ID may press a button. Without that, the claim page, its list and `POST /api/auth/claim` send everyone to the access request, and access requests save but wait until decided in SQL. A claim whose message could not be sent even after one retry (Telegram down, a revoked token) still stands; find it with the "unannounced claims" query under Claims.

## Who may sign in (table `users`)

The list of people who may claim their name is the Postgres table `users`. It is **shared with the rest of the project**: another workstream created it in production (Neon) and loaded it (196 rows), and it owns it. The agreement with its owner: ids stay stable, a removal is `active = false` (never a delete), and the sign-in never adds columns to `users` and never writes it at runtime; the claims live in their own table, `user_claims`, which references `users(id)`. The production DDL is:

```sql
CREATE TABLE users (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, first_name text NOT NULL CHECK (btrim(first_name) <> ''), last_name text NOT NULL CHECK (btrim(last_name) <> ''), type text NOT NULL CHECK (type IN ('DR','RN','PN','PCA')), subtype text NOT NULL CHECK (btrim(subtype) <> ''), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT users_name_key UNIQUE (first_name, last_name));
```

`db/schema.sql` (applied by the app on first use) holds the same statement as `CREATE TABLE IF NOT EXISTS users (...)`, so it is a no-op where the table exists and gives a local database the identical table (a unit test compares the two texts and the resulting catalogs, and checks that applying the schema to a filled `users` writes nothing). `type` is `DR`, `RN`, `PN` or `PCA`; `subtype` is a code (doctors: the department, e.g. `ORTHO`, `GENSX`, `ANES`; nurses and aides: `OR` or `ANES`). It holds names only; the numbers come from the claims. One row per person (first and last name are unique). The app only reads the table: changes apply within 60 s, with no redeploy.

**Until people have claimed their names, only `ALLOWED_PHONES` and approved access requests can sign in.** In production the table is already loaded, so there is nothing to load. To load or update it from a CSV, use the sync script with a file kept **outside** this repository (UTF-8, header `first_name,last_name,type,subtype`; in Excel, Save As "CSV UTF-8"); the script refuses a file inside the repository:

```bash
npm run sync-users -- /path/outside/repo/all-users.csv           # dry run: prints the changes
npm run sync-users -- /path/outside/repo/all-users.csv --apply   # writes them in one transaction
```

Example file (invented names):

```csv
first_name,last_name,type,subtype
สมชาย,ใจดี,DR,ORTHO
ปราณี,สายบุญ,RN,OR
สุดา,คำดี,PN,ANES
```

It reads `DATABASE_URL` from the environment or `.env.local`, prints the target database without credentials, the changes (names included, for your review) and a summary of counts per type. Rows are matched by first and last name (the table's unique key); a person whose type changes keeps their row and their claim, with the new type and subtype. It never sets an id (the table numbers new rows), never deletes a row (people missing from the CSV are set inactive; a claimed name that goes inactive stops signing in, and the dry run marks those), sets `updated_at` on every row it changes, never touches `user_claims`, refuses the whole file on a bad line (naming the line: wrong column count, unknown type, empty or malformed subtype, a duplicate name), and refuses to deactivate more than 5 rows and 10% of the list at once unless `--allow-mass-deactivate` is added. It is the only writer of `users` on the sign-in side; coordinate with the table's owner before running `--apply` against production.

Single edits in the Neon SQL editor (deactivate, never delete):

```sql
-- add or bring back one person
INSERT INTO users (first_name, last_name, type, subtype) VALUES ('ชื่อ', 'นามสกุล', 'DR', 'GENSX')
ON CONFLICT ON CONSTRAINT users_name_key DO UPDATE SET type = excluded.type, subtype = excluded.subtype, active = true, updated_at = now();

-- correct a spelling (the claim stays: it points at the id)
UPDATE users SET last_name = 'นามสกุลใหม่', updated_at = now() WHERE id = 42;

-- remove (the row stays, inactive; its claimed number stops signing in within 60 s)
UPDATE users SET active = false, updated_at = now() WHERE id = 42;
```

The surgeon list in `src/lib/physicians.ts` is only for matching surgeons in the case data; it does not decide who can sign in.

### Claims (table `user_claims`)

Every claim is a row of `user_claims` (`user_id`, `phone`, `line_sub`, `line_name`, `created_at`, `ip`, `undone_at`, `undone_by`, `undo_reason`, `tg_messages`), never deleted. A user's **current claim** is their row with `undone_at IS NULL`; partial unique indexes allow at most one current claim per user, per number and per LINE account. A number is authorized while it has a current claim on an **active** user; the board's name and role come from `users` through that claim.

A claim is one transaction: an `INSERT INTO user_claims` that reads the user in the same statement (it must exist and be active) and is guarded by those indexes, so of two people claiming at once exactly one wins (the other is told the name is taken), and neither the number nor the LINE account can hold a second name (one LINE account, one number, one name). The LINE account is bound to the number in the same transaction. A number with an access request (pending, approved, or rejected less than 24 hours ago) cannot claim, and a number that holds a name cannot file a request: claims and requests of one number exclude each other. Each LINE account and each number may try 5 claims per 24 hours. Every claim is posted to every chat in `TELEGRAM_CHAT_ID`:

```
🪪 ยืนยันชื่อ: สมชาย ใจดี (แพทย์ · ออร์โธปิดิกส์)
เบอร์ 081-234-5678 · LINE: ต้นข้าว
เวลา 29 ต.ค. 2569 08:15 น.
```

with one button, **↩️ ยกเลิกการยืนยัน** (`oc:<claim id>:u`). An administrator who taps it ends the claim (`undone_at`, `undone_by` = their Telegram id, `undo_reason = 'admin'`, in one conditional update, so a second tap or an old message changes nothing), which frees the name; the number's LINE bindings are removed, and the person is signed out (at once on the server that got the tap, within 60 s on the others). The message is edited to say who undid it. After an administrator's undo, that number and that LINE account cannot claim any name for 24 hours; they can still send an access request. `users` is never written by a claim or an undo.

`undo_reason` says how a claim ended: `admin` (the undo button; the only one that starts the 24-hour block), `inactive` (closed by the app when the same number or LINE account claims again while its earlier name is inactive, see Spelling fixes), `manual` (released by hand in SQL).

```sql
-- who claimed what (current claims have undone_at NULL)
SELECT c.id, u.first_name, u.last_name, u.type, u.active, c.phone, c.line_name, c.created_at, c.undone_at, c.undo_reason
FROM user_claims c JOIN users u ON u.id = c.user_id ORDER BY c.created_at DESC;

-- claims whose Telegram message reached nobody (check them; release by hand if wrong)
SELECT c.id, u.first_name, u.last_name, c.phone, c.created_at
FROM user_claims c JOIN users u ON u.id = c.user_id
WHERE c.tg_messages = '[]'::jsonb AND c.undone_at IS NULL;

-- release a claim by hand: frees the name and signs the number out within 60 s, without the 24-hour block
-- (to block as the undo button does, use undo_reason = 'admin' instead)
BEGIN;
UPDATE user_claims SET undone_at = now(), undo_reason = 'manual' WHERE id = 7 AND undone_at IS NULL;
DELETE FROM line_bindings WHERE phone = '0812345678';
COMMIT;

-- give a name a number without the claim page (e.g. for someone who cannot use it)
INSERT INTO user_claims (user_id, phone, line_sub, line_name) VALUES (42, '0812345678', 'manual-42', 'by hand');
```

(`line_sub` is required and unique among current claims; for a hand-made claim use any text that is not a real LINE id, as above.)

**Spelling fixes.** Best done in the table first (`correct a spelling` above): the claim stays, since it points at the id. If the corrected spelling reached the table as a new row through the CSV instead, the old row is set inactive and its claim stops authorizing; the person signs in again (LINE, SMS code) and picks the corrected name. Their old claim on the inactive row is then closed automatically (`undo_reason = 'inactive'`, no undo needed and no 24-hour block). The new claim is announced like any other.

To find a person's LINE user id (for `AUTH_ADMIN_LINE_IDS`), look it up by **their own number, confirmed with them in person**, never by name: a name is self-claimed and could be held by someone else until an undo. `SELECT line_sub FROM line_bindings WHERE phone = '0812345678'` (see Admin page). Before adding the id, check that the number's current claim is theirs: `SELECT u.first_name, u.last_name, c.line_sub, c.created_at FROM user_claims c JOIN users u ON u.id = c.user_id WHERE c.phone = '0812345678' AND c.undone_at IS NULL`.

The old `staff_registrations` table (Auth.js registration; `src/db/schema.ts`, `drizzle/0000`) is no longer used and is left in place; nothing reads or writes it. The rest of `src/db` and `drizzle/` is still in use: the `surgeons` table (`drizzle/0001`) is read and written by `/admin` (see Admin page).

## Access requests (names not on the list)

For someone whose name is missing from the `users` list or already claimed (and for everyone while claims are off, see Telegram): the claim page links to `/login/request`, which shows the verified number and asks for first name, last name and position (แพทย์, พยาบาล, ผู้ช่วยพยาบาล, พนักงานช่วยเหลือคนไข้; stored as `DR`, `RN`, `PN`, `PCA`). A number with a request goes straight to its request after the code. The request goes to every chat in `TELEGRAM_CHAT_ID` with approve and reject buttons; the first tap decides. On approval the waiting page (checked every 10 s) signs in by itself; no SMS is sent. Someone who closed the page signs in again later with LINE and another SMS code. After a rejection the same number cannot ask again for 24 hours, and cannot claim a name instead. A number that holds a name is told to sign in instead of filing a request. One pending request per number, at most 3 requests per LINE account per 24 hours.

An approved request keeps working whatever happens in `users` or `user_claims` (an undo of a claim of the same number says so in its Telegram answer instead of "signed out"), so revoke it on its own:

```sql
SELECT id, phone, first_name, last_name, position, status, created_at, decided_at
FROM access_requests ORDER BY created_at DESC;

UPDATE access_requests SET status = 'rejected', decided_at = now()
WHERE phone = '0812345678' AND status = 'approved';
```

## Switching from Auth.js

Checklist for the first deploy of this sign-in:

1. Set up deeSMSX (steps 1 to 5 under deeSMSX). Ask for the `ORSKH` sender name at the same time; the shared sender works meanwhile.
2. In Vercel, add: `APP_URL` (`https://orskh.vercel.app`), `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `OTP_PEPPER`, `DEESMSX_API_KEY`, `DEESMSX_SECRET_KEY`. For name claims: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` with at least one person's numeric chat ID (without them everyone goes through access requests decided in SQL). Optional: `ALLOWED_PHONES`, `SMS_DAILY_CAP`, `DEESMSX_SENDER`. `DATABASE_URL`, `BOT_API_TOKEN` and `EXTRA_HOLIDAYS` stay as they are. `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` take the values of the old `AUTH_LINE_ID` and `AUTH_LINE_SECRET`.
3. In Vercel, remove: `AUTH_SECRET`, `AUTH_LINE_ID`, `AUTH_LINE_SECRET`, `AUTH_TRUST_HOST`, `AUTH_TEST_MODE`, `AUTH_LINE_ALLOWLIST`, and anything left from the email version of this sign-in (`SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `ALLOWED_EMAILS`). Make sure `SMS_PROVIDER`, `SMS_OUTBOX_DIR` and `DEESMSX_API_URL` are not set (they are ignored on Vercel anyway). `AUTH_ADMIN_LINE_IDS` stays as it is: its values are LINE user ids, the new session's `sub`, same as before.
4. If a preview of the email version or an earlier version of this branch ever ran against this database, its sign-in tables must go before the first deploy (the app creates them again; no production sign-in data exists yet). In the Neon SQL editor: `DROP TABLE IF EXISTS otp_codes, line_bindings, login_events, physicians, staff_claims, staff, access_requests;` (`physicians`, `staff` and `staff_claims` are the sign-in lists of earlier versions of this branch.) **Never drop `users`**: it belongs to the rest of the project and holds the list; the sign-in only reads it, and `user_claims` is created next to it.
5. In the LINE console, add the callback `https://orskh.vercel.app/api/auth/line/callback` (the old `/api/auth/callback/line` can be removed afterwards).
6. Nothing to load: production already has the `users` table with the list (created and loaded by the rest of the project). The first request creates the sign-in tables, `user_claims` included, next to it and leaves `users` as it is. Anyone on the list, you included, can claim their own name right after the SMS code; nobody has to go first. Use `ALLOWED_PHONES` only for a break-glass number that holds no name: a number there goes straight to the board and never reaches the claim page. (To change the list later: `npm run sync-users`, dry run then `--apply`, or the SQL under Who may sign in, agreed with the table's owner.)
7. Deploy. Everyone signed in with Auth.js is signed out once and signs in again with LINE and an SMS code.
8. Sign in once yourself with your own number and check the SMS (sender, the reference shown exactly once, no link; on `deeSMS.OTP` the wording is deeSMSX's own), pick your name on `/login/claim`, and check the Telegram message and its undo button.

## Admin page

Admins (the LINE user ids in `AUTH_ADMIN_LINE_IDS`, compared with the session's `sub`) see a "จัดการแพทย์" button in the top bar (an icon on phones, labelled from 768px, left out below 390px so the date keeps its year) and the same link in the account menu, both opening `/admin`. Everyone else gets a not-found page there, and every save is checked against the admin list again on the server. An admin still signs in like everyone else (LINE, SMS code, an authorized number); the admin list only adds the page.

To find someone's LINE user id, have them sign in once, then look it up in the Neon SQL editor and add it to `AUTH_ADMIN_LINE_IDS` (comma-separated, redeploy to apply):

```sql
SELECT line_sub, display_name, last_login_at FROM line_bindings WHERE phone = '0812345678';
```

The ids are the same LINE user ids Auth.js used, so a list set before the switch keeps working.

The page holds **รายชื่อแพทย์**, the surgeon list, with search, a specialty filter, and add, edit and delete. Specialty is a dropdown of department codes. Names are stored with invisible format characters (zero-width spaces, direction marks, soft hyphens) removed, runs of spaces evened out and Unicode NFC applied, and each name can appear once. The list is stored in the `surgeons` table. Nothing else reads it yet: the case board still matches surgeons to `src/lib/physicians.ts`, and who may sign in is the separate `users` table (see Sign-in).

The admin page reaches the database through `src/db` (drizzle, Neon's HTTP driver). Its tables are created by the SQL files in `drizzle/`, run in order against the database (Neon's SQL editor works). `0001_surgeons.sql` creates `surgeons` and seeds it with the 76 surgeons supplied on 27 Oct 2026 (`src/data/surgeons.ts`). The seed only runs while the table's id sequence has never been used, so running the file again never brings back names the admin deleted.

## Local development

Requirements: Node 22, npm, a local Postgres.

```bash
npm install
cp .env.example .env.local      # fill in values; .env.local is gitignored
node tests/mock-line.mjs &      # mock LINE Login on :4010 (uses LINE_CHANNEL_ID/SECRET from .env.local)
npm run dev                     # http://localhost:3000
```

For local work set `APP_URL=http://localhost:3000`, `LINE_AUTH_URL=http://localhost:4010/oauth2/v2.1/authorize`, `LINE_API_URL=http://localhost:4010`, `SMS_PROVIDER=file` and `SMS_OUTBOX_DIR=<folder outside the repo>`. No SMS is sent: each code is written as a JSON file `{to, text, code, ref, at}` into that folder (`SMS_PROVIDER=console` prints it in the terminal instead). No deeSMSX keys are needed in local mode.

To try the deeSMSX path without sending anything, run the mock instead: `node tests/mock-deesmsx.mjs &` (port 4011), then set `SMS_PROVIDER=deesmsx`, `DEESMSX_API_URL=http://localhost:4011/v1` and any `DEESMSX_API_KEY` / `DEESMSX_SECRET_KEY` (the mock takes them from `.env.local`). The codes it "sends" are listed at `http://localhost:4011/__control/sms`.

To skip the sign-in while working on the UI:

```bash
npm run dev-session -- 0812345678 "ชื่อที่แสดง"   # prints: session=eyJ...
```

Set that cookie for `http://localhost:3000` in the browser. The number must be in `ALLOWED_PHONES`, hold a current claim on an active user of the local `users` table, or be approved. The script refuses to run when `APP_URL` is https.

`/preview` renders the board without signing in (`/preview?admin=1` with the admin button), and `/preview/admin` renders the admin page with the supplied surgeon list (changes stay in the page and are not saved), both only while `NODE_ENV` is `development`.

## Tests

```bash
npm run lint
npm run typecheck
npm test            # unit tests (node:test via tsx); Postgres database orskh_test
npm run build
npm run test:e2e    # mock LINE + mock deeSMSX + next build/start + Playwright (Chromium)
```

`npm test` reads `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/orskh_test`). It covers the number rules, the users CSV and sync script, the `users` DDL against the production text (and that applying the schema to a filled `users` writes nothing), claims (first claim wins under concurrency, one name per number and per LINE account, claims and requests excluding each other, a claim moving to a corrected row, limits, undo and its 24-hour block, claims off without a Telegram administrator), the deeSMSX adapter against a stubbed `fetch` (every reference code, timeouts, broken answers), local mode, the limits, the daily cap (also under concurrent sends), alerts and the rest of the sign-in.

`npm run test:e2e` reads `E2E_DATABASE_URL` (default database `orskh_e2e`), `E2E_APP_PORT` (3100), `E2E_FILE_APP_PORT` (3101), `E2E_LINE_PORT` (4010), `E2E_SMS_PORT` (4011), `E2E_OUTBOX_DIR`, `E2E_SCREENS_DIR` (both default to the system temp folder) and `E2E_SKIP_BUILD=1`. It drops and recreates the sign-in tables and `users` in that database and loads invented names into `users` with the sync script. The main server runs in deeSMSX mode against the mock (sign-in with a name claim, binding, a second account that finds the name taken, access requests, deactivation, break-glass, the Telegram undo and its 24-hour block, deeSMSX failures and low credit, logout, CSRF, open redirects, the admin gate); a second server on the same build runs in file mode with Telegram sent only to a group (a full sign-in, name claims off, and the daily cap). It saves screenshots of the sign-in pages and the board at 360 and 1280 px wide (the claim steps and the request form also at 320 px). Playwright is pinned to the version whose Chromium is installed.

Both test runs drop and truncate tables, `users` among them, and `users` is shared in production (another workstream owns it, with stable ids). So both refuse to start (`tests/db-guard.mjs`) when `TEST_DATABASE_URL` or `E2E_DATABASE_URL` names a host other than `localhost`, `127.0.0.1`, `::1` or a Unix socket, and when `users` in that database already holds more than 50 rows (more than the tests ever insert). Never point them at Neon or at a Neon branch of production. `ALLOW_REMOTE_TEST_DB=1` lifts only the host check, for a remote database that holds nothing you need.

`overrides.zod` lifts the zod copy pulled in by `@vercel/functions` to a patched release.

## Security overview

- `src/proxy.ts`: canonical-host redirect in production, Origin check on every non-GET request, a CSP nonce per request, and a sign-in gate on every route except `/login*`, `/api/auth/*` and `/preview*` (the preview pages answer 404 outside development). Every board page also checks the session itself. The one exception to both checks is `POST /api/telegram/webhook`, which requires Telegram's secret header instead.
- Session: HS256 JWT (30 days) in an HttpOnly, Secure, SameSite=Lax `__Host-session` cookie, carrying the number in its canonical form (sessions from the email version are refused). The number must still be authorized on every request; when the database is unreachable only `ALLOWED_PHONES` is (fail closed).
- Codes: 6 digits, 5 minutes, single use, at most 5 attempts (counted before deeSMSX is asked). In deeSMSX mode the code never reaches the app's database; deeSMSX's token is stored encrypted. In local mode the code is stored as an HMAC with `OTP_PEPPER`. The API keys, tokens and codes are never logged. Limits and the daily cap are under Cost control. Every valid number gets a code and the same answer, so the page never shows whether a number is on the list before the code is checked.
- `/admin`: a signed-in session whose `sub` is in `AUTH_ADMIN_LINE_IDS`; anyone else gets a 404, and every server action checks the admin list again.
- Access requests: the `access` cookie (12 hours, own key) never grants a session; names allow only letters, spaces and `. - '`; everything sent to Telegram is escaped.
- Headers: CSP (nonce and `strict-dynamic`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `X-Robots-Tag: noindex`, and `robots.txt` disallowing all.
- Real names, real phone numbers, the users CSV, deeSMSX keys and other secrets never go in this public repository; examples, tests and screenshots use invented names and numbers only (`*.csv`, `outbox/` and `screens/` are gitignored as a safety net).
- Name claims: open only while every claim can be announced to a Telegram administrator with an undo button (fail closed, like access requests); one name per number and per LINE account; claims and access requests of one number exclude each other.
