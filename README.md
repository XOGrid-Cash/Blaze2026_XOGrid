# XOGrid

**A registry for XO templates, with a live demo that sends real BCH.** Think "Docker Hub for XO templates": anyone can publish a template, get a content-addressed identifier, see automated audit results, read community reviews and flags, and run the templates that have a live demo.

Built for **BCH BLAZE 2026** (Mainnet Track, Community Choice and the Build with XO bounty).

- **Live demo:** https://xogrid.vercel.app/
- **Slides:** https://docs.google.com/presentation/d/1R0smlqpU49TfTEWwDbPZYxJXsCHA2I0p/edit?rtpof=true&sd=true
- **Demo video:** https://youtu.be/IKGwZDHtyhk
- **Repository:** https://github.com/XOGrid-Cash/Blaze2026_XOGrid
- **EMBER2026 donations (CashTokens address):** `bitcoincash:zqvx6mew37u62g3zvzfwn38y4vfce9dkug7jlkxatw`

## Why it exists

An XO template describes who does what in a transaction, and a wallet will build and sign it. That makes templates easy to share and also easy to get wrong: a template can compile fine and still send funds somewhere you did not expect. The XO team has said scenarios are "not suitable for providing trust", and that a registry with audit flags, reputation and fetch-by-identifier is the direction they want. XOGrid is a first working version of that registry.

- A template's identifier is a hash of its exact text, so the same content always has the same identifier and any change makes a new one.
- Every published template is audited automatically, and the report says what was checked, never that a template is "safe".
- People can review, rate, flag and categorise templates. Reviews are signed by a wallet, one per wallet per template.
- A wallet policy preview shows how a "only reviewed, nothing flagged" rule would treat any template.
- Two templates run live in the browser so a visitor can watch a template turn into a real transaction.

## Try it in two minutes

