# orskh

Operating-suite board. Staff sign in with LINE, then pick a room on the floor plan to see that day’s cases.

The case list is sample data, marked **ตารางตัวอย่าง** on the board. It is not a live theatre system.

Room colours and labels come from the weekly allocation table in the FY2569 utilisation report (`src/lib/allocation.ts`, schedule updated 5 Aug 2567): every OR is drawn in one teal-green tone, with its own gradient per department and the department code as its label, ORs 7 and 9 are split morning/afternoon, and OR 5 alternates by week of the month. Weekends show plain rooms. The sample cases are not matched to the department that owns the room.

## Design

Tokens (colour, surfaces, status, shadows) live at the top of `src/app/globals.css`; shared pieces are `.btn`, `.field`, `.card`, `.badge` and `.notice`, plus `AuthShell` and `BrandMark` in `src/components`. The app is built to be usable by everyone:

- Text and status pairs meet WCAG AA (4.5:1); department labels are checked by a test.
- One blue focus ring on every control, and keyboard focus on a room outlines its wall.
- Touch targets are at least 44px. Pinch-zoom is left on.
- Colour is never the only cue: case statuses and room markers also differ by icon or shape (live = circle, delayed = diamond), and rooms carry a text code.
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
| `AUTH_LINE_ALLOWLIST` | Optional comma-separated LINE user IDs |
| `DATABASE_URL` | Neon pooled connection string. Server only. |

In the LINE Developers console, open the Login channel and add this callback:

`https://orskh.vercel.app/api/auth/callback/line`

The live board is [https://orskh.vercel.app](https://orskh.vercel.app). Guests are sent to the LINE sign-in page.

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout.

If `AUTH_LINE_ALLOWLIST` is empty, every successful LINE login can continue. Set the list to lock it to staff. A signed-in account that is not on the list sees its LINE user id on `/pending`.

A signed-in account that has not registered is sent to `/register`. Physicians pick their name from the department list and confirm it in a dialog. The choice is stored in `staff_registrations`, keyed by the LINE user id, so the next visit skips registration. The nurse option is shown, but there is no nurse list yet, so that choice cannot be saved. Each physician name can be claimed once.

Issue a new channel secret if the current one was ever pasted into a chat, ticket, or commit.

```bash
npm install
npm run dev
```

`/preview` renders the board without LINE, and `/preview/register` renders the registration form, both only while `NODE_ENV` is `development`.
