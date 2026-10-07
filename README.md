# orskh

Operating-suite board. Staff sign in with LINE, then pick a room on the floor plan to see that day’s cases.

The board shows one working week, **Monday to Friday**, opening on Monday. Swipe the plan (or use the arrows, the dots or the left and right keys) to change day. Days are named, not dated.

## Case data

Cases come from an export of the OR system for 28 Sep – 2 Oct 2026, not from a live feed. `python3 scripts/build_week.py path/to/export.xls` (needs `pandas` and `xlrd`) rewrites `src/data/week-data.ts`. Only the day, department, status, procedure name, surgeon and shift are kept; patient fields never reach the repo.

- Rows whose `วันที่` equals `วันที่ผ่าตัด` are dropped (same-day entries).
- Following the utilisation report, Tha Chalom hospital cases are cut, and so is vascular surgery on Tuesday to Thursday (Tha Chalom's quota).
- The export's room column is not trusted and is not even stored. Every case is placed by the report's rules: dressing cases go to OR 1, emergency cases to OR 8 (obstetrics-gynaecology stays in its own room), and anything else to a room its department holds that day, spread across them when it holds several. A case whose department holds no room that day is flagged **ไม่มีห้องที่ถูกต้อง** and listed under that pill.
- The SCOPE room (OR 3) is exclusive: it takes only cases by a GENSX-labelled surgeon whose operation name matches `egd, gastroscop, esophagoscop, ogd, colono, sigmoido, ercp, endoscop, eus` (case-insensitive, whole word for the short ones) and does not match `remove fb, foreign body, fb`. Such cases go nowhere else; other general-surgery cases use the GENSX rooms. The export has one operation-name column, so only that is matched.
- The export has no start or end times, so cases are listed by position (ลำดับ), with the shift flagged when it is out of hours.
- Surgeons are matched to the supplied physician list (`src/lib/physicians.ts`), which also feeds registration.

Room colours and labels come from the weekly allocation table in the FY2569 utilisation report (`src/lib/allocation.ts`, schedule updated 5 Aug 2567): each OR takes its department's colour from the report and the department code as its label, ORs 7 and 9 are split morning/afternoon, and OR 5 alternates by week of the month. A room with no case that day turns dark gray. Recovery rooms share the service-area gray and the old circulation zone is a gray walkway.

## Design

Tokens (colour, surfaces, status, shadows) live at the top of `src/app/globals.css`; shared pieces are `.btn`, `.field`, `.card` and `.notice`, plus `AuthShell` and `BrandMark` in `src/components`. The app is built to be usable by everyone:

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
| `DATABASE_URL` | Neon pooled connection string. Server only. |

In the LINE Developers console, open the Login channel and add this callback:

`https://orskh.vercel.app/api/auth/callback/line`

The live board is [https://orskh.vercel.app](https://orskh.vercel.app). Guests are sent to the LINE sign-in page.

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout.

In test mode (the default) every successful LINE login can continue. Set `AUTH_TEST_MODE=false` to enforce the allowlist: if `AUTH_LINE_ALLOWLIST` is then empty, every login can still continue, and setting the list locks it to staff. A signed-in account that is not on the list sees its LINE user id on `/pending`.

A signed-in account that has not registered is sent to `/register`. Physicians pick their name from the department list and confirm it in a dialog. The choice is stored in `staff_registrations`, keyed by the LINE user id, so the next visit skips registration. The nurse option is shown, but there is no nurse list yet, so that choice cannot be saved. Each physician name can be claimed once.

Issue a new channel secret if the current one was ever pasted into a chat, ticket, or commit.

```bash
npm install
npm run dev
```

`/preview` renders the board without LINE, and `/preview/register` renders the registration form, both only while `NODE_ENV` is `development`.
