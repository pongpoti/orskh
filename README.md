# orskh

Operating-suite board. Staff sign in with LINE and a one-time email code, then pick a room on the floor plan to see that day’s cases.

The board shows **today** only, dated in Thai with the Buddhist year (Thailand time, so it turns over at midnight in Bangkok). There is no paging between days. At the weekend and on Thai public and special holidays the suite runs no list, so the board shows no cases and every OR keeps the plain colour with no department. Holidays come from the Bank of Thailand's Financial Institutions' Holidays API (public holidays, substitution days and the special holidays the cabinet announces), fetched again every six hours, plus any dates in `EXTRA_HOLIDAYS` (`src/lib/holidays.ts`). When an export is loaded it covers one week, so each weekday shows that weekday's cases from it; at the weekend the plan is shown with no cases. In development, `/preview?day=tue` shows another weekday of this week and `/preview?holiday=วันปิยมหาราช` shows the holiday view.

## Case data

**No case data is loaded at the moment** (the 28 Sep – 2 Oct 2026 export was removed on 27 Oct 2026), so every room shows as having no cases and the plan follows this week's allocation. Cases come from an export of the OR system, not from a live feed: `python3 scripts/build_week.py path/to/export.xls` (needs `pandas` and `xlrd`) rewrites `src/data/week-data.ts`. Only the day, department, status, procedure name, surgeon and shift are kept; patient fields never reach the repo.

