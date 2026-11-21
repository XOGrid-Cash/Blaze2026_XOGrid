# XOGrid frontend guide

For the frontend developer. The real UI is `frontend/` (React, Vite, Tailwind). It is deployed on Vercel and reaches the Fastify API in `server/` through a `/api/*` rewrite to Render (`frontend/vercel.json`). `web/` is a small stub used to test the backend; it is not the product. This guide lists what the UI can rely on.

## Run it

    cd server && npm install && npm run dev                    # API on http://localhost:3000
    cd frontend && npm install --legacy-peer-deps && npm run dev   # Vite dev server, proxies /api to :3000
    cd frontend && npm run build                               # type-checks and writes frontend/dist

In production Vercel serves `frontend/dist` and rewrites `/api/*` to the Render API, so the browser only ever talks to its own origin (no CORS). The `vercel.json` fallback sends every non-API path to `index.html`, so client-side routes such as `/demo` and `/t/<id>` work on reload. The root `Dockerfile` / `docker-compose.yml` build one image that serves the same `frontend/dist` from the API process (`WEB_DIR`), for running everything locally.

Stack: React 19, react-router 7, Tailwind 4, Vite 8, TypeScript. `frontend/src/hub/api.ts` holds the shared API types and the `hub()` fetch helper.

## Banner values

The required top banner is `frontend/src/components/TopBanner.tsx`, rendered once in `App.tsx` above the routes, so it is on every page. It scrolls with the page. It publishes how much of it is still visible as the CSS variable `--banner-offset`; **any new `position: fixed` element pinned to the top of the screen must use `top: var(--banner-offset, 0px)`** (the navbar, the DashboardLayout sidebar and the Docs sidebar already do), or the banner will cover it. Its values come from `frontend/src/config/banner.ts`:

- `VITE_REPO_URL`: defaults to the GitHub repo.
- `VITE_EMBER_ADDRESS`: defaults to the EMBER2026 token-aware address (`bitcoincash:z...`). It must stay a token-aware address.
- `VITE_SLIDES_URL`: no default. Until it is set the banner shows "Slides: link coming soon". On Vercel add it under Settings > Environment Variables and redeploy; the value is baked in at build time.

## Public API (no login)

All responses are JSON. Errors are `{ "error": "message" }` with a 4xx status. Public GET routes send `access-control-allow-origin: *`.

