# orskh

Operating-suite board. Staff sign in with LINE, then pick a room on the floor plan to see that day’s cases.

The board shows **today** only, dated in Thai with the Buddhist year (Thailand time, so it turns over at midnight in Bangkok). There is no paging between days. At the weekend and on Thai public and special holidays the suite runs no list, so the board shows no cases and every OR keeps the plain colour with no department. Holidays come from the Bank of Thailand's Financial Institutions' Holidays API (public holidays, substitution days and the special holidays the cabinet announces), fetched again every six hours, plus any dates in `EXTRA_HOLIDAYS` (`src/lib/holidays.ts`). When an export is loaded it covers one week, so each weekday shows that weekday's cases from it; at the weekend the plan is shown with no cases. In development, `/preview?day=tue` shows another weekday of this week and `/preview?holiday=วันปิยมหาราช` shows the holiday view.

## Case data

**No case data is loaded at the moment** (the 28 Sep – 2 Oct 2026 export was removed on 27 Oct 2026), so every room shows as having no cases and the plan follows this week's allocation. Cases come from an export of the OR system, not from a live feed: `python3 scripts/build_week.py path/to/export.xls` (needs `pandas` and `xlrd`) rewrites `src/data/week-data.ts`. Only the day, department, status, procedure name, surgeon and shift are kept; patient fields never reach the repo.

