# Deploy runbook — making multiplayer work in production

Solo play and lessons are pure static front-end: deploy the site and they work,
no backend, no env vars. **Multiplayer** is the part that has to be wired across
two hosts, and that wiring — not the game code — is where it breaks. This is the
checklist for getting a real two-device game working on the open internet.

The engine and the tests are not involved here. If a step below seems to need a
code change in `src/engine`, `src/room`, or a test to make deploy work, stop —
it's a config or wiring problem instead.

## The shape of it

Two hosts, two origins, one real network between them:

```
  Browser  ──────────────  Vercel (your-app.vercel.app)
     │                       • static front end (the Vite build)
     │                       • /api/coach, /api/review  (same-origin coach proxy,
     │                         holds ANTHROPIC_API_KEY server-side)
     │
     │  wss://  (WebSocket, cross-origin)
     ▼
  Cloudflare (mahjong-server.<subdomain>.workers.dev)
     • the Worker: validates origin + room code, forwards
     • Room Durable Objects: one per room code, the game authority
```

- The **coach** is same-origin with the front end (relative `/api/*` URLs). It
  does **not** run on Cloudflare and needs no CORS. Its only prod requirement is
  `ANTHROPIC_API_KEY` set on Vercel.
- The **game server** is cross-origin. The browser opens a `wss://` socket to the
  Worker. That's the only cross-host hop, and the two things it needs are: the
  front end must know the Worker's URL (`VITE_GAME_SERVER`), and the Worker must
  allow the front end's origin (`ALLOWED_ORIGINS`).

The default deploy uses the Worker's free `*.workers.dev` URL, which already has
TLS — so a custom domain is **optional** (see the last section). Get the whole
thing working on `*.workers.dev` first.

---

## Env vars, by name

| Name | Where it's set | What it is |
| --- | --- | --- |
| `VITE_GAME_SERVER` | **Vercel** → Project → Settings → Environment Variables (build-time) | The Worker's `https://…` URL. The front end derives `wss://` from it. Unset in a prod build ⇒ the app throws a clear "not configured" error at connect time (by design — it will not silently dial localhost). |
| `ANTHROPIC_API_KEY` | **Vercel** (server-side; **not** `VITE_`-prefixed) | The shared coach key. Only the Vercel functions read it; it never reaches the browser bundle. Optional — without it, players use their own key (BYO) or skip the coach. |
| `ALLOWED_ORIGINS` | **Worker** `vars` in `server/wrangler.jsonc` | Comma-separated browser origins allowed to connect. Empty ⇒ allow any (dev only). Set your Vercel origin(s) in prod. Not a secret — lives in version control. |
| `ADMIN_KEY` | **Worker secret** via `wrangler secret put` | Gates `/debug` and `/reset`. Unset ⇒ those routes are disabled (safe default). **Never** put this in `wrangler.jsonc`. |

---

## Step 1 — Deploy the Worker (Cloudflare)

> **Needs your Cloudflare credentials.** `wrangler login` opens a browser to
> authorize; I can't do that for you. Run these yourself.

```bash
npx wrangler login                       # one-time browser auth
npm run server:deploy                    # = wrangler deploy -c server/wrangler.jsonc
```

`deploy` prints the live URL — copy it, you need it in Step 2:

```
  https://mahjong-server.<your-subdomain>.workers.dev
```

The `new_sqlite_classes` migration (`wrangler.jsonc` line 13) creates the `RoomDO`
Durable Object namespace on first deploy; the output line
`Your Durable Objects: ROOMS → RoomDO` confirms the binding is live. Hibernation
is automatic — DOs scale to zero when idle and wake on the next request.

Set the admin secret (optional but recommended — the `/reset` escape hatch):

```bash
npx wrangler secret put ADMIN_KEY -c server/wrangler.jsonc   # paste a random string
```

**Smoke-test the Worker alone**, before touching the front end:

```bash
curl -X POST https://mahjong-server.<subdomain>.workers.dev/api/rooms
# → {"code":"XXXXXX"}   ← a JSON room code means the Worker + DO are healthy
```

## Step 2 — Point the front end at it (Vercel)

> **Needs your Vercel dashboard.** Setting an env var and redeploying is a
> dashboard action.

1. Vercel → your project → **Settings → Environment Variables** → add:
   - `VITE_GAME_SERVER` = `https://mahjong-server.<subdomain>.workers.dev`
     (the URL from Step 1, **https**, no trailing slash) — scope: Production
     (and Preview, if you want previews to reach the same server).
   - `ANTHROPIC_API_KEY` = `sk-ant-…` — only if you want the shared coach.
