# orskh

Operating-suite board. Staff sign in with LINE, then pick a room on the floor plan to see that day’s cases.

The case list is sample data, marked **ตารางตัวอย่าง** on the board. It is not a live theatre system.

## Stack

Next.js 16, React 19, Tailwind CSS 4, Auth.js (LINE Login).

## Setup

Copy `.env.example` to `.env.local` and fill in:

| Variable | Purpose |
| --- | --- |
| `AUTH_SECRET` | Session secret. `openssl rand -base64 32` |
| `AUTH_LINE_ID` | LINE Login channel ID |
| `AUTH_LINE_SECRET` | LINE Login channel secret. Server only. |
| `AUTH_TRUST_HOST` | `true` on Vercel |
| `AUTH_LINE_ALLOWLIST` | Optional comma-separated LINE user IDs |

In the LINE Developers console, open the Login channel and add this callback:

`https://<your-domain>/api/auth/callback/line`

While the channel is in Developing mode, only testers and admins can sign in. Publish the channel, or add staff as testers, before a wider rollout.

If `AUTH_LINE_ALLOWLIST` is empty, every successful LINE login can open the board. Set the list to lock it to staff. A signed-in account that is not on the list sees its LINE user id on `/pending`.

Issue a new channel secret if the current one was ever pasted into a chat, ticket, or commit.

```bash
npm install
npm run dev
```

`/preview` renders the board without LINE, and only while `NODE_ENV` is `development`.