- Rows whose `วันที่` equals `วันที่ผ่าตัด` are dropped (same-day entries).
- Following the utilisation report, Tha Chalom hospital cases are cut, and so is vascular surgery on Tuesday to Thursday (Tha Chalom's quota).
- The export's room column is not trusted and is not even stored. Every case is placed by the report's rules: dressing cases go to OR 1, emergency cases to OR 8 (obstetrics-gynaecology stays in its own room), and anything else to a room its department holds that day, spread across them when it holds several. A case whose department holds no room that day is left off the board.
- OR 1 is exclusive to dressing cases from any sub-specialty, checked before everything else (even emergency). A case is a dressing case when its operation name matches the hospital's keyword regex (dressing, d/s, ds and dw as whole words, ทำแผล, ล้างแผล, เปลี่ยนแผล, change vac, vac d) and does not also name debridement/db, scrub, graft, suture, closure, escharotomy, fasciotomy, excision, incision or amputation. The hospital's last step (every item in the operation-items column must be a dressing) is skipped because the export has no such column, so this is the broader definition.
- The SCOPE room (OR 3) is exclusive: it takes only cases by a GENSX-labelled surgeon whose operation name matches `egd, gastroscop, esophagoscop, ogd, colono, sigmoido, ercp, endoscop, eus` (case-insensitive, whole word for the short ones) and does not match `remove fb, foreign body, fb`. Such cases go nowhere else; other general-surgery cases use the GENSX rooms. The export has one operation-name column, so only that is matched.
- The export has no start or end times, so cases are listed by position (ลำดับ), with the shift flagged when it is out of hours.
- Surgeons are matched to the supplied physician list (`src/lib/physicians.ts`). Who may sign in is a separate list, the `physicians` table (see Sign-in).

Room allocation comes from the proposed OR schedule (ตารางห้องผ่าตัดที่เสนอ, 27 Oct 2026; `src/lib/allocation.ts`). Every OR has one department all day, except OR 10 on Friday (vascular in the morning, nephrology in the afternoon) and OR 5 on Tuesday, which is paediatric surgery in weeks 2 and 4 of the month and general surgery in weeks 1, 3 and 5. Periods the schedule marks as over quota (*) are shown like any other. The per-department half-day periods are checked by a test against the schedule's legend (130 a week). Department names and colours come from the hospital's department colour list (October 2026); each OR takes its department's colour and code as its label (OR 1 reads "dressing", vascular reads "VASCULAR"). Three colours are darkened or lightened by an invisible amount so their labels clear 4.5:1. Every OR is filled with its department's colour for the day, whether or not it has cases; a room with no department would use the list's "unknown" gray. Recovery rooms share the service-area beige and the old circulation zone is a walkway.

## Design

The look follows the SAKHONMSO P4P dashboard: shadcn/ui's design language with a deep brown primary and a tan accent, frosted-glass panels over a warm gradient, and an "OR" text mark on a brown tile. Text is Inter for Latin and Noto Sans Thai Looped for Thai (looped letters keep their heads and read better on a phone), with extra line height for Thai. The layout is kept short: one app bar holds the mark, today's date and the account menu (a popover behind the avatar, with a plain sign-out button where popovers are unsupported), and the floor plan takes the rest. On a desktop the plan fills the full height beside the room's case column, which widens with the screen (26rem, 30rem from 1280px, 34rem from 1536px), and the layout spreads to 120rem. Tokens (colour, surfaces, status, shadows) live at the top of `src/app/globals.css`; shared pieces are `.btn` (`-primary`, `-secondary`, `-ghost`), `.field`, `.card`, `.pill`, `.badge`, `.chip` and `.notice`, plus `AuthShell` and `BrandMark` in `src/components`. The app is built to be usable by everyone:

- Text and status pairs meet WCAG AA (4.5:1); department labels are checked by a test.
- One blue focus ring on every control, and keyboard focus on a room outlines its wall.
- Touch targets are at least 44px. Pinch-zoom is left on.
- Colour is never the only cue: room markers differ by shape (live = circle, delayed = diamond), rooms carry a text code, cancelled cases are struck through, and each case's status is read out to screen readers.
- The LINE button keeps LINE's own green and white, which is the one deliberate exception to the contrast rule.


## Stack

Next.js 16, React 19, Tailwind CSS 4, Postgres (Neon in production) through `pg`, `jose` for tokens, `nodemailer` for the sign-in codes; the admin page's surgeon list goes through drizzle (`src/db`). The sign-in is the one from skh-or-schedule, restyled for this board.

## Sign-in

1. **LINE Login** (OAuth with PKCE). The LINE account's id is the session's `sub`.
2. **Email code.** The user types an email and gets a 6-digit code (10 minutes, single use, 5 attempts). After the first correct code the LINE account is bound to that email for 180 days, so later visits skip this step.
3. **Authorized?** An email may open the board when it has an active row in the `physicians` table, an approved access request, or is in `ALLOWED_EMAILS`. Anyone else who verified an email can **request access** at `/login/request`; an administrator approves or rejects it in Telegram, and the waiting page signs the user in once approved.
4. **Session**: a signed cookie for 30 days. Authorization is checked again on every request (against a list cached for at most 60 s), so a removed email loses access within a minute.

The top bar shows the full name from the `physicians` table (or the name given in an approved access request, otherwise the LINE name). The email is in the account menu behind the avatar.

The live board is [https://orskh.vercel.app](https://orskh.vercel.app). Guests are sent to `/login`.

## Environment variables

Copy `.env.example` to `.env.local` for local work. Names only here; values live in Vercel and `.env.local`.

| Name | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | yes | Canonical origin, `https://orskh.vercel.app`. Requests to other hosts are redirected to it in production |
| `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` | yes | LINE Login channel. The secret is server only |
| `SESSION_SECRET` | yes | 32+ characters (`openssl rand -base64 32`). Signs the session and the other sign-in cookies. Rotating it signs everyone out |
| `OTP_PEPPER` | yes | 16+ characters. HMAC key for the stored codes |
| `DATABASE_URL` | yes | Postgres (Neon pooled connection string). Server only |
| `SMTP_USER`, `SMTP_PASS` | yes | Gmail account and app password that send the codes |
| `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM` | no | Defaults: `smtp.gmail.com`, `465`, `"ORSKH.APP ตารางห้องผ่าตัด" <SMTP_USER>` |
| `ALLOWED_EMAILS` | no | Break-glass list, comma-separated. These emails stay authorized without a database read. Keep it empty or one administrator. Needs a redeploy to change |
| `AUTH_ADMIN_LINE_IDS` | no | Comma-separated LINE user ids (the session's `sub`) of the admins, who may open `/admin`. Unset or empty means no admin. See Admin page |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Sign-in alerts and access-request decisions. Chat IDs comma-separated; the numeric IDs are also who may approve. Off when either is unset |
| `BOT_API_TOKEN` | no | Bank of Thailand API token for the Financial Institutions' Holidays API (free, from [portal.api.bot.or.th](https://portal.api.bot.or.th)). Server only. Without it only weekends and `EXTRA_HOLIDAYS` close the board |
| `EXTRA_HOLIDAYS` | no | Closures the API does not list, comma-separated `YYYY-MM-DD`, each optionally `=name` |
| `LINE_AUTH_URL`, `LINE_API_URL`, `TELEGRAM_API_URL`, `EMAIL_TRANSPORT`, `EMAIL_OUTBOX_DIR` | dev only | Mock LINE and Telegram, and codes written to files. Ignored when `VERCEL` is set |

If `DATABASE_URL` or the SMTP settings are missing in production, pages still build and serve, the sign-in endpoints answer "ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล", and the log names the missing variables.

### LINE

In the LINE Developers console, open the Login channel and set the callback to:

`https://orskh.vercel.app/api/auth/line/callback`

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout. Issue a new channel secret if the current one was ever pasted into a chat, ticket or commit.

### Gmail

Turn on 2-step verification for the sending account, create an app password (Google Account, Security, App passwords) and put it in `SMTP_PASS`. Every code is a real email, so the account's daily sending quota is shared by all sign-ins; Telegram gets an alert after 150 codes in 24 hours.

### Telegram (optional)

Create a bot with @BotFather and put its token in `TELEGRAM_BOT_TOKEN`. Use a bot of its own, not skh-or-schedule's: a bot has a single webhook, and each app takes it over when it registers, so taps on one app's messages would reach the other. The same people can press **Start** in both bots and use the same chat IDs. (The buttons also carry an orskh-only tag, so a stray tap from the other app is refused rather than deciding a request here.) Each person who should get alerts and decide requests presses **Start** in the bot; put their numeric chat IDs in `TELEGRAM_CHAT_ID`. The app registers its own webhook (`/api/telegram/webhook`) and derives the webhook secret from the bot token and `SESSION_SECRET`, so there is nothing else to set. Every email-code sign-in sends an alert with the name, LINE name, email and time. Without Telegram, access requests still save but wait until decided in SQL.

## Who may sign in (table `physicians`)

The sign-in list is the Postgres table `physicians` (`email`, `name`, `dept`, `active`, `updated_at`), created with the rest of the sign-in schema (`db/schema.sql`) on first use. One row per email; an alternate address is another row with the same name. `name` is what the top bar shows. Changes apply within 60 s, with no redeploy.

**Until this table is loaded, nobody except `ALLOWED_EMAILS` can sign in.** Load a whole roster with the sync script from a CSV kept **outside** this repository (UTF-8, header `email,name,dept`; in Excel, Save As "CSV UTF-8"). The script refuses a file inside the repository:

```bash
npm run sync-physicians -- /path/outside/repo/roster.csv           # dry run: prints the changes
npm run sync-physicians -- /path/outside/repo/roster.csv --apply   # writes them in one transaction
```

It reads `DATABASE_URL` from the environment or `.env.local`, prints the target database without credentials, never deletes a row (people missing from the CSV are set inactive), refuses the whole file on a bad or duplicate email, and refuses to deactivate more than 5 rows and 10% of the list at once unless `--allow-mass-deactivate` is added.

Single edits in the Neon SQL editor. Emails are stored in lower case, so always write `lower('...')`:

```sql
-- add, correct or bring back one person
INSERT INTO physicians (email, name, dept) VALUES (lower('someone@example.com'), 'ชื่อ นามสกุล', 'ศัลยกรรมทั่วไป')
ON CONFLICT (email) DO UPDATE SET name = excluded.name, dept = excluded.dept, active = true, updated_at = now();

-- remove (the row stays, inactive)
UPDATE physicians SET active = false, updated_at = now() WHERE email = lower('someone@example.com');
```

The physician list in `src/lib/physicians.ts` is only for matching surgeons in the case data; it does not decide who can sign in.

The old `staff_registrations` table (Auth.js registration; `src/db/schema.ts`, `drizzle/0000`) is no longer used and is left in place; nothing reads or writes it. The rest of `src/db` and `drizzle/` is still in use: the `surgeons` table (`drizzle/0001`) is read and written by `/admin` (see Admin page).

## Access requests (emails not on the list)

A correct code for an email that is not authorized gives no session. Instead the browser goes to `/login/request`, which asks for first name, last name and position. The request goes to every chat in `TELEGRAM_CHAT_ID` with approve and reject buttons; the first tap decides. On approval the user gets an email and the waiting page (checked every 10 s) signs in by itself. After a rejection the same email cannot ask again for 24 hours. One pending request per email, at most 3 requests per LINE account per 24 hours.

An approved request keeps working even if the person is later removed from `physicians`, so revoke it too:

```sql
SELECT id, email, first_name, last_name, position, status, created_at, decided_at
FROM access_requests ORDER BY created_at DESC;

UPDATE access_requests SET status = 'rejected', decided_at = now()
WHERE email = lower('someone@example.com') AND status = 'approved';
```

## Switching from Auth.js

Checklist for the first deploy of this sign-in:

1. In Vercel, add: `APP_URL` (`https://orskh.vercel.app`), `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET`, `SESSION_SECRET`, `OTP_PEPPER`, `SMTP_USER`, `SMTP_PASS`. Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `ALLOWED_EMAILS`. `DATABASE_URL`, `BOT_API_TOKEN` and `EXTRA_HOLIDAYS` stay as they are. `LINE_CHANNEL_ID` and `LINE_CHANNEL_SECRET` take the values of the old `AUTH_LINE_ID` and `AUTH_LINE_SECRET`.
2. In Vercel, remove: `AUTH_SECRET`, `AUTH_LINE_ID`, `AUTH_LINE_SECRET`, `AUTH_TRUST_HOST`, `AUTH_TEST_MODE`, `AUTH_LINE_ALLOWLIST`. `AUTH_ADMIN_LINE_IDS` stays as it is: its values are LINE user ids, the new session's `sub`, same as before.
3. In the LINE console, add the callback `https://orskh.vercel.app/api/auth/line/callback` (the old `/api/auth/callback/line` can be removed afterwards).
4. Load the `physicians` table with the sync script (dry run, then `--apply`) before or right after deploying. Until then only `ALLOWED_EMAILS` can sign in, so put your own address there for the switch.
5. Deploy. Everyone signed in with Auth.js is signed out once and signs in again with LINE and an email code.
6. Sign in once yourself, then empty `ALLOWED_EMAILS` (or keep one administrator) and redeploy.

## Admin page

Admins (the LINE user ids in `AUTH_ADMIN_LINE_IDS`, compared with the session's `sub`) see a "จัดการแพทย์" button in the top bar (an icon on phones, labelled from 768px, left out below 390px so the date keeps its year) and the same link in the account menu, both opening `/admin`. Everyone else gets a not-found page there, and every save is checked against the admin list again on the server. An admin still signs in like everyone else (LINE, email code, an authorized email); the admin list only adds the page.

To find someone's LINE user id, have them sign in once, then look it up in the Neon SQL editor and add it to `AUTH_ADMIN_LINE_IDS` (comma-separated, redeploy to apply):

```sql
SELECT line_sub, display_name, last_login_at FROM line_bindings WHERE email = lower('someone@example.com');
```

The ids are the same LINE user ids Auth.js used, so a list set before the switch keeps working.

The page holds **รายชื่อแพทย์**, the surgeon list, with search, a specialty filter, and add, edit and delete. Specialty is a dropdown of department codes. Names are stored with invisible format characters (zero-width spaces, direction marks, soft hyphens) removed, runs of spaces evened out and Unicode NFC applied, and each name can appear once. The list is stored in the `surgeons` table. Nothing else reads it yet: the case board still matches surgeons to `src/lib/physicians.ts`, and who may sign in is the separate `physicians` table (see Sign-in).

The admin page reaches the database through `src/db` (drizzle, Neon's HTTP driver). Its tables are created by the SQL files in `drizzle/`, run in order against the database (Neon's SQL editor works). `0001_surgeons.sql` creates `surgeons` and seeds it with the 76 surgeons supplied on 27 Oct 2026 (`src/data/surgeons.ts`). The seed only runs while the table's id sequence has never been used, so running the file again never brings back names the admin deleted.

## Local development

Requirements: Node 22, npm, a local Postgres.

```bash
npm install
cp .env.example .env.local      # fill in values; .env.local is gitignored
node tests/mock-line.mjs &      # mock LINE Login on :4010 (uses LINE_CHANNEL_ID/SECRET from .env.local)
npm run dev                     # http://localhost:3000
```

For local work set `APP_URL=http://localhost:3000`, `LINE_AUTH_URL=http://localhost:4010/oauth2/v2.1/authorize`, `LINE_API_URL=http://localhost:4010`, `EMAIL_TRANSPORT=file` and `EMAIL_OUTBOX_DIR=<folder outside the repo>`. The code is then written as a JSON file into that folder instead of being emailed.

To skip the sign-in while working on the UI:

```bash
npm run dev-session -- someone@example.com "ชื่อที่แสดง"   # prints: session=eyJ...
```

Set that cookie for `http://localhost:3000` in the browser. The address must be in `ALLOWED_EMAILS` or have an active row in the local `physicians` table. The script refuses to run when `APP_URL` is https.

`/preview` renders the board without signing in (`/preview?admin=1` with the admin button), and `/preview/admin` renders the admin page with the supplied surgeon list (changes stay in the page and are not saved), both only while `NODE_ENV` is `development`.

## Tests

```bash
npm run lint
npm run typecheck
npm test            # unit tests (node:test via tsx); Postgres database orskh_test
npm run build
npm run test:e2e    # mock LINE + next build/start + Playwright (Chromium)
```

`npm test` reads `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/orskh_test`). `npm run test:e2e` reads `E2E_DATABASE_URL` (default database `orskh_e2e`), `E2E_APP_PORT` (3100), `E2E_LINE_PORT` (4010), `E2E_OUTBOX_DIR`, `E2E_SCREENS_DIR` (both default to the system temp folder) and `E2E_SKIP_BUILD=1`. It drops and recreates the sign-in tables in that database, loads invented example.com physicians with the sync script, and saves screenshots of the sign-in pages and the board at 360 and 1280 px wide. Playwright is pinned to the version whose Chromium is installed.

`overrides.zod` lifts the zod copy pulled in by `@vercel/functions` to a patched release.

## Security overview

- `src/proxy.ts`: canonical-host redirect in production, Origin check on every non-GET request, a CSP nonce per request, and a sign-in gate on every route except `/login*`, `/api/auth/*` and `/preview*` (the preview pages answer 404 outside development). Every board page also checks the session itself. The one exception to both checks is `POST /api/telegram/webhook`, which requires Telegram's secret header instead.
- Session: HS256 JWT (30 days) in an HttpOnly, Secure, SameSite=Lax `__Host-session` cookie. The email must still be authorized on every request; when the database is unreachable only `ALLOWED_EMAILS` is (fail closed).
- Codes: 6 digits, 10 minutes, single use, at most 5 attempts, stored as an HMAC with `OTP_PEPPER`. Limits: 3 per email per 15 minutes, 6 per email and LINE account per 24 hours, 5 per LINE account per hour and at most 5 different emails per LINE account per 24 hours, 20 per IP per hour, 60 s between sends. Every valid address gets a code and the same answer, so the page never shows whether an email is on the list before the code is checked.
- `/admin`: a signed-in session whose `sub` is in `AUTH_ADMIN_LINE_IDS`; anyone else gets a 404, and every server action checks the admin list again.
- Access requests: the `access` cookie (12 hours, own key) never grants a session; names allow only letters, spaces and `. - '`; everything sent to Telegram is escaped.
- Headers: CSP (nonce and `strict-dynamic`), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `X-Robots-Tag: noindex`, and `robots.txt` disallowing all.
- Emails, names with emails, the roster CSV and secrets never go in this public repository (`*.csv`, `outbox/` and `screens/` are gitignored as a safety net).
