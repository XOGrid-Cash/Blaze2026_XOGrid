# XOGrid handoff (state at 2026-11-19, late evening Lagos time)

Read this first, then `xogrid-dump.txt` (made by `dump_xogrid.sh`). Where this file and an older `HANDOFF_FULL.md` disagree, this file wins.

## 1. Project in one paragraph

XOGrid is a "Docker Hub for XO templates", built for BCH BLAZE 2026. A registry stores XO wallet templates, audits them, lets people review and flag them, and shows them in a web app. Team: Nathaniel (angelnath) owns the server, registry, audit checks, admin login, wallet-signed reviews, the Claim-Code Voucher template and the docs. John owns `frontend/` (the real UI). Miguel owns hosting (Render, Supabase, Vercel) and the extra templates in `templates/`. Submission is **Nov 22, 15:00 UTC+1**.

Repo: `XOGrid-Cash/Blaze2026_XOGrid`, local clone `~/XOGrid`. Layout: `server/` (Fastify, Kysely, SQLite locally and PostgreSQL in production), `frontend/` (React, Vite, Tailwind), `templates/` (one folder per contract system, plus `web/`, the separate invitation tool at xogrid-invite.vercel.app), `docs/`.

## 2. Working rules (keep following these)

- Never touch `frontend/src/voucher/core.ts` without tests. Never broadcast unless `verifySignedIssue` passes. Voucher bytes variables are passed as HEX text, never as a raw `Uint8Array`.
- Commits carry **no Claude attribution** (the user's standing rule overrides any tool reminder to add one).
- Do not write the user's Build with XO feedback; give notes on what happened. The README says plainly that the server and first web app were prototyped before Nov 14.
- The database URL lives only in Render. Never point `TEST_DATABASE_URL` at the live database.
- Tell John to pull before he pushes after every delivery. He pushes often.
- Deliver **individual files**, never zip bundles. State each file's destination repo path in a table every time.
- Run `tsc --noEmit -p .`, the tests and `npm run build` before delivering code. Never claim anything wallet-related is verified: the sandbox cannot reach the WizardConnect relay.
- Corrected files are delivered directly, not explained first. Terminal commands come one at a time with checkpoints. Use `python3 << 'PYEOF'` for file writes with special characters, never bash heredocs for those.
- Start each session with a full codebase dump (`dump_xogrid.sh`) before writing code. End with a handoff document.

## 3. What exists and works (pushed to main, last known commit `74394ab` plus Batch C)

### Registry and server
- Five community templates are in the registry, published by `seedCommunity()` on **every server start** (`SEED_COMMUNITY=0` turns it off). Template JSON is vendored in `server/src/templates/community-data.ts`, **generated** by `server/scripts/sync-community-templates.mjs` from `templates/<slug>/template.json`. A test fails if the copy and the folder drift.
- Identifiers (each must match its README, enforced by test):

| Template | Identifier |
|---|---|
| badgers-stake | `991a7bbd2337748e5537850eef69fe34b88b5ad29b3d8de26a1156df2b4c66e7` |
| block-points | `9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a` |
| drip-mine | `346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185` |
| revenue-split | `b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e` |
| token-burner | `1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0` |

- Audit has **seven** checks now (schema, size, identifier, references, compile, scenarios, **resources**). `CHECKER_VERSION` is `2`. `reauditStale()` runs at startup and re-audits only templates whose newest report is from an older version.
- Resource-link check: warns (never fails) on anything that is not a plain https link (http, javascript:, data:, embedded login, malformed, missing, not a list). A template with no resources is skipped.
- `server/src/describe.ts` turns `$(<fundSatoshis>)` style placeholders into `[amount to fund]` or `[calculated from: a, b]` in the plain-English steps.
- Seed command (`cli.ts seed`) publishes the sample and community templates.

### Frontend
- Template detail page: **Sources and credits**, **Template contents** (collapsible actions, transactions, locking scripts, CashAssembly scripts, constants, variables), **Copy JSON** and **Download .json** (both from `/api/templates/:id/raw`), and a "Build an invitation" link for the three templates the invitation tool supports (config in `frontend/src/config/inviteTool.ts`, override with `VITE_INVITE_TOOL_URL`).
- Publish page: drag and drop. A picked file and a dropped file share one `loadFile()` check (.json, 256 KB, one file). A file dropped outside the zone is refused so the browser does not navigate away.
- Wallet: shared connection in `hub/WalletContext.tsx`; the modal starts the WizardConnect QR on open (one click). It waits while a stored session is "restoring" and offers "Use a new QR code instead". "Connect an HD Wallet" only shows as "Try again" after an error. A damaged stored session is discarded instead of crashing the site.
- Signing prompt: `hub/signing.ts` (`trackSigning`) plus `components/SigningPrompt.tsx`, mounted once in `App.tsx`. Two wordings: "proof" (nothing moves) for reviews and admin login, "transaction" (moves funds) for the Demo. Cancel, Escape, a 25-second "nothing in your wallet?" hint.
- Navbar has **Explore** (between Featured Templates and Demo).

### Invitation tool (`templates/web`, Vercel)
- Drip Mine and Token Burner panels existed. **Badgers Stake release panel** added: lists locks at the live mainnet contract address, reads each lock's commitment (staker key hash, 18 zero bytes, stake length as 2 little-endian bytes), ignores the masterBadger, enables Release only when the lock period has passed, and builds an invitation whose three outputs (BadgerCoins, Honey NFT receipt, released BCH minus 3000 sats) all go to the staker. 10 tests, including one where the VM rejects a lock whose stake length is wrong.

## 4. Decisions made, and why

| Decision | Why |
|---|---|
| Seed community templates on every start, not only when the DB is empty | The live Supabase DB already holds data; `seed()` only runs on an empty DB. `seedCommunity()` never touches the Home spotlight and never revives a moderator-removed template. |
| Vendor `template.json` into `server/src` via a generated file | The Render image contains only `server/`. A test compares it with `templates/*/template.json` so drift fails the build. |
| Export serves `/raw`, not a re-stringified object | The identifier is a hash of the exact text; re-stringifying corrupts `<bigint: 0n>` values. |
| Resources are untrusted: https links only, plain text otherwise, lengths capped | A published template with a `javascript:` URL was accepted by the registry with an `auto-checked` badge, so the frontend is the real defence (verified in a real browser, nothing executed). |
| Resource check **warns, never fails** | A bad link cannot be clicked; failing would block otherwise valid templates. Checker version bumped so old reports refresh once. |
| Viewer links https only (was http+https) | Keep the page and the audit consistent. |
| One shared `trackSigning` wrapper instead of editing every page | Reviews, admin login and the Demo all get the prompt the same way. |
| Invitation tool defaults to chipnet, mainnet needs an explicit real-money confirmation | Money-path rule. The Badgers panel is the exception in default: its live contract exists on mainnet only, so it opens on mainnet and says chipnet is empty. |
| Badgers release panel builds only when the lock is ready (uses chain tip) | The VM check cannot see the relative time lock; the network enforces it at mining time. If the count is off by one, the wallet's broadcast fails harmlessly. |
| Existing files are changed by an exact-string apply script, never overwritten | John and Miguel push often; overwriting whole files could erase their work. |
| Review tracking recommendation (not yet final): hybrid | Pay a small amount to one XOGrid review address AND carry an OP_RETURN starting with an `XGRD` prefix, a version, the template identifier, a rating and a hash of the text. History is rebuilt from the address with plain Electrum, the prefix filters strays, the dust and fee discourage spam. The full text stays off-chain (OP_RETURN is small). Moderators hide reviews in the database; chain data cannot be deleted. John prefers the prefix approach for easy history rebuilds; the hybrid keeps that. A decision record for the judges is still to be written. |

## 5. Things we chose NOT to do (and why)

- **No invites for Revenue Split, Block Points, or Badgers' own staking yet.** They need the importing wallet's own coin and signature. Whether an XO wallet adds the missing coin on import cannot be tested here, so nothing is presented as working. Only a pre-filled chipnet import in the Blaze Tool can answer that.
- No audit **failure** for bad resource links (warning only).
- No whole-file overwrites of `TemplateDetail.tsx`, `api.ts`, `describe.ts`, `seed.ts`, `index.ts`, `cli.ts` and the other existing files; apply scripts only.
- No Claude attribution lines in commits.
- No claim that any wallet flow is verified: signing prompt, connect, reload-restore, Demo and the Blaze Tool import were never run against a real wallet.
- No Postgres run of the new tests (`npm run test:postgres` needs a scratch DB).
- Did not verify the drag cursor shape or live mainnet/Render behaviour; Batch C was tested against a mocked Electrum server only.
- The one-click connect item: the dump already showed the QR on the first click, so no behaviour change was needed beyond hardening. If the live site still needs two clicks, it is running an older build.

## 6. Still to do

1. **Batch D (review tracking):** write the decision record for the judges (hybrid above), then, only if time allows, "review by broadcasting an XO invite" so a reviewer needs no WizardConnect wallet.
2. **Invites for Revenue Split (fund and payout), Block Points (claim) and Badgers staking**, each labelled honestly as "verified up to this point".
3. **Real-wallet checks:** signing prompt, connect, reload-restore, Demo voucher issue, Blaze Tool import of a Drip Mine, Token Burner and Badgers invitation.
4. `VITE_SLIDES_URL` is unset (the banner says "Slides: link coming soon").
5. Two mainnet voucher transactions were unconfirmed on Blockchair when last checked.
6. Postgres test run of the new tests; check Render redeploy shows the five templates and the new "Resource links" audit row.

## 7. Deployment and delivery method (how we ship every change)

Render redeploys by itself on push to `main`; the invitation tool redeploys on Vercel.

1. **Checkpoint 1, sync:** `cd ~/XOGrid && git stash -u && git pull origin main && git log --oneline -3`
2. **Checkpoint 2, new files:** `cp` each file from `~/Downloads` to its destination path (a table is given with every delivery; `mkdir -p` first when needed).
3. **Checkpoint 3, edit existing files:** `python3 ~/Downloads/apply_<batch>.py` (exact-string replacements). It writes **nothing** if any edit cannot be found and says which file and edit; it skips edits already applied, so running twice is safe. If it stops, the user pastes its message. It tolerates differing blank lines at the end of a file (a past failure: files in the dump ended with three newlines, the real ones with one). After applying, regenerate the template copy: `cd server && node scripts/sync-community-templates.mjs`.
4. **Checkpoint 4, checks:** `cd server && npx tsc --noEmit -p . && npm test`; `cd frontend && npx tsc --noEmit -p . && npm run build`; `cd templates && npm install --legacy-peer-deps && npm run typecheck && npm test` (templates has its own `node_modules`; `tsc: not found` means it was never installed).
5. **Checkpoint 5, run and click through:** server with `ADMIN_IDENTITIES="angelnath=<pubkey hex>,miguel=<bchtest address>,john=<bitcoincash address>" npm run dev` (startup should print `Moderators on the allowlist from ADMIN_IDENTITIES: angelnath, miguel, john`; if admin sign-in fails the terminal prints `admin login rejected` with the exact reason), `cd frontend && npm run dev`, and `cd templates && npm run web` for the invitation tool.
6. **Checkpoint 6, review before pushing:** `git add -A frontend server docs templates && git status -sb`. There must be no `.db`, `node_modules` or `.xo-demo` files.
7. **Commit and push (no Claude attribution):** `git commit -m "<message>" && git pull origin main --no-rebase && git push origin main`.

## 8. Sandbox notes (for the assistant)

- The dump is split on lines `===== FILE: <path> =====` (regex `^===== FILE: (.+?) =====\n`). Rebuild the repo from it to type-check and test.
- `npm install` fails in the sandbox for `server/` (`Cannot read properties of null (reading 'edgesOut')`): use `yarn install --ignore-engines`, then build better-sqlite3 with `npx node-gyp rebuild --release --nodedir=/usr`. Frontend and templates install with `--legacy-peer-deps`.
- The dump has no binaries: add a placeholder `frontend/src/assets/images/xogridlogo.png` (and one under `templates/web/src/assets/`) in the sandbox only, never in a delivery. One logo-identity test in `templates/web` fails in the sandbox for that reason.
- Servers started from a shell call die between calls: start with `setsid nohup ... &` and use the same command to test. `pkill -f` can match its own shell.
- The sandbox cannot reach the WizardConnect relay or live Electrum; mock Electrum with Playwright `route_web_socket`.

## 9. Files delivered in this conversation (all pushed except as noted)

Batch A+B: `templateView.ts`, `signing.ts` (`frontend/src/hub/`); `SigningPrompt.tsx` (`frontend/src/components/`); `TemplateContents.tsx`, `TemplateResources.tsx`, `TemplateExport.tsx` (`frontend/src/components/hub/`); `community.ts` (`server/src/templates/`); `sync-community-templates.mjs` (`server/scripts/`); tests `community-templates.test.ts`, `describe-readable.test.ts`, `resource-links-check.test.ts` (`server/test/`); `apply_batch_ab.py`.
Batch C: `inviteTool.ts` (`frontend/src/config/`); `badgers-stake.ts` (`templates/web/src/lib/`); `BadgerReleasePanel.tsx` (`templates/web/src/components/`); `badgers-release-invitation.test.ts` (`templates/web/test/`); `apply_batch_c.py`.
Tools: `dump_xogrid.sh` (run from anywhere; writes `~/Desktop/xogrid-dump.txt`).