2. **Redeploy.** `VITE_GAME_SERVER` is inlined at **build** time, so an existing
   deployment won't pick it up — you must trigger a new build (Deployments → ⋯ →
   Redeploy, or push a commit).

Confirm it took: open the deployed site, DevTools → Network, start a multiplayer
game, and check the socket connects to `wss://…workers.dev` — **not** `localhost`,
**not** `ws://`.

## Step 3 — Let the Worker accept that origin (CORS / WS origin)

Right now `ALLOWED_ORIGINS` is empty, which means "allow any" — fine to prove the
happy path, but lock it to your front end for production:

1. Edit `server/wrangler.jsonc`, set your Vercel origin(s):
   ```jsonc
   "vars": {
     "ALLOWED_ORIGINS": "https://your-app.vercel.app"
   }
   ```
   Include every origin the browser will actually send: your production domain,
   any custom domain, and — if you test from preview deploys — the preview origin
   (`https://your-app-<hash>.vercel.app`; preview hostnames vary per deploy, so
   during active preview testing either list the ones you use or leave origins
   open until you ship).
2. Redeploy the Worker: `npm run server:deploy`.

The Worker checks `Origin` on both the create/info HTTP calls (real CORS) and the
WebSocket upgrade (origin allowlist — WS has no preflight). A rejected origin
returns `403 origin not allowed`; that's the symptom if this list is wrong.

---

## Verify on the real internet (not localhost)

Localhost proves nothing here — the whole point is the cross-host, cross-network
path. Test it for real:

1. **Two different devices on two different networks** (e.g. laptop on wifi, phone
   on cellular). One creates a room, reads the code aloud; the other joins.
2. Play a **full hand to a win or a draw.** Watch a discard you can claim: the
   **claim window** must behave correctly across real round-trip latency, not just
   the ~0ms of a local socket.
3. **Background the phone** mid-game (switch apps, lock it) for 20–30s, come back.
   The socket drops and the client should reconnect and resync — a backgrounded
   phone is the common case, not an edge case.
4. **Coach across origins:** ask the coach from the deployed site. It's same-origin
   on Vercel, so it should just work; a failure here is a Vercel env/function
   issue, not CORS.
5. **Empty seats become server-side bots** and keep playing when a human sits out.

## When it doesn't work — check in this order

Most "multiplayer is broken" reports are one of these, top of the list first:

1. **`ws://` on an `https://` page (mixed content).** The browser silently blocks
   it. Fix: `VITE_GAME_SERVER` must be `https://…` so the derived socket is
   `wss://`. Check the console for a mixed-content warning.
2. **Front end dialing `localhost`.** Means `VITE_GAME_SERVER` wasn't set at build
   time (or you set it but didn't redeploy). After this repo's fix, a prod build
   with it unset throws "Multiplayer server not configured" instead of dialing
   localhost — so if you see *that* message, the var is missing from the build.
3. **`403 origin not allowed`** on the socket or the create call. `ALLOWED_ORIGINS`
   doesn't include the exact origin the browser sent. Match scheme + host exactly.
4. **CORS preflight failing** on `POST /api/rooms`. The Worker answers `OPTIONS`
   with the CORS headers; if the browser complains, the origin is being rejected
   (see #3) — same root cause.
5. **Durable Object not bound.** `env.ROOMS` undefined ⇒ the migration didn't run.
   Re-check `wrangler.jsonc` `migrations` + `durable_objects.bindings` and redeploy.
6. **Env var set in the dashboard but not in the build.** Vite inlines
   `VITE_*` at build time; a var added after the last build isn't in the bundle.
   Redeploy.
7. **TLS not active on a custom domain.** The `*.workers.dev` URL always has TLS;
   a freshly-added custom domain may not yet. Use `*.workers.dev` until the cert
   is issued.

---

## Optional — custom domains

Not required; `*.workers.dev` and `*.vercel.app` both have working TLS. Do this
only if you want branded URLs.

> **Dashboard steps — your access.**

- **Front end:** Vercel → Project → Settings → **Domains** → add your domain,
  follow the DNS records Vercel shows. Then add the new origin to the Worker's
  `ALLOWED_ORIGINS` and redeploy.
- **Game server:** Cloudflare → Workers → your Worker → **Settings → Domains &
  Routes** → add a custom domain, e.g. `ws.yourdomain.com` (the domain must be on
  Cloudflare DNS). Then update `VITE_GAME_SERVER` to `https://ws.yourdomain.com`
  on Vercel and **redeploy the front end** (build-time inlined).

Whenever an origin or the server URL changes, both sides need to agree again:
`VITE_GAME_SERVER` on Vercel points at the server; `ALLOWED_ORIGINS` on the Worker
lists the front end. Change one, revisit the other.
