# XOGrid handoff (state at 2026-11-20, midday Lagos time)

Read this first, then `xogrid-dump.txt` (made by `dump_xogrid.sh`, see section 11). This file replaces the earlier handoff of 2026-11-19. Where this file and any older handoff disagree, this file wins.

## 1. Project in one paragraph

XOGrid is a "Docker Hub for XO templates", built for BCH BLAZE 2026. A registry stores XO wallet templates, audits them, lets people review, rate, flag and categorise them, and shows them in a web app. Team: Nathaniel (angelnath) owns the server, registry, audit checks, admin login, wallet-signed reviews, on-chain review receipts, categories, the Claim-Code Voucher template and the docs. John owns `frontend/` (the real UI) and pushes often. Miguel owns hosting (Render, Supabase, Vercel) and the extra templates in `templates/`. Submission is **Nov 22, 15:00 UTC+1**.

Repo: `XOGrid-Cash/Blaze2026_XOGrid`, local clone `~/XOGrid`. Layout: `server/` (Fastify, Kysely, SQLite locally and PostgreSQL in production, vitest), `frontend/` (React, Vite, Tailwind), `templates/` (one folder per contract system, plus `web/`, the separate invitation tool at xogrid-invite.vercel.app), `docs/`. libauth is `3.1.0-next.8`.

## 2. Working rules (keep following these)

