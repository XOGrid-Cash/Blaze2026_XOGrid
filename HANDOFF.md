# XOGrid handoff (state at 2026-11-21, morning Lagos time)

Read this first, then `xogrid-dump.txt` (made by `dump_xogrid.sh`, see section 11). This file replaces the earlier handoff of 2026-11-20. Where this file and any older handoff disagree, this file wins.

## 1. Project in one paragraph

XOGrid is a "Docker Hub for XO templates", built for BCH BLAZE 2026. A registry stores XO wallet templates, audits them, lets people review, rate, flag and categorise them, and shows them in a web app. Team: Nathaniel (angelnath) owns the server, registry, audit checks, admin login, wallet-signed reviews, on-chain review receipts, categories, the Claim-Code Voucher template and the docs. John owns `frontend/` (the real UI) and pushes often. Miguel owns hosting (Render, Supabase, Vercel) and the extra templates in `templates/`. Submission is **Nov 22, 15:00 UTC+1**.

Repo: `XOGrid-Cash/Blaze2026_XOGrid`, local clone `~/XOGrid`. Layout: `server/` (Fastify, Kysely, SQLite locally and PostgreSQL in production, vitest), `frontend/` (React, Vite, Tailwind), `templates/` (one folder per contract system, plus `web/`, the separate invitation tool at xogrid-invite.vercel.app), `docs/`. libauth is `3.1.0-next.8`.

## 2. Working rules (keep following these)

