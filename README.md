# SPR — Scissors Paper Rock

Competitive, real-time Scissors Paper Rock. Best of 3, Elo matchmaking, ranked tiers,
friend challenges and double-or-nothing rematches.

**Live:** https://sprletsgo.vercel.app

> **v1 uses free virtual chips.** Every chip movement goes through an append-only
> ledger (`chip_ledger`) so a crypto wallet can replace chips later without touching
> game logic. Get legal advice before enabling real-value stakes (see *Roadmap*).

## Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router, Cache Components), TypeScript | Static shells load instantly; Vercel-native |
| Styling | Tailwind v4 + hand-rolled primitives, Motion | Tiny bundle; spring animations |
| Data / Auth / Realtime | Supabase (Postgres 17, Sydney `ap-southeast-2`) | One service; RLS; realtime |
| Hosting | Vercel (`syd1`, see `vercel.json`) | Co-located with the database |

## How the game engine works

**Postgres is the game server.** Every action is a `SECURITY DEFINER` function in
`supabase/migrations/…_game_functions.sql` that locks the rows it touches, so concurrent
requests can never double-pay, double-move or desync.

- **Hidden moves**: moves land in `round_moves`, which has RLS with *no* policies, so no
  client can read it. A move is only revealed (copied to `rounds`) once both players
  have thrown or the timer expires. Opponents only see a `moved_a/moved_b` "locked in" flag.
- **5-second throws**: the server stores `round_deadline`. After it passes (+750ms grace for
  latency), either client calls `tick_match()` and anyone who didn't move gets a random move.
  A `pg_cron` job (`spr-sweep-matches`, every 2s) is the backstop, so a match **always
  finishes**, even if both players close their tabs.
- **Matchmaking**: `join_queue` / `poll_queue`. Window starts at ±50 Elo and widens by 50
  every 3s of waiting. Queue rows carry a heartbeat, so closed tabs are never matched.
- **Elo**: standard logistic formula, K=40 for a player's first 10 ranked games, then K=32.
  Only `ranked` matches move Elo. Friend challenges and casual matches don't.
- **Chips**: stakes are escrowed at match start and paid out (2× stake) in the same
  transaction that finishes the match. `profiles.chips` is a cached balance; the ledger is
  the source of truth (`sum(delta) = chips`, checked in the engine test).
- **Double or nothing**: after a match, both players vote within 30s. Unanimous yes →
  new match at 2× stake (if both can cover it).

**Client sync** (`src/app/match/[id]/match-screen.tsx`): every update is a *refetch* of
authoritative state via `get_match_state()`, triggered by (1) a Realtime broadcast "nudge"
from the opponent's browser, (2) Postgres change events, and (3) a 1s→3s poll as a safety
net. The client syncs its clock to `server_now`, so countdowns match the server.

### Security model
- Clients have **read-only** table access via RLS. All `insert/update/delete` grants are
  revoked, except `profiles.username`/`avatar_url` for the owner.
- Internal `_*` functions are not executable by clients; only the 12 public RPCs are.
- Email is never stored in the public `profiles` table.

## Local development

```bash
git clone https://github.com/honestjams/SPR.git
cd SPR
cp .env.example .env.local   # fill in the publishable key (Supabase → Project Settings → API)
npm install
npm run dev
```

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://nprugulzidmyanbgaqna.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (safe for the browser) |

Keyboard shortcuts in a match: `1`/`R` rock · `2`/`P` paper · `3`/`S` scissors.

## Deployment config

| Where | Setting |
|---|---|
| Vercel project `sprletsgo` | Framework pinned to Next.js in `vercel.json`; functions in `syd1`; both `NEXT_PUBLIC_SUPABASE_*` vars set for Production, Preview and Development |
| Supabase → Auth → URL Configuration | Site URL `https://sprletsgo.vercel.app`; redirect allow-list: `https://sprletsgo.vercel.app/**`, `https://sprletsgo-*-josh-evans-projects-7b18a71f.vercel.app/**` (previews), `http://localhost:3000/**` |

If you add a custom domain, add it to **both** Vercel Domains and the Supabase redirect
allow-list (and make it the Site URL), or sign-up confirmation links will break.

`NEXT_PUBLIC_*` variables are inlined at build time: after changing one in Vercel, redeploy.

## Branching workflow

- `main`: production (Vercel production deploys)
- `develop`: integration / staging (Vercel preview)
- `feature/*`, `fix/*`, `chore/*`: branch from `develop`, PR back into `develop`

```bash
git checkout develop && git pull
git checkout -b feature/my-thing
# …commit, push, open a PR into develop. Merge develop → main to ship.
```

## Database changes

Migrations live in `supabase/migrations/` and are already applied to the `spr` project.
Add a new timestamped file for every change (never edit an applied one), then regenerate
`src/types/database.ts`.

## Tests

- **Engine** (`supabase/tests/engine_test.sql`): paste into the Supabase SQL editor. It runs
  a full match, rematch, timeout and ledger check inside a transaction and rolls back.
  Success is the error message `ALL_TESTS_PASSED`.
- **End-to-end** (`tests/e2e/two-player.cjs`): drives two real browsers through a full
  session with Playwright. Needs two confirmed test accounts with password `TestPass!2345`:
  `spr-e2e-a@example.test` and `spr-e2e-b@example.test` (create them under
  Supabase → Authentication → Add user, tick "auto-confirm").

## Roadmap
1. **Google & Apple sign-in**: enable providers in Supabase Auth (needs a Google Cloud
   OAuth client and an Apple Developer account). The callback route already exists.
2. **Crypto wallet for ranked**: replace `_adjust_chips` with wallet-backed escrow.
   **Get legal advice first:** competitive SPR is likely classed as a game of chance
   (gambling) in most jurisdictions, including Australia under the Interactive Gambling Act.
3. Rate limiting on RPCs and broadcast channels (currently anyone in a match can send
   no-data "nudges"; they only trigger refetches).
4. Seasons / rank decay, avatars, push notifications for friend challenges.