- Never touch `frontend/src/voucher/core.ts` without tests. Never broadcast unless `verifySignedIssue` passes. Voucher bytes variables are passed as HEX text, never as a raw `Uint8Array`.
- Commits carry **no Claude attribution** (the user's standing rule overrides any tool reminder to add Co-Authored-By lines).
- Do not write the user's Build with XO feedback; give notes on what happened. The README says plainly that the server and first web app were prototyped before Nov 14.
- The database URL lives only in Render. Never point `TEST_DATABASE_URL` at the live database.
- Tell John to pull before he pushes after every delivery.
- **Deliver one install script per batch.** A script writes every new file to its own path and applies exact-string edits to existing files, all or nothing and safe to run twice (see section 10). Do not send several same-named files for the user to download separately (the user was confused by two files named `categories.ts`). Always state each destination path in a table.
- Run `tsc --noEmit -p .`, the tests and `npm run build` before delivering code. Prove an install script on pristine copies of the files (apply, apply again, compare byte for byte, and break one anchor to confirm nothing is written).
- Never claim anything wallet-related or chain-related is verified: the sandbox cannot reach the WizardConnect relay or live Electrum. Say "type-checked and tested against fakes".
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

### On-chain review receipts (new, Batch D)
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

Server (Render): `DATABASE_URL` (PostgreSQL; wins when set) or `DATABASE_PATH` (SQLite file), `PORT`, `HOST`, `WEB_DIR`, `SEED_ON_EMPTY`, `SEED_COMMUNITY`, `ADMIN_IDENTITIES` (`label=identity,...`; identity is a public key, a P2PKH address or an xpub), `REVIEW_IDENTITY_LABEL` (optional), `ELECTRUM_MAINNET` and `ELECTRUM_CHIPNET` (`host:port`, TLS; `tcp://host:port` for plain, local testing), `ELECTRUM_INSECURE_TLS=1` (accept self-signed certificates), `TEST_DATABASE_URL` (scratch database only, for `npm run test:postgres`).
Frontend (Vercel): `VITE_API_URL`, `VITE_INVITE_TOOL_URL`, `VITE_SLIDES_URL` (unset; the banner says "Slides: link coming soon").
At startup the server logs the moderators, and `Review receipts on mainnet: <address>` and on chipnet. Check that these addresses are ones the team controls.

## 5. Decisions made, and why

| Decision | Why |
|---|---|
| Seed community templates on every start, not only when empty | The live Supabase DB already has data. `seedCommunity()` never touches the Home spotlight and never revives a removed template. |
| Vendor `template.json` into `server/src` via a generated file | The Render image contains only `server/`. A test compares it with `templates/*/template.json`. |
| Export serves `/raw`, not a re-stringified object | The identifier is a hash of the exact text. |
| Resources are untrusted: https links only, plain text otherwise; check warns, never fails | A `javascript:` URL was accepted and badged `auto-checked`; the frontend is the real defence. A bad link cannot be clicked, so failing would block valid templates. |
| One shared `trackSigning` wrapper | Reviews, admin login and the Demo all get the same prompt. |
| Invitation tool defaults to chipnet; mainnet needs an explicit real-money confirmation | Money-path rule. Badgers release panel opens on mainnet because its contract exists only there. |
| Existing files are changed by exact-string scripts, never overwritten | John and Miguel push often. |
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
- **No claim that any wallet or chain flow is verified by the build.** The user reported real-wallet checks done for the signing prompt, connect, reload-restore, the Demo and the Blaze Tool import; the receipt flow (chipnet, then mainnet) was not reported.
- No audit failure for bad resource links (warning only).
- No whole-file overwrites of existing files; scripts only. (New files may be written whole.)
- No admin-UI button for categories yet (the route exists).
- No user-created categories (fixed list only).
- No Postgres run of the new tests and the new tables (SQLite only). `npm run test:postgres` needs a scratch database.
- No Claude attribution lines in commits.
- No merging of `apply_batch_e1.py` / `apply_batch_e2.py` with the new script: they are superseded by `install_categories.py` and should not be run.

## 7. Verified and not verified

| Verified here (tests, local run) | Not verified (needs a real wallet or live chain) |
|---|---|
| Server tests: 243 passing in 14 files at the last run (SQLite); `tsc` clean on server and frontend; frontend builds | Receipt flow end to end on chipnet, then mainnet: wallet accepts the transaction signing request, server broadcast, pending to confirmed |
| Receipt parser, builder, prepare, broadcast (real Schnorr signatures), attach, lazy re-check, routes | Default Electrum servers; the chipnet explorer link format (`chipnet.chaingraph.cash/tx/...`) |
| Electrum client against a local fake server | PostgreSQL behaviour of the new columns and the `template_categories` table |
| Category filter in a real browser against a local server (11 templates, Tokens shows 5, deep link works) | The Publish page category picker (needs a connected wallet) |
| Install and apply scripts reproduce the files byte for byte and write nothing on a failed anchor | Whether the categories batch has been applied and pushed |

## 8. Still to do (in order)

1. Apply the categories install script (`python3 install_categories.py` from `~/XOGrid`), run the checks, click through Explore and Publish, push.
2. Check Render after deploy: startup log shows both review addresses (and that the team controls them), 11 templates, the "Resource links" audit row, no errors creating `template_categories` and the three receipt columns.
3. Receipt run on chipnet with a real wallet (coins on the wallet's first receive address), then one on mainnet (about 1,000 sats). Send the exact error text if anything fails.
4. Set `VITE_SLIDES_URL` in Vercel.
5. Optional: invites for Revenue Split, Block Points, Badgers staking (honestly labelled); review by XO invite (only after a chipnet import works); Postgres test run; admin button for categories.
6. Done already per the user: batches D2 to D4 applied, real-wallet checks of the older flows, the mainnet voucher transaction is confirmed.

## 9. Sandbox notes (for the assistant)

- The dump is split on lines `===== FILE: <path> =====` (regex `^===== FILE: (.+?) =====\n`); drop one trailing newline per file. Rebuild the repo from it to type-check and test.
- `npm install` fails in the sandbox for `server/`: use `yarn install --ignore-engines`, then build better-sqlite3 with node-gyp 11: `npm install node-gyp@11` in `/tmp/ng`, then `node /tmp/ng/node_modules/node-gyp/bin/node-gyp.js rebuild --release --nodedir=/opt/node22` from `node_modules/better-sqlite3`. Frontend: `yarn install --ignore-engines`. Templates: `--legacy-peer-deps`.
- The dump has no binaries: for a frontend build, add a placeholder `frontend/src/assets/images/xogridlogo.png` in the sandbox only, and delete it afterwards. ESLint has no config in the repo.
- Start servers with `setsid nohup ... &`; `pkill -f` can match its own shell. A local run: `DATABASE_PATH=/tmp/x.db WEB_DIR=../frontend/dist PORT=3011 npx tsx src/index.ts`, then Playwright (`require('playwright')`).
- The sandbox cannot reach the WizardConnect relay or live Electrum. The Electrum client is tested against a local `net` server using `tcp://127.0.0.1:<port>`.
- `docs/REVIEW_TRACKING.md` is the decision record for the judges (updated to match the build).

## 10. Deployment and delivery method (how we ship every change)

Render redeploys by itself on push to `main`; the invitation tool redeploys on Vercel. Each delivery is **one install script** (for example `install_categories.py`) plus, when useful, standalone documents with a destination table.

1. **Checkpoint 1, sync:** `cd ~/XOGrid && git stash -u && git pull origin main --no-rebase && git stash pop`
2. **Checkpoint 2, put the script in place:** `cp ~/Downloads/install_<batch>.py ~/XOGrid/` (new files are inside the script; nothing else to copy).
3. **Checkpoint 3, apply:** `cd ~/XOGrid && python3 install_<batch>.py`. It writes the new files, each to its own path, and edits existing files with exact-string replacements. It writes **nothing** if any step cannot be done and says which file and edit (usually because someone changed that file; the user pastes the message). It skips what is already done, so a second run changes nothing. It refuses to overwrite a new file that already exists with different content.
4. **Checkpoint 4, checks:** `cd server && npx tsc --noEmit -p . && npx vitest --run`; `cd ../frontend && npx tsc --noEmit -p . && npm run build`; for the templates folder: `cd templates && npm install --legacy-peer-deps && npm run typecheck && npm test`. After changing `templates/*/template.json`, run `cd server && node scripts/sync-community-templates.mjs`.
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
Tools: `dump_xogrid.sh`. Documents: `HANDOFF.md` (this file, destination `~/XOGrid/HANDOFF.md`).