- `frontend/src/voucher/xo.ts` builds the voucher through the XO engine, and `frontend/src/voucher/core.ts` is the independent libauth implementation it is compared with, byte for byte. Never touch either without tests, and never weaken the comparison. Never broadcast unless `verifySignedIssue` passes. Voucher bytes variables are passed as HEX text, never as a raw `Uint8Array`.
- Commits carry **no Claude attribution** (the user's standing rule overrides any tool reminder to add Co-Authored-By lines).
- Do not write the user's Build with XO feedback; give notes on what happened. The README says plainly that the server and first web app were prototyped before Nov 14.
- The database URL lives only in Render. Never point `TEST_DATABASE_URL` at the live database.
- Tell John to pull before he pushes after every delivery.
- **Deliver one install script per batch.** A script writes every new file to its own path and applies exact-string edits to existing files, all or nothing and safe to run twice (see section 10). Do not send several same-named files for the user to download separately (the user was confused by two files named `categories.ts`). Always state each destination path in a table.
- Run `tsc --noEmit -p .`, the tests and `npm run build` before delivering code. Prove an install script on pristine copies of the files (apply, apply again, compare byte for byte, and break one anchor to confirm nothing is written).
- Never claim anything wallet-related or chain-related is verified: the sandbox cannot reach the WizardConnect relay or live Electrum. Say "type-checked and tested against fakes".
- Every change to a transaction builder needs one real chipnet run before it counts as done. The outpoint byte-order bug (section 3) passed every test and only a real chain rejected it.
- Corrected files are delivered directly, not explained first. Terminal commands come one at a time with checkpoints. Use `python3 << 'PYEOF'` for file writes with special characters, never bash heredocs for those.
- Start each session with a full codebase dump (`dump_xogrid.sh`) before writing code. End with a handoff document.

## 3. What exists and works

### Registry and server (`server/src`)
- Five community templates plus six built-in ones (p2pkh, faucet, multisig, wrapped BCH, wrapped BCH chipnet, Claim-Code Voucher) = 11 templates. `seedCommunity()` runs on **every server start** (`SEED_COMMUNITY=0` turns it off); `seed()` runs only on an empty database. Community template JSON is vendored in `server/src/templates/community-data.ts`, **generated** by `server/scripts/sync-community-templates.mjs` from `templates/<slug>/template.json`; a test fails if they drift.
- Community identifiers (each must match its README, enforced by test): badgers-stake `991a7bbd...66e7`, block-points `9941f723...3e5a`, drip-mine `346048b2...1185`, revenue-split `b17ba2ee...654e`, token-burner `1ef44c32...47e0` (full values in `templates/community.ts`).
- Audit has **seven** checks (schema, size, identifier, references, compile, scenarios, resources). `CHECKER_VERSION` is `2`. `reauditStale()` re-audits at startup only templates whose newest report is older. The resource check warns (never fails) on anything that is not a plain https link.
- `describe.ts` turns `$(<fundSatoshis>)` style placeholders into readable text in the plain-English steps.
- Wallet-signed community reviews: `user-reviews.ts`. Challenge, then wallet proof (transaction proof for WizardConnect, or message proof), one review per wallet key per template (the first wins), the signed message includes `text sha256: <sha256(body)>`. Moderators can hide reviews.
- Admin login by wallet signature against the allowlist from `ADMIN_IDENTITIES`.

### Live runs and the XO engine (new, Batch F)
- **Drip Mine live run (server, `server/src/run-drip-mine.ts`).** `GET /api/run/drip-mine/coins` (30 per minute) lists the coins at the shared address; `POST /api/run/drip-mine` (6 per minute) spends one. A Drip Mine coin needs no signature, so nothing touches a visitor's keys or funds, and the payout goes to the miner as the transaction fee. Mainnet needs an explicit confirmation. The run retries other coins when one is already taken (`anyCoin`) and fails over between Electrum servers. `POST /api/run/drip-mine/invitation` (20 per minute) builds and checks the same spend (XO engine, independent builder, VM) but broadcasts nothing: it returns the serialized XO invitation (throwaway-key commits, coin value on the input, expires in about 5 hours) for the user's own wallet to import and broadcast, so it needs no mainnet confirmation.
- **Built by the XO engine.** The engine compiles the lock and unlocking script from the registry's Drip Mine template (startup refuses if the template no longer compiles to the shared address), then builds the spend from an XO invitation: the outpoint, sequence number 1, and the remainder by the template's own payout rule. An independent libauth builder (`buildDripTransactionIndependent`) builds the same spend, and the run is refused unless the transaction and its id match byte for byte. The BCH 2026 virtual machine then checks it against the contract, and only then is it broadcast. The answer carries `builtBy` (engine and template identifier), which the page shows.
- **Voucher on the XO engine (frontend, `frontend/src/voucher/xo.ts`).** Same approach for the voucher: issue, signing request, check of the signed transaction and claim all come from the engine and the vendored `claim-voucher.template.json`, each compared with `core.ts`. The engine packages bundle in Vite through small stand-ins in `frontend/stubs/` (`fs`, `path`, `better-sqlite3`, `indexeddbshim`), aliased in `vite.config.ts`.
- **The outpoint byte-order bug (fixed in b854dd9).** libauth reverses an outpoint hash itself when it encodes, so the hash is given in the same order as the transaction id text. Reversing it first reversed it twice and pointed the transaction at a coin that does not exist. Local tests passed and only a real chain rejected it. Receipt transactions had the same bug and were fixed in the same commit. The independent builder now throws if the encoded outpoint is not the coin's transaction id in wire order.
- Tests: `server/test/run-drip-mine.test.ts`, `run-engine.test.ts`, `run-failover.test.ts`, `voucher-engine.test.ts`.

### Demo page (`/demo`, redesigned 2026-11-21)
- A hero, a template chooser and the chosen template's view. The chooser has two cards for the templates that run live (Claim-Code Voucher, Drip Mine) and a button for every other registry template, which opens a guide.
- **Voucher:** network choice (Practice mode is chipnet; Real BCH is mainnet and needs a tick box), tabs "Create a voucher" and "Claim a voucher" (a claim link opens on the claim tab), the site-wide wallet connection, coins found automatically, quick amounts, a plain breakdown of fee and change, copy buttons for the claim link and the code, and a clear message when the network did not confirm the voucher.
- **Drip Mine:** `RunDripMine.tsx` ("Run one for me", run a chosen coin, or "Copy invitation" for a chosen coin to run it from your own XO wallet), then the guide. Template pages link to the demo (`config/demos.ts`, `/demo?template=<identifier>`) rather than embedding the panel.
- **Other templates:** `TemplateGuide.tsx` (what it does, who does what, automated safety checks, download JSON).
- Files: `frontend/src/pages/Demo.tsx`, `frontend/src/components/demo/TemplatePicker.tsx` (props `selected`, `live` as a list of `{identifier, name, blurb, icon}`, `onSelect`), `frontend/src/components/demo/TemplateGuide.tsx`, `frontend/src/components/hub/RunDripMine.tsx`. Delivered by `install_demo_redesign.py`.

### Other changes since the last handoff (commit titles)
- Receipts switched off by default (`RECEIPTS=1` enables); template page reordered (reviews before technical details, visible badge meaning, better contrast); slides banner; server install fixed on npm 12 (prebuilt better-sqlite3, allowScripts); Explore and Home featured template cards are clickable; dashboard with a collapsible sidebar and a Demo entry; template contents show what kind of part each link points to; named users (admin-managed display names for publisher and reviewer addresses); the voucher finds coins automatically and faster.

### On-chain review receipts (Batch D, switched off by default)
- Receipts are off unless `RECEIPTS=1` is set (`receipts-setup.ts` logs that they are switched off, and the page hides the step when there is no config). The flow is built and tested against fakes. See item 7 of `docs/REVIEW_TRACKING.md`.
- `review-receipt.ts`: builds and parses receipts. OP_RETURN is `6a 46` + 70 bytes: `XGRD`(4) | version 0x01 | template identifier(32) | rating(1) | SHA-256 of review text(32). The transaction pays at least 546 sats to the review address. The parser checks structure and the signer's key (input 0 must be `<sig> <33-byte compressed key>` and the key must hash to the P2PKH output it spends); it does not check signatures. Transaction id = `hash256(encodeTransaction(tx)).reverse()` (checked against the Bitcoin genesis coinbase; libauth's `hashTransactionUiOrder` gave a different value on that input, so it is not used).
- `review-address.ts`: the review address is derived from the admin identity (public key, P2PKH address, or first child of an xpub). Same key gives a mainnet (`bitcoincash:`) and a chipnet (`bchtest:`) address. `REVIEW_IDENTITY_LABEL` picks an admin by label, otherwise the first usable one.
- `electrum.ts`: a minimal Electrum client (one TLS connection per call, JSON-RPC): get transaction (verbose, for confirmations), list unspent, broadcast. Defaults `bch.imaginary.cash:50002` and `chipnet.imaginary.cash:50002` are **unverified**.
- `review-chain.ts`: `prepareReceipt` (unsigned transaction: 546 to the review address, the OP_RETURN, change; one plain coin from the wallet's first receive address; fee rate 1.5 sat/byte), `broadcastReceipt` (checks one input, receipt matches the review, signature valid in the BCH VM, fee at most 10,000 sats, then sends), `attachReceipt` (look up a given transaction, recompute its id, check it, record pending or confirmed; a confirmed receipt is never replaced), `refreshPendingReceipts` (re-check when reviews are read, at most once a minute per review).
- `receipts-setup.ts`: builds the config at startup. Receipts are off, with a log line, if there is no usable admin identity.
- Routes: `GET /api/receipts/config`; `POST /api/templates/:identifier/reviews/:id/receipt/prepare` {network, publicKey}; `.../receipt/broadcast` {network, signedTransaction}; `.../receipt` {network, txid or signedTransaction}. Reviews list now carries `receipt: {txid, network, status}`.
- DB: `user_reviews` gained `receipt_txid`, `receipt_network`, `receipt_confirmed` (added on startup by `upgradeSchema`).
- Frontend: `RecordOnChain.tsx` (optional step after a review is published: network choice, cost, sign, send, poll), `receipts.ts` (explorer links), badge on each review in `TemplateDetail.tsx`, `signWithWallet(session, request, kind)` where kind "transaction" shows the "moves funds" wording.
- Money: each receipt sends 546 sats to the team-controlled review address; the network fee (about 460 sats) goes to the miner, not to XOGrid. Sweeping a 546-sat coin costs about 220 sats, so net about 300 each.

### Template categories (new, Batch E; install script written, check that it was applied)
- A fixed list in `server/src/categories.ts`: payment, identity, tokens, staking, chipnet (the user asked for payment, identity, chipnet and "all"; tokens and staking were added to fit our templates). To change the list, edit `CATEGORIES` there.
- A template can be in several. Stored in a new table `template_categories (identifier, category)`, created on startup. The category is metadata, not part of the template JSON, so identifiers are unchanged.
- API: `GET /api/categories` (counts of live templates per category and the total), `GET /api/templates?category=slug` (unknown slug gives 400), `POST /api/templates` accepts `categories: [...]` (unknown names are refused and nothing is published), `PUT /api/admin/templates/:identifier/categories` (moderators only; no button in the admin UI yet). Summaries carry `categories`.
- First publisher files a template; re-publishing cannot re-file it unless it has no categories yet. `seedCategories()` files the built-in and community templates only when they have none, on every start, so a moderator's change is never undone.
- Built-in filing: payment (p2pkh, faucet, multisig, wrapped BCH, voucher, revenue-split), tokens (wrapped BCH, wrapped BCH chipnet, token-burner, block-points, drip-mine), staking (badgers-stake, also payment), chipnet (wrapped BCH chipnet). Identity is empty until someone publishes one.
- Frontend: `CategoryFilter.tsx` ("All templates" plus a chip per category with counts; the choice lives in the address as `/explore?category=slug`), `CategoryPicker.tsx` on the Publish page (optional, any number), category chips on Explore cards and on the template page (links to the filtered Explore), `hub/categories.ts` (fetch once, label helper). "All templates" stays the default main view.

### Frontend (other)
- Template detail: Sources and credits, Template contents (collapsible), Copy JSON and Download .json (from `/api/templates/:id/raw`), "Build an invitation" link for the three templates the invitation tool supports (`frontend/src/config/inviteTool.ts`, override with `VITE_INVITE_TOOL_URL`).
- Publish page: drag and drop (one `loadFile()` check: .json, 256 KB, one file).
- Wallet: shared connection in `hub/WalletContext.tsx`; connect modal starts the QR on open; damaged stored sessions are discarded.
- Signing prompt: `hub/signing.ts` (`trackSigning`) and `components/SigningPrompt.tsx`. "proof" (nothing moves) and "transaction" (moves funds) wordings.
- Review form (`ReviewForm.tsx`): after a review is published the form stays closed (remembered per template in `localStorage` as `xogrid:reviewed:<identifier>` and `xogrid:review-id:<identifier>`); "already reviewed" from the server also closes it. This fixed a bug where the sign-in form came back after publishing, probably because reloading the page data remounted the form (cause not confirmed in a browser).
- Navbar has Explore. John added search, shortcuts and CashAssembly formatting to template contents.

### Invitation tool (`templates/web`, Vercel)
- Drip Mine and Token Burner panels. **Badgers Stake release panel**: lists locks at the live mainnet contract address, reads each lock's commitment, enables Release only when the lock period has passed, builds an invitation whose three outputs (BadgerCoins, Honey NFT receipt, released BCH minus 3000 sats) go to the staker. 10 tests.

## 4. Environment settings

Server (Render): `DATABASE_URL` (PostgreSQL; wins when set) or `DATABASE_PATH` (SQLite file), `PORT`, `HOST`, `WEB_DIR`, `SEED_ON_EMPTY`, `SEED_COMMUNITY`, `ADMIN_IDENTITIES` (`label=identity,...`; identity is a public key, a P2PKH address or an xpub), `RECEIPTS=1` (turns on-chain review receipts on; off by default), `REVIEW_IDENTITY_LABEL` (optional, receipts only), `ELECTRUM_MAINNET` and `ELECTRUM_CHIPNET` (`host:port`, TLS; `tcp://host:port` for plain, local testing), `ELECTRUM_INSECURE_TLS=1` (accept self-signed certificates), `TEST_DATABASE_URL` (scratch database only, for `npm run test:postgres`).
Frontend (Vercel): `VITE_API_URL`, `VITE_INVITE_TOOL_URL`, `VITE_SLIDES_URL` (unset; the banner says "Slides: link coming soon").
At startup the server logs the moderators. When receipts are on it also logs `Review receipts on mainnet: <address>` and on chipnet; check that these addresses are ones the team controls.

## 5. Decisions made, and why

| Decision | Why |
|---|---|
| Seed community templates on every start, not only when empty | The live Supabase DB already has data. `seedCommunity()` never touches the Home spotlight and never revives a removed template. |
| Vendor `template.json` into `server/src` via a generated file | The Render image contains only `server/`. A test compares it with `templates/*/template.json`. |
| Export serves `/raw`, not a re-stringified object | The identifier is a hash of the exact text. |
| Resources are untrusted: https links only, plain text otherwise; check warns, never fails | A `javascript:` URL was accepted and badged `auto-checked`; the frontend is the real defence. A bad link cannot be clicked, so failing would block valid templates. |
| One shared `trackSigning` wrapper | Reviews, admin login and the Demo all get the same prompt. |
| Invitation tool defaults to chipnet; mainnet needs an explicit real-money confirmation | Money-path rule. Badgers release panel opens on mainnet because its contract exists only there. |
| Existing files are changed by exact-string scripts, never overwritten (a whole-file replacement is allowed only when the script first checks the file is unchanged since the dump) | John and Miguel push often. |
| **Live runs: the XO engine builds, an independent libauth builder cross-checks, and nothing is sent unless both agree** | A change in the engine can never put a different transaction in front of a wallet or onto the network unnoticed. |
| Drip Mine is run by the server, not the browser | A Drip Mine coin needs no signature and no visitor funds; the server builds, checks in the BCH 2026 VM and broadcasts, with failover between Electrum servers and a retry when a coin is taken. |
| Receipts are off by default (`RECEIPTS=1` turns them on) | Shelved for the submission (commit f20ba8e); see item 7 of `docs/REVIEW_TRACKING.md`. |
| **Review tracking is a hybrid**: pay one review address and carry an `XGRD`-prefixed OP_RETURN | The address makes history findable with plain Electrum; the prefix makes a payment recognisable and filterable; the 546 sats plus fee give each review a small cost. Prefix-only needs an indexer; address-only cannot tell reviews from stray payments. |
| Only the text's hash goes on chain | OP_RETURN is small (70 bytes used of 223 allowed); the text stays on the server. |
| **Earliest confirmed receipt per key and template wins** (not latest) | It matches the existing database rule "one review per wallet per template, first wins", so a key cannot change its rating with a second receipt. |
| On-chain receipts are an optional layer; **one list with a badge** | The database review stays the main record. A receipt with no matching review counts for nothing, so spam transactions cannot move ratings. |
| The review address is derived from the **admin identity**, for mainnet and chipnet | The key the team already holds controls the coins; no new key to look after. |
| The wallet **only signs**; the server checks, then sends | Follows the rule never to broadcast without verification. The server checks one input, receipt matches the review, VM signature check, fee at most 10,000 sats. The first design had the wallet broadcast; it was changed. |
| The server attaches **a given transaction** (Option A), not a full scan of the address | Far less work before the deadline and enough to show a receipt can be found and verified. |
| Transaction id is recomputed from the bytes; the chain server's confirmation count is trusted | No block-header check. Stated openly as a limit. |
| One-input receipts from the wallet's first receive address; smallest confirmed coin that fits; token coins never used | Keeps the wallet signing request to one path; avoids burning tokens. |
| Page: on-chain step is **opt-in**, chipnet is the default network, cost and "not verified with every wallet" shown | Real money on mainnet; wallet behaviour unproven. The review is already published whatever happens. |
| Pending receipts re-checked by the server whenever reviews are read (once a minute per review) | A receipt confirms even after the reviewer leaves the page. |
| Review form remembers "reviewed" in the browser | Page reloads must not bring the form back; the server still enforces one review per wallet. |
| Categories: fixed list, many-to-many table, metadata outside the template JSON | Identifiers stay hashes of the exact text; a template can be in several categories. |
| First publisher files a template; moderators can re-file; seeding only fills empty templates | Nobody can re-file someone else's template by publishing it again; restarts never undo a moderator. |
| Category filter lives in the address (`?category=`); "All templates" is the default | Shareable filtered views; the full list stays the main view. |
| Explore card keeps the publisher label above the name; category chips sit below the rating | Minimal change to John's layout. Open question: replace the publisher label with chips? |

## 6. Things we chose NOT to do (and why)

- **No review by XO invitation (item 8).** It needs the importing wallet to add the reviewer's own coin and signature. Whether an XO wallet does that on import cannot be tested here, so nothing is presented as working. Build it only after one chipnet import has worked.
- **No invites for Revenue Split, Block Points or Badgers' own staking yet.** Same unknown. If built, label them "verified up to this point".
- **No full history rebuild from the review address** (Option B), no block-header or merkle verification, no receipts spending more than one coin.
- **No claim that the build itself verifies wallet or chain behaviour.** The sandbox cannot reach the WizardConnect relay or live Electrum. Live results are the user's own runs, listed in section 7.
- Only the Claim-Code Voucher and Drip Mine run live on the Demo page; every other template opens as a guide.
- No audit failure for bad resource links (warning only).
- No whole-file overwrites of existing files; scripts only. (New files may be written whole.)
- No admin-UI button for categories yet (the route exists).
- No user-created categories (fixed list only).
- No Postgres run of the new tests and the new tables (SQLite only). `npm run test:postgres` needs a scratch database.
- No Claude attribution lines in commits.
- No merging of `apply_batch_e1.py` / `apply_batch_e2.py` with the new script: they are superseded by `install_categories.py` and should not be run.

## 7. Verified and still to check

| Verified | Still to check |
|---|---|
| Frontend (2026-11-21, for the Demo redesign): `tsc --noEmit` clean, `vite build` passes, `oxlint` shows the same four warnings as before | The redesigned Demo page in a real browser, on a phone and a desktop (it was type-checked and built, not looked at) |
| Server tests: 19 test files in `server/test/`; run `cd server && npx vitest --run` for the current count | PostgreSQL behaviour of the newer columns and the `template_categories` table (tests so far ran on SQLite) |
| Live, reported by the user: a Drip Mine run built by the XO engine was accepted on chipnet from the Demo page and spent the coin left by the earlier run; an earlier Drip Mine run went through on mainnet | The Publish page category picker (needs a connected wallet) |
| Live, reported by the user: a voucher built by the XO engine was created and claimed on chipnet from the Demo page; a mainnet voucher transaction was confirmed earlier | Default Electrum servers; the chipnet explorer link format (`chipnet.chaingraph.cash/tx/...`) |
| Engine and independent builder produce identical bytes for Drip Mine and the voucher (tests); a disagreement refuses the transaction | |
| Category filter in a real browser against a local server (11 templates, Tokens shows 5, deep link works) | |

## 8. Still to do (in order)

1. Apply `install_demo_redesign.py` from `~/XOGrid`, run the checks (section 10), click through the Demo (create and claim a voucher on chipnet, run Drip Mine), push.
2. Apply the docs script that delivered this file (it also updates `README.md` and `docs/FRONTEND.md`), review with `git diff`, push.
3. Cleanup: delete the stray untracked `apply_batch_a.py` in the repo root.
4. Check Render after deploy: the startup log shows the moderators and 11 templates, the "Resource links" audit row is there, and there are no errors creating `template_categories` and the three receipt columns.
5. Set `VITE_SLIDES_URL` in Vercel. The slides are not in the repo: update their test count (run `cd server && npx vitest --run` and use the real number) and their wording about the engine to match section 3.
6. Run the Postgres tests against a scratch database before submitting (production is PostgreSQL): `TEST_DATABASE_URL=postgres://... npm run test:postgres` in `server/`. Never point it at the live database.
7. Optional: a mainnet run of the engine-built voucher, Token Burner and Badgers release runs on the Demo page, invites for Revenue Split, Block Points and Badgers staking, review by XO invite, an admin button for categories.
8. Not recommended before submission: bumping the XO packages. The engine is pinned to `0.1.1-next.18029697917` and everything above was run on it; identifiers were checked equal for `@xo-cash/utils` 0.0.10 and 0.0.11.
9. Submission is **Nov 22, 15:00 UTC+1**.

## 9. Sandbox notes (for the assistant)

- The dump is split on lines `===== FILE: <path> =====` (regex `^===== FILE: (.+?) =====\n`); drop one trailing newline per file. Rebuild the repo from it to type-check and test.
- `npm install` fails in the sandbox for `server/`: use `yarn install --ignore-engines`, then build better-sqlite3 with node-gyp 11: `npm install node-gyp@11` in `/tmp/ng`, then `node /tmp/ng/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/opt/node22` from `node_modules/better-sqlite3`. Frontend: `yarn install --ignore-engines`. Templates: `--legacy-peer-deps`.
- The dump has no binaries: for a frontend build, add placeholder images for the missing `src/assets/images/*` imports in the sandbox only. `cd frontend && npm install --legacy-peer-deps` works (2026-11-21), then `npx tsc --noEmit -p .` and `npm run build`. Lint with `npx oxlint`; ESLint has no config in the repo.
- Server tests need better-sqlite3's native binary. On 2026-11-21 `npm install` failed in `server/`, and `yarn` (install it with `npm install -g yarn`) with `--ignore-engines --ignore-scripts` installed the packages but no prebuilt binary existed for the sandbox's Node, so the server tests were not run. Count the tests on the user's machine instead.
- Start servers with `setsid nohup ... &`; `pkill -f` can match its own shell. A local run: `DATABASE_PATH=/tmp/x.db WEB_DIR=../frontend/dist PORT=3011 npx tsx src/index.ts`, then Playwright (`require('playwright')`).
- The sandbox cannot reach the WizardConnect relay or live Electrum. The Electrum client is tested against a local `net` server using `tcp://127.0.0.1:<port>`.
- `docs/REVIEW_TRACKING.md` is the decision record for the judges (updated to match the build).

## 10. Deployment and delivery method (how we ship every change)

Render redeploys by itself on push to `main`; the invitation tool redeploys on Vercel. Each delivery is **one install script** (for example `install_categories.py`) plus, when useful, standalone documents with a destination table.

1. **Checkpoint 1, sync:** `cd ~/XOGrid && git stash -u && git pull origin main --no-rebase && git stash pop`
2. **Checkpoint 2, put the script in place:** `cp ~/Downloads/install_<batch>.py ~/XOGrid/` (new files are inside the script; nothing else to copy).
3. **Checkpoint 3, apply:** `cd ~/XOGrid && python3 install_<batch>.py`. It writes the new files, each to its own path, and edits existing files with exact-string replacements. It writes **nothing** if any step cannot be done and says which file and edit (usually because someone changed that file; the user pastes the message). It skips what is already done, so a second run changes nothing. It refuses to overwrite a new file that already exists with different content.
4. **Checkpoint 4, checks:** `cd server && npx tsc --noEmit -p . && npx vitest --run`; `cd ../frontend && npx tsc --noEmit -p . && npm run build`; for the templates folder: `cd templates && npm install --legacy-peer-deps && npm run typecheck && npm test`. After changing `templates/*/template.json`, run `cd server && node scripts/sync-community-templates.mjs`. After changing `frontend/package.json`, run `cd frontend && npm install --legacy-peer-deps` so `package-lock.json` matches: the Dockerfile uses `npm ci`.
5. **Checkpoint 5, run and click through:** server with `ADMIN_IDENTITIES="angelnath=<pubkey hex>,miguel=<bchtest address>,john=<bitcoincash address>" npm run dev` (startup prints the moderators and the review addresses; if admin sign-in fails the terminal prints `admin login rejected` with the reason), `cd frontend && npm run dev`, and `cd templates && npm run web` for the invitation tool.
6. **Checkpoint 6, review before pushing:** `rm install_<batch>.py && git add server frontend docs templates && git status -sb`. There must be no `.db`, `node_modules` or `.xo-demo` files.
7. **Commit and push (no Claude attribution):** `git commit -m "<message>" && git pull origin main --no-rebase && git push origin main`.
8. Tell John to pull before he pushes.

## 11. How to dump the codebase for the next session

`bash ~/Downloads/dump_xogrid.sh` writes `~/Desktop/xogrid-dump.txt` (header with commit and pull status, recent commits, file list, a LEFT OUT list with reasons, then every file as `===== FILE: <path> =====`). It runs `git pull --ff-only origin main` first (and says "NOT pulled" in the header if that fails), skips `node_modules`, `dist`, lock files, binaries, `.env*` (except `.example`), `.xo-demo`, databases, keys and files that look like secrets, and files over 300,000 bytes. Settings can be overridden in front of the command: `REPO=~/XOGrid OUT=~/Desktop/dump.txt MAX_BYTES=500000 BRANCH=main`. Attach `xogrid-dump.txt` and this file in the new conversation.

## 12. Files delivered in this work (destination paths)

Earlier batches: Batch A+B and C files as listed in the 2026-11-19 handoff (template viewer, resources, export, community templates and seed, signing prompt, Badgers release panel, `inviteTool.ts`).
Batch D, review receipts:
- `server/src/review-receipt.ts`, `server/test/review-receipt.test.ts`
- `server/src/electrum.ts`, `server/src/review-address.ts`, `server/src/review-chain.ts`, `server/src/receipts-setup.ts`, `server/test/review-chain.test.ts`
- `apply_batch_d2.py` (edits `db.ts`, `user-reviews.ts`, `app.ts`, `index.ts`), `apply_batch_d3.py` (verified broadcast route and lazy re-check in `app.ts`), `apply_batch_d4.py` (edits `api.ts`, `wallet.ts`, `TemplateDetail.tsx`)
- `frontend/src/components/hub/RecordOnChain.tsx`, `frontend/src/components/hub/ReviewForm.tsx`, `frontend/src/hub/receipts.ts`
- `docs/REVIEW_TRACKING.md`
Batch E, categories (one script, supersedes `apply_batch_e1.py` and `apply_batch_e2.py`): `install_categories.py` writes `server/src/categories.ts`, `server/test/categories.test.ts`, `frontend/src/hub/categories.ts`, `frontend/src/components/hub/CategoryFilter.tsx`, `frontend/src/components/hub/CategoryPicker.tsx`, and edits `server/src/{db,registry,app,admin-routes,seed}.ts`, `frontend/src/hub/api.ts`, `frontend/src/pages/{Explore,Publish,TemplateDetail}.tsx`.
Batch F, live runs and the XO engine (each its own install script, already applied and pushed): `server/src/run-drip-mine.ts` and its routes in `server/src/app.ts`, `frontend/src/hub/run.ts`, `frontend/src/components/hub/RunDripMine.tsx`, `frontend/src/voucher/xo.ts`, `frontend/src/voucher/claim-voucher.template.json`, `frontend/stubs/*`, `server/test/run-drip-mine.test.ts`, `run-engine.test.ts`, `run-failover.test.ts`, `voucher-engine.test.ts`.
Batch G, Demo redesign: `install_demo_redesign.py` replaces `frontend/src/pages/Demo.tsx`, `frontend/src/components/demo/TemplatePicker.tsx`, `frontend/src/components/demo/TemplateGuide.tsx` and `frontend/src/components/hub/RunDripMine.tsx`.
Docs: `install_docs_update.py` replaces `HANDOFF.md`, `README.md` and `docs/FRONTEND.md`.
Tools: `dump_xogrid.sh`. Documents: `HANDOFF.md` (this file, destination `~/XOGrid/HANDOFF.md`).