- Rows whose `วันที่` equals `วันที่ผ่าตัด` are dropped (same-day entries).
- Following the utilisation report, Tha Chalom hospital cases are cut, and so is vascular surgery on Tuesday to Thursday (Tha Chalom's quota).
- The export's room column is not trusted and is not even stored. Every case is placed by the report's rules: dressing cases go to OR 1, emergency cases to OR 8 (obstetrics-gynaecology stays in its own room), and anything else to a room its department holds that day, spread across them when it holds several. A case whose department holds no room that day is left off the board.
- OR 1 is exclusive to dressing cases from any sub-specialty, checked before everything else (even emergency). A case is a dressing case when its operation name matches the hospital's keyword regex (dressing, d/s, ds and dw as whole words, ทำแผล, ล้างแผล, เปลี่ยนแผล, change vac, vac d) and does not also name debridement/db, scrub, graft, suture, closure, escharotomy, fasciotomy, excision, incision or amputation. The hospital's last step (every item in the operation-items column must be a dressing) is skipped because the export has no such column, so this is the broader definition.
- The SCOPE room (OR 3) is exclusive: it takes only cases by a GENSX-labelled surgeon whose operation name matches `egd, gastroscop, esophagoscop, ogd, colono, sigmoido, ercp, endoscop, eus` (case-insensitive, whole word for the short ones) and does not match `remove fb, foreign body, fb`. Such cases go nowhere else; other general-surgery cases use the GENSX rooms. The export has one operation-name column, so only that is matched.
- The export has no start or end times, so cases are listed by position (ลำดับ), with the shift flagged when it is out of hours.
- Surgeons are matched to the supplied physician list (`src/lib/physicians.ts`), which also feeds registration.

Room allocation comes from the proposed OR schedule (ตารางห้องผ่าตัดที่เสนอ, 27 Oct 2026; `src/lib/allocation.ts`). Every OR has one department all day, except OR 10 on Friday (vascular in the morning, nephrology in the afternoon) and OR 5 on Tuesday, which is paediatric surgery in weeks 2 and 4 of the month and general surgery in weeks 1, 3 and 5. Periods the schedule marks as over quota (*) are shown like any other. The per-department half-day periods are checked by a test against the schedule's legend (130 a week). Department names and colours come from the hospital's department colour list (October 2026); each OR takes its department's colour and code as its label (OR 1 reads "dressing", vascular reads "VASCULAR"). Three colours are darkened or lightened by an invisible amount so their labels clear 4.5:1. Every OR is filled with its department's colour for the day, whether or not it has cases; a room with no department would use the list's "unknown" gray. Recovery rooms share the service-area beige and the old circulation zone is a walkway.

## Design

The look follows the SAKHONMSO P4P dashboard: shadcn/ui's design language with a deep brown primary and a tan accent, frosted-glass panels over a warm gradient, and an "OR" text mark on a brown tile. Text is Inter for Latin and Noto Sans Thai Looped for Thai (looped letters keep their heads and read better on a phone), with extra line height for Thai. The layout is kept short: one app bar holds the mark, today's date and the account menu (a popover behind the avatar, with a plain sign-out button where popovers are unsupported), and the floor plan takes the rest. On a desktop the plan fills the full height beside the room's case column, which widens with the screen (26rem, 30rem from 1280px, 34rem from 1536px), and the layout spreads to 120rem. Tokens (colour, surfaces, status, shadows) live at the top of `src/app/globals.css`; shared pieces are `.btn` (`-primary`, `-secondary`, `-ghost`), `.field`, `.card`, `.pill`, `.badge`, `.chip` and `.notice`, plus `AuthShell` and `BrandMark` in `src/components`. The app is built to be usable by everyone:

- Text and status pairs meet WCAG AA (4.5:1); department labels are checked by a test.
- One blue focus ring on every control, and keyboard focus on a room outlines its wall.
- Touch targets are at least 44px. Pinch-zoom is left on.
- Colour is never the only cue: room markers differ by shape (live = circle, delayed = diamond), rooms carry a text code, cancelled cases are struck through, and each case's status is read out to screen readers.
- The LINE button keeps LINE's own green and white, which is the one deliberate exception to the contrast rule.

## Stack

Next.js 16, React 19, Tailwind CSS 4, Auth.js (LINE Login), Neon Postgres.

## Setup

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Session secret. `openssl rand -base64 32` |
| `AUTH_LINE_ID` | LINE Login channel ID |
| `AUTH_LINE_SECRET` | LINE Login channel secret. Server only. |
| `AUTH_TRUST_HOST` | `true` on Vercel |
| `AUTH_TEST_MODE` | On unless `false`. In test mode every signed-in LINE account may open the board and the allowlist is ignored. |
| `AUTH_LINE_ALLOWLIST` | Optional comma-separated LINE user IDs. Only used when `AUTH_TEST_MODE=false`. |
| `AUTH_ADMIN_LINE_IDS` | Comma-separated LINE user IDs of the admins, who may open `/admin`. Unset or empty means no admin. |
| `DATABASE_URL` | Neon pooled connection string. Server only. |
| `BOT_API_TOKEN` | Bank of Thailand API token for the Financial Institutions' Holidays API (free, from [portal.api.bot.or.th](https://portal.api.bot.or.th)). Server only. Without it only weekends and `EXTRA_HOLIDAYS` close the board. |
| `EXTRA_HOLIDAYS` | Optional closures the API does not list, comma-separated `YYYY-MM-DD`, each optionally `=name`. |

In the LINE Developers console, open the Login channel and add this callback:

`https://orskh.vercel.app/api/auth/callback/line`

The live board is [https://orskh.vercel.app](https://orskh.vercel.app). Guests are sent to the LINE sign-in page.

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout.

In test mode (the default) every successful LINE login can continue. Set `AUTH_TEST_MODE=false` to enforce the allowlist: if `AUTH_LINE_ALLOWLIST` is then empty, every login can still continue, and setting the list locks it to staff. A signed-in account that is not on the list sees its LINE user id on `/pending`.

A signed-in account that has not registered is sent to `/register`. Physicians pick their name from the department list and confirm it in a dialog. The choice is stored in `staff_registrations`, keyed by the LINE user id, so the next visit skips registration. The nurse option is shown, but there is no nurse list yet, so that choice cannot be saved. Each physician name can be claimed once.

Issue a new channel secret if the current one was ever pasted into a chat, ticket, or commit.

### Admin page

Admins (the LINE user ids in `AUTH_ADMIN_LINE_IDS`) see a "จัดการแพทย์" button in the top bar (an icon on phones, labelled from 768px, left out below 390px so the date keeps its year) and the same link in the account menu, both opening `/admin`. Everyone else gets a not-found page there, and every save is checked against the admin list again on the server.

The page holds **รายชื่อแพทย์**, the surgeon list, with search, a specialty filter, and add, edit and delete. Specialty is a dropdown of department codes. Names are stored with invisible format characters (zero-width spaces, direction marks, soft hyphens) removed, runs of spaces evened out and Unicode NFC applied, and each name can appear once. The list is stored in the `surgeons` table. Nothing else reads it yet: the case board still matches surgeons to `src/lib/physicians.ts`, and registration still uses the hospital's department list.

The tables are created by the SQL files in `drizzle/`, run in order against the database (Neon's SQL editor works). `0001_surgeons.sql` creates `surgeons` and seeds it with the 76 surgeons supplied on 27 Oct 2026 (`src/data/surgeons.ts`). The seed only runs while the table's id sequence has never been used, so running the file again never brings back names the admin deleted.

```bash
npm install
npm run dev
```

`/preview` renders the board without LINE (`/preview?admin=1` with the admin button), `/preview/register` renders the registration form, and `/preview/admin` renders the admin page with the supplied surgeon list (changes stay in the page and are not saved), all only while `NODE_ENV` is `development`.