1. Open the [live demo](https://xogrid.vercel.app/) and go to **Explore**. Eleven templates are listed, each with an audit badge, categories and a rating.
2. Open a template. Read its plain-English steps, the seven audit checks, the reviews and the credits. Download the exact JSON.
3. Go to **Demo**.
   - **Claim-Code Voucher:** create a voucher, copy the claim link or the code, then claim it from the other tab.
   - **Drip Mine:** press "Run one for me". The server spends one coin and the payout goes to the miner as the transaction fee.
4. Choose **Practice mode** (chipnet, test coins) or **Real BCH** (mainnet, needs a tick box to confirm). The page shows the transaction id and a block explorer link.

Both demos have been run on **chipnet and mainnet** by the team and the Drip Mine run touches none of a visitor's keys or funds.

## What is in it

**The registry (server)**

- Publish, list and fetch templates by identifier. The exact stored text is served at `/api/templates/<identifier>/raw`, because the identifier is a hash of that text.
- Seven automated audit checks, described below.
- Badges: `unchecked`, `auto-checked` (no failing check, which is not a safety claim) and `reviewed` (a moderator reviewed this exact identifier).
- Community flags, shown prominently and never silently hidden.
- Wallet-signed reviews: the reviewer proves control of a wallet key, the signed message includes the SHA-256 of the review text, and the first review per key per template wins. Moderators can hide a review.
- Categories (payment, identity, tokens, staking, chipnet). A template can be in several, and the filter lives in the address (`/explore?category=tokens`).
- Wallet policy preview (`POST /api/policy/evaluate`): a small JSON policy such as "reviewed or better, nothing flagged" applied to any template.
- Moderator portal with wallet login (WizardConnect or a signed message), a moderator allowlist, display names for publisher and reviewer addresses, a featured-template spotlight, and a moderation log.

**The web app (frontend)**

- Home, Explore (search, category filter, clickable cards), template page (reviews, audit report, contents, credits, copy and download JSON), Publish (drag and drop a `.json` file), Policy, Documentation, Admin and Demo.
- A shared wallet connection (WizardConnect, QR on open) used for reviews, admin login and the Demo.
- A signing prompt that says plainly whether a request only proves who you are or moves funds.
- The required BLAZE banner on every page: slides, repository and the EMBER2026 donation address (copy button and QR).

**Template tools (`templates/`)**

- One folder per contract system, each with the contract, the XO template, tests that prove the template builds exactly the contract, and a chipnet script.
- A separate invitation tool (`templates/web`) that builds ready-to-import XO invitations for Drip Mine, Token Burner and a Badgers Stake release.

## The audit

Every template gets the same seven checks, versioned by a checker version (currently 2). Templates audited by an older checker are re-audited when the server starts.

| Check               | What it does                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Template schema     | `parseTemplate` must accept it. An invalid template is refused (400) and never stored.                                    |
| Template size       | Over 256 KB is refused (413). A large one warns.                                                                            |
| Template identifier | The stored text must be the canonical form. A different key order only warns.                                               |
| Internal references | Roles, actions, scripts and variables that are used must be defined.                                                        |
| Offline compile     | Every locking script that can be compiled offline is compiled. Scripts that need keys or secrets are skipped, never failed. |
| Test scenarios      | Never fails. Warns when none are included.                                                                                  |
| Resource links      | Never fails. Warns when a resource is not a plain `https` link. The frontend does not make a flagged address clickable.   |

## Built by the XO engine, checked by a second implementation

The two live demos do not trust a single code path with real money.

1. The **XO engine** compiles the template's locking script and builds the transaction from an XO invitation.
2. An **independent implementation written with libauth** builds the same transaction by hand.
3. The run is **refused unless both produce identical bytes and the same transaction id**.
4. The BCH 2026 virtual machine then checks the transaction against the contract.
5. Only then is it signed (voucher) or broadcast (Drip Mine).

So a change in the engine cannot put a different transaction in front of a wallet or onto the network unnoticed. The independent builder also checks that an encoded outpoint matches the coin's transaction id in wire order. That check exists because of a real bug we hit: libauth reverses an outpoint hash itself when it encodes, so reversing it first pointed a transaction at a coin that does not exist. Every local test passed and only a real chain rejected it.

- **Claim-Code Voucher** runs in the browser (`frontend/src/voucher/xo.ts` against `core.ts`). The issuer locks satoshis to the hash of a secret code; whoever knows the code can claim them. It is an original template written for this project. A code works exactly once, and because the code becomes public when the claim is broadcast, someone watching the mempool could race it, so keep amounts small.
- **Drip Mine** runs on the server (`server/src/run-drip-mine.ts`). A Drip Mine coin needs no signature, so the server builds, checks and broadcasts the spend, with failover between Electrum servers and a retry when another coin is taken. Mainnet needs an explicit confirmation, and the run endpoints are rate limited.

## The templates

Eleven templates are seeded: six built in and five community-sourced. Community templates wrap **live, unchanged contracts** so XO wallets use the same addresses as the original apps. Each one credits its author, source commit and licence in its folder README and in the template's `resources`.

| Template                                                   | What it does                                                              | Origin                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| p2pkh, faucet, multisig, wrapped BCH (mainnet and chipnet) | Reference templates from the XO templates package                         | XO team                                               |
| **Claim-Code Voucher**                               | Lock satoshis to a secret code's hash; whoever knows the code claims them | XOGrid, original                                      |
| [Drip Mine](templates/drip-mine/)                           | A shared pot released to miners a little at a time                        | bitcoincashautist (contract), 2qx (vox.cash/drip app) |
| [Token Burner](templates/token-burner/)                     | Provably burn CashTokens                                                  | Dagur Valberg Johannsson (tokenburner.cash)           |
| [Badgers Stake](templates/badgers-stake/)                   | Stake BCH for BadgerCoins                                                 | SayoshiNakamario (badgers.cash)                       |
| [Block Points](templates/block-points/)                     | Coin-age reward vault                                                     | 2qx (vox.cash/bpt)                                    |
| [Revenue Split](templates/revenue-split/)                   | Pay three fixed recipients at fixed percentages                           | XOGrid                                                |

Badgers Stake's upstream repository states no licence, so its copy is for verification and review, with attribution. See its README.

## How it fits together

```
 Browser (React, Vite, Tailwind)  ──  Vercel
   │  /api/*  (rewrite, same origin, no CORS)
   ▼
 API server (Fastify)  ──  Render
   ├─ registry, audit, reviews, flags, categories, policy, admin
   ├─ Drip Mine live run  →  Electrum servers (mainnet and chipnet)
   ▼
 Database  ──  Supabase PostgreSQL in production, SQLite file locally

 Voucher: built in the browser with the XO engine, signed by the visitor's wallet (WizardConnect)
```

## Status and honest limits

- **Tests:** 301 server tests in 19 files pass (`cd server && npx vitest --run`). The tests so far run on SQLite. Production is PostgreSQL, and `npm run test:postgres` runs the suite against a scratch Postgres database.
- **Live runs:** the voucher and Drip Mine were run by the team on chipnet and mainnet. Everything else about wallets and the chain (the WizardConnect relay, live Electrum, behaviour in every wallet) is checked by hand on live networks, not in the automated tests.
- **On-chain review receipts are built but switched off** (`RECEIPTS=1` turns them on). A review can be recorded as a small transaction carrying an `XGRD` OP_RETURN with the template identifier, the rating and a hash of the text. The flow is type-checked and tested against fakes, and is not enabled in the live site. The design and the reasons for it are in [docs/REVIEW_TRACKING.md](docs/REVIEW_TRACKING.md).
- **Only the voucher and Drip Mine run live.** Every other template opens as a guide (what it does, who does what, the automated checks, download the JSON). No invites yet for Revenue Split, Block Points or Badgers staking: whether an XO wallet adds the user's own coin and signature on import has not been tested, so we do not present it as working.
- **Auto-checked is not safe.** A badge says what was checked.
- The categories are a fixed list and moderators re-file templates through the API (no admin button yet).
- We do not verify block headers: the receipt layer recomputes transaction ids and trusts the chain server's confirmation count.

## Run it locally

You need Node 22 or newer.

```bash
# API on http://localhost:3000 (SQLite file in server/data by default)
cd server && npm install && npm run dev

# Web app on http://localhost:5173, proxying /api to :3000
cd frontend && npm install --legacy-peer-deps && npm run dev

# Everything in one container
cp .env.example .env && docker compose up --build
```

Leave `DATABASE_URL` unset for local work so nothing touches the live database. Set `ADMIN_IDENTITIES="label=<public key, P2PKH address or xpub>"` to sign in to the moderator portal; the Admin page prints the exact entry to add if a login is rejected.

Checks before a push:

```bash
cd server && npx tsc --noEmit -p . && npx vitest --run
cd frontend && npx tsc --noEmit -p . && npm run build
cd templates && npm install --legacy-peer-deps && npm run typecheck && npm test
```

## Deploy

The site runs on free tiers: the frontend on Vercel, the API on Render (Docker, root directory `server`) and the database on Supabase PostgreSQL. `frontend/vercel.json` rewrites `/api/*` to Render. Environment settings and a post-deploy checklist are in [docs/DEPLOY.md](docs/DEPLOY.md). `VITE_SLIDES_URL` sets the slides link in the banner and is read at build time.

## Repository layout

```
server/      Fastify API, registry, audit checks, reviews, admin, live runs, vitest tests
frontend/    React web app, the XO voucher engine build and its independent check
templates/   one folder per contract system, plus web/ (the invitation tool)
docs/        deploy guide, frontend guide, template guide, review-tracking decision record
```

## Docs

- [Deploy guide](docs/DEPLOY.md)
- [Frontend guide](docs/FRONTEND.md), including the public API
- [Writing and adding templates](docs/TEMPLATES.md)
- [Review tracking: the design and what we chose not to build](docs/REVIEW_TRACKING.md)
- [Contract systems and their credits](templates/README.md)
- [Scope](docs/SCOPE.md) and [Build spec](<docs/XO%20SPEC.md>)
- [Handoff notes](HANDOFF.md)

## How this was built

The build window opened on Nov 14. The registry server, the audit and the first web app were prototyped before that, in the original repository (StrungSafe/Blaze2026, public history), and were brought into this repository in stages. The XO engine builds and the independent cross-check, the live Drip Mine runs, the voucher, the mainnet transactions, the community templates, categories, wallet-signed reviews, the Demo page and the polish were built here during the window.

## Credits and licence

The community templates are the work of their original authors, credited in each folder. XOGrid's own code is under the [MIT licence](LICENSE). Contracts adopted from other projects keep their own licences, noted in each template's README.