| Method and path | What it does |
|---|---|
| `GET /api/health` | `{ ok: true }` |
| `GET /api/templates` | List. Query: `query` (text, max 100; matches name, description, identifier prefix, or the publisher's registered name), `badge` (`unchecked`, `auto-checked`, `reviewed`), `sort` (`newest`, `name`, `flagged`, `rating`), `page` (from 1), `pageSize` (1 to 50, default 12). Returns `{ items: Summary[], total, page, pageSize }` |
| `GET /api/templates/:identifier` | Detail: the `Summary` fields plus `template`, `auditReport`, `actions`, `roles`, `flags`, `reviews`. 404 if unknown |
| `GET /api/templates/:identifier/raw` | The template exactly as an XO tool expects it, immutable and cacheable. 404 unknown, 410 removed |
| `POST /api/templates` | Publish. Body `{ template, publisher? }`. 201 if new, 200 if it already existed. Returns `{ identifier, created, badge }`. 400 invalid template, 413 over 256 KB. Rate limited to 10 per minute |
| `POST /api/templates/:identifier/flags` | Report a template. Body `{ reason, reporter? }`. 201. Rate limited to 20 per minute |
| `GET /api/spotlight` | `{ items }`, the featured templates for the Home page |
| `POST /api/policy/evaluate` | Body `{ policy, identifier }`. Returns `{ decision: 'allow' \| 'block', reasons: string[] }`. Policy fields: `minBadge`, `blockFlagged`, `allowIdentifiers`, `blockIdentifiers` |

The TypeScript shapes (`Summary`, `Detail`, `CheckResult`, `Decision`) are in `frontend/src/hub/api.ts`; keep that file in step with the server.

### Community reviews (wallet-signed)

Any wallet can review a template. A review is a rating (whole number 1 to 5) and text (3 to 1000 characters). One review per wallet per template. Every summary and detail now carries `userReviewCount` and `averageRating` (null when unrated). Detail also carries `plainEnglish`: `{ summary, steps[], whoDoesWhat[], youWillNeed[] }`, generated from the template itself. Show it above the raw template.

| Call | What it does |
| --- | --- |
| `GET /api/templates/:id/reviews?page&pageSize` | `{ items: [{ id, reviewerAddress, reviewer (shortened), reviewerName (or null), rating, body, createdAt }], total, page, pageSize, stats: { count, average, distribution } }` |
| `POST /api/templates/:id/reviews/challenge` body `{ rating, body, publicKey? }` | Stores the review on the server and returns `{ nonce, expiresAt, message, review, walletSignRequest? }`. `walletSignRequest` is present when `publicKey` (compressed, hex) was sent |
| `POST /api/templates/:id/reviews` body `{ nonce, proof }` | `proof` is `{ type: 'transaction', signedTransaction }` or `{ type: 'message', signature }`. Publishes exactly the stored review. 201 `{ id, reviewerAddress, rating, body }` |

Flow: collect rating and text, send the challenge call with the wallet's public key, ask the wallet to sign `walletSignRequest` (same `signTransaction` path as admin login, `broadcast: false`), then post the proof. The text cannot change after the challenge. Errors: 400 bad input, 401 proof failed (start again, the nonce is single-use and lasts 5 minutes), 404 unknown template, 409 already reviewed or template removed.

Limits to be honest about in the UI copy: a review proves a wallet signed it, not that the person used the template. Anyone can make a new wallet. Moderators can hide a review (`GET /api/admin/user-reviews`, `POST /api/admin/user-reviews/:id/hide` with `{ reason }`, `POST .../unhide`). Moderator reviews (the `reviews` array and the `reviewed` badge) are separate from community reviews.

Named users: moderators can give an outside publisher or reviewer a display name and register one or more of their addresses (P2PKH CashAddress with or without prefix, or a public key; all forms of one wallet match). Summaries carry `publisherName` and community reviews carry `reviewerName`, each null when nothing is registered; show the name in place of the address and keep the address on hover. Admin routes: `GET /api/admin/users`, `POST /api/admin/users` `{ name, addresses }`, `PUT /api/admin/users/:id` `{ name }`, `POST /api/admin/users/:id/addresses` `{ addresses }`, `DELETE /api/admin/users/:id/addresses/:address`, `DELETE /api/admin/users/:id`. A name is unique (case-insensitive) and an address can belong to one user only (409 otherwise).

### Identifiers and badges

- A template identifier is a SHA-256 based hash of the template content, so it never changes for the same template and is safe to use in URLs.
- Badges: `unchecked` (no checks recorded), `auto-checked` (the automated checks found no failure, which is never a safety claim) and `reviewed` (a moderator reviewed this exact template). Always show the tooltip text for them; the badge copy is in `frontend/src/pages/TemplateDetail.tsx`.
- A removed template has `removed: true` and a `removedReason`. Do not link to its raw JSON.

## Moderator API (login required)

Login proves control of an allowlisted moderator key by signing a challenge with a WizardConnect wallet. There are no passwords.

1. `POST /api/admin/challenge` with body `{ publicKey }` (the wallet's compressed public key, hex) returns `{ nonce, expiresAt, message, walletSignRequest }`, valid for 5 minutes, single use. Without a `publicKey` the `walletSignRequest` is left out.
2. The wallet signs `walletSignRequest` (see `signWithWallet` in `frontend/src/hub/wallet.ts`), which already has `broadcast: false`. The UI builds nothing itself and needs no signing library. Nothing is ever broadcast.
3. `POST /api/admin/login` with `{ nonce, proof }` where `proof` is `{ type: 'transaction', signedTransaction }` or `{ type: 'message', signature }`. Returns `{ token, admin, expiresAt }`. A failure is always a generic 401 `Login failed.`; the real reason is only in the server log.
4. Send `Authorization: Bearer <token>` on every call below. Sessions last 1 hour. A 401 means log in again.

| Method and path | Body or query | Notes |
|---|---|---|
| `POST /api/admin/logout` | | |
| `GET /api/admin/me` | | `{ admin, expiresAt }` |
| `GET /api/admin/summary` | | Template counts by badge, open flags, review count, last 20 actions |
| `GET /api/admin/templates` | `?query&page&pageSize` | Same shape as the public list, but removed templates are included so they can be restored |
| `GET /api/admin/flags` | `?status=open` | `{ items }` with the template name |
| `POST /api/admin/flags/:id/resolve` | `{ status: 'dismissed' \| 'upheld', note? }` | |
| `POST /api/admin/templates/:identifier/review` | `{ note }` (3 to 500 chars) | One review per moderator per template. 409 if repeated |
| `POST /api/admin/templates/:identifier/remove` | `{ reason }` (3 to 300 chars) | Also clears the spotlight |
| `POST /api/admin/templates/:identifier/restore` | | |
| `PUT /api/admin/spotlight` | `{ items: [{ identifier, blurb }] }` (at most 6) | Replaces the whole list |

Moderator routes never send the open CORS header. Review and Remove stay disabled until a note of 3+ characters is typed (the server rejects shorter ones with a 400). Feature and Unfeature are always enabled: the admin page reads the live list (`GET /api/spotlight`), adds or removes one template and PUTs the whole list back (at most 6). The blurb is the typed note, or the template's description if the box is empty.

## Wallet connections

### One shared connection

There is exactly one wallet connection for the whole site, held by `WalletProvider` in `frontend/src/hub/WalletContext.tsx` (mounted in `App.tsx`). Read it anywhere with `useWallet()`: `connected`, `walletName`, `session`, `status`, `openModal()`, `disconnect()`. Do not call `startWalletSession` from a page or component; ask for the shared wallet instead.

- The navbar button, the Admin sign-in, the review form and the Demo all use it. A person connects once and every page sees the same wallet.
- `openModal()` opens the single connect modal (`ConnectWalletModal`, mounted once in `App.tsx`). Closing it keeps a connected wallet and drops an unfinished attempt.
- The modal offers Wizard Connect (Selene, Paytaca) only. WalletConnect was dropped.
- `address` is always the mainnet form (`bitcoincash:`) of the wallet's first receive address, shown shortened (`bitcoincash:qp9c…tw6y`) with `shortenAddress()`. The key is looked up with retries, so it resolves even when the wallet is slow to share it.
- The connection persists. The relay credentials are kept in `sessionStorage` (`xogrid-wallet-session`) and the provider resumes them on load, so a reload or moving between pages keeps the wallet. It ends on Disconnect, when the wallet closes it, when the tab closes, or after 20 minutes without activity on the page (`IDLE_LIMIT_MS`). Disconnect also tells the wallet (`sendDisconnect`) and forgets the stored credentials, so connecting again starts clean.
- `restoring` is true while a stored connection is being picked back up. `openModal({ redirectTo: "/dashboard" })` sends the person to that page the moment the wallet connects (the landing page navbar uses it).
- Gates: `/dashboard` and `/publish` are wrapped in `RequireWallet` (connect prompt; going back to `/` when the wallet disconnects). `/admin` renders the 404 page unless a wallet is connected or a moderator session exists. All of this is front-end only: the public read API stays public and the server still checks moderator tokens on every admin request. The publish form sends the wallet address as `publisher`.
- Admin login does not end the wallet connection, and neither does leaving a page.

### The Demo page

`pages/Demo.tsx` is a hero, a template chooser and the chosen template's view. The chooser (`components/demo/TemplatePicker.tsx`) shows the two templates that run live as cards, the Claim-Code Voucher and Drip Mine; every other registry template is a button that opens a guide (`components/demo/TemplateGuide.tsx`: what it does, who does what, the automated safety checks). The voucher view has two tabs, "Create a voucher" and "Claim a voucher", and a link with a claim code opens on the claim tab. Drip Mine shows `components/hub/RunDripMine.tsx` above its guide; the same panel is on the Drip Mine template page.

The demo talks to wallets through one interface, `WalletConnector` in `frontend/src/voucher/wallet.ts`:

- `start(onStatus, onReady)` returns `{ uri, qrUri }` for the QR code
- `keys(scanPerPath)` lists the public keys the wallet shares
- `sign(request, pathName, addressIndex)` returns signed transaction hex
- `stop()`

`WizardConnectWallet` implements it and is tested with Selene and Paytaca. The Demo does not start its own connection: it calls `adopt(session.manager)` to use the shared one, and `stop()` only lets go of it (it never closes the shared connection). Another connection method (WalletConnect, a future XO wallet connection) only needs another class with these four methods. The wallet signs a transaction the page built, and the page checks the result before anything is sent.

### Rules that must not be relaxed

- `frontend/src/voucher/xo.ts` builds the voucher's lock, unlocking script and transactions with the XO engine from the registry template. `frontend/src/voucher/core.ts` is an independent libauth implementation, and every build in `xo.ts` is compared with it byte for byte; a difference refuses the transaction. Both are covered by `server/test/voucher-demo.test.ts`, `server/test/voucher-engine.test.ts` and `server/test/spend-probe.test.ts`. Restyle the UI freely, but change `xo.ts` or `core.ts` only together with their tests and one real chipnet run.
- Never broadcast a wallet-signed transaction unless `verifySignedIssue` returned `valid`. Never remove that check.
- The claim code is shown before broadcasting and is never stored or sent to a server. The claim link keeps it after the `#`.
- Mainnet needs the explicit real-money confirmation. Chipnet is the default.
- Coins that carry CashTokens are never spent by the demo. `chain.ts` filters them.

## Pages and routes

| Route | File (in `frontend/src/`) | Purpose |
|---|---|---|
| `/` | `pages/Landing.tsx` | Intro and featured templates |
| `/explore` | `pages/Explore.tsx` | Search, badge filter, paging |
| `/t/:identifier` | `pages/TemplateDetail.tsx` | Detail, audit report, reviews, flag form, policy preview |
| `/publish` | `pages/Publish.tsx` | Publish a template |
| `/policy` | `pages/Policy.tsx` | Wallet trust policy preview |
| `/demo` | `pages/Demo.tsx` | Live demo: the Claim-Code Voucher and Drip Mine run live (chipnet and mainnet), other templates open as guides |
| `/docs` | `pages/Documentation.tsx` | In-app documentation |
| `/admin` | `pages/Admin.tsx` | Moderator login and tools (inside `layout/DashboardLayout.tsx`, like `/dashboard`, `/explore`, `/publish`, `/policy`) |
| `/dashboard` | `pages/Dashboard.tsx` | Still shows mock data (see HANDOFF.md) |

## Quick checks before you push

    cd frontend && npm run build     # type-checks and builds
    cd server && npm test            # all tests must pass

