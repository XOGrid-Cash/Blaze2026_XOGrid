# Contracts → XO templates

Each folder here is one **contract system**: BCH contracts converted into an XO template, with tests that show the template builds exactly the contract. Folders whose names start with `_` are not systems.

The method follows the guide [Building a BCH XO Template for a Smart Contract](https://claude.ai/artifact/7iB9WGK2fp25LUU5BbDzm3).

## Systems

| System | Status | Template identifier | Based on | Credits |
| --- | --- | --- | --- | --- |
| [badgers-stake](badgers-stake/) | Tested offline (30 tests); chipnet test variant: deploy and withdraw verified, stake and release offline only | `991a7bbd2337748e5537850eef69fe34b88b5ad29b3d8de26a1156df2b4c66e7` | [`BadgerStake.cash`](https://github.com/SayoshiNakamario/BadgersStake/blob/49ccba8d1726d73919b584e1aa7ec5c63eea5479/BadgerStake.cash) (SayoshiNakamario/BadgersStake `49ccba8d`, no licence stated), used unchanged; live at [badgers.cash](https://badgers.cash) | SayoshiNakamario |
| [block-points](block-points/) | Tested offline (27 tests); chipnet thread funding verified, chipnet claim not run | `9941f723c962e64956c5dcbc9e97e6a735736e4a8e94b24d7d77e6b0eeee3e5a` | [`template.v3.2.json`](https://github.com/2qx/vox/blob/a7f970e40b43080ab8378a0f445f3368ce6792ac/packages/blockpoint/src/template.v3.2.json) vault script (2qx/vox `a7f970e4`, Unlicense), used verbatim; live at [vox.cash/bpt](https://vox.cash/bpt) | 2qx |
| [drip-mine](drip-mine/) | Chipnet verified (fund, drip, terminate); 26 offline tests | `346048b296ba8a35dc44caddd80d5387aba3e3a0be973a568af804699b7f1185` | [`drip-mine.cash`](https://gitlab.com/0353F40E/drip-mine/-/blob/5893d50ee9a531e0a31c6a637c3f2213509e8c02/drip-mine.cash) (0353F40E/drip-mine `5893d50e`, MIT-0), used unchanged; live at [vox.cash/drip](https://vox.cash/drip) ([2qx/vox](https://github.com/2qx/vox), Unlicense) | bitcoincashautist; 2qx (vox app) |
| [revenue-split](revenue-split/) | Chipnet verified (fund + payout, earlier identifier `9674cee2…`); 23 offline tests | `b17ba2ee55b392f959155a9b86d58137ebfef783041c092496ddb887f9d8654e` | Draft [`RevenueSplit.cash`](https://github.com/XOGrid-Cash/Blaze2026_XOGrid/blob/8267aec7042fac07662ec5b2e765643d834fa127/contracts/RevenueSplit.cash) (XOGrid commit `8267aec`) | angelnath |
| [token-burner](token-burner/) | Chipnet verified (deposits of tokens and BCH, single and batch burns); 21 offline tests | `1ef44c322bbcd2db0f376b9359a1255a6560e0365a21d8811c4d85b3b57247e0` | [`burner.cash`](https://gitlab.com/dagurval/contract-burner/-/blob/f20240756800e07c091f35e0227967e7db8727d3/burner.cash) (dagurval/contract-burner `f2024075`, MIT per its README), used unchanged; live at [tokenburner.cash](https://www.tokenburner.cash/) | Dagur Valberg Johannsson |
| [token-vault](token-vault/) | Chipnet verified (full lifecycle from the template tools page: lock, releases incl. halving and final, fee coins); 30 offline tests, 16 page tests | `d27bf857f00a61f15632993bea305f9c11964e1c55f0fbb4c6ec6227eb4e55f3` | [`TokenVault_Release.cash`](https://github.com/foldingcash/smart-contracts/blob/0604bfbabc711a7a74af24b8535e71476922f7c0/TokenVault/TokenVault_Release.cash) (foldingcash/smart-contracts `0604bfba`, MIT), used unchanged | FoldingCash |

**Status levels**: Draft → Tested offline → Chipnet verified → Reviewed. Update the row in the same change that moves a system forward.

## Dev tool: template tools

[`web/`](web/) is a dev-only page, styled like `frontend/`, that builds ready-to-import XO invitations for these templates (Drip Mine, Token Burner, Badgers Stake releases and Token Vault releases so far). Run `npm run web` and open http://127.0.0.1:5180, or build the nginx image here with `docker build -t xogrid-template-tools .`. See [web/README.md](web/README.md).

## Layout of a system

```
<system>/
  README.md          what it does, design and transaction layout, Credits, changes from the original, status, ids, txids
  *.cash             the CashScript contract(s)
  artifact/*.json    cashc artifacts, committed so reviewers can diff the exact bytecode
  template.ts        the XO template as a plain object; reads its bytecode from the artifact
  template.json      canonical serializeTemplate(parseTemplate(...)) output: the bytes a registry publishes (generated)
  test/              contract tests (CashScript SDK) and template tests (equivalence, VM spends, audit)
  scripts/           end-to-end runs on chipnet with the XO engine
```

Start a new system by copying [`_skeleton/`](_skeleton/).

## Workflow

```bash
npm install                          # once
npm run compile                      # .cash -> artifact/*.json with the cashc version its pragma asks for (0.9.3, 0.10.0-next.4 or 0.14.0; files without a pragma are pinned in shared/compile.ts)
npm run template:json                # template.ts -> template.json, prints the identifier
npm test                             # every system's tests
npm run typecheck
```

A system's tests must prove, at minimum:

1. **Equivalence**: the template's compiled locking bytecode equals the CashScript contract's locking bytecode for the same arguments. This catches argument-order and bytecode-copy mistakes.
2. **Spends**: every contract function has transactions the VM accepts, and transactions it rejects (wrong amount, recipient, order, missing output).
3. **Audit**: XOGrid's automated audit (`server/src/audit`) reports no failures.

Then prove it on chipnet with the system's script, record the txids in its README, and open the saved invitations in the Blaze Tool (blaze.xo.cash, set to chipnet, import `template.json` first).

## Attribution

Many systems build on other people's open-source work. Credit them every time, in three places:

- **The system README** has a Credits section: the original author, a link to the exact source (repository, commit, file), its licence, and a list of what we changed and why.
- **The template** lists the same source in `resources`, so wallets and the registry show it to users.
- **The table above** names the source and the author.

Before adapting third-party code, check that its licence allows it, and keep any licence notice it requires next to the copied code. If the author or licence can't be determined, say so in the README instead of leaving it out.

## Notes

- This folder was called `contracts/` until 2026-11-18. Each template links to its folder in `resources`, so the rename changed every template identifier. The chipnet runs recorded in the system READMEs used the earlier identifiers; the scripts, lock bytecodes and addresses are unchanged.
- Tooling versions are pinned to match `server/` (XO engine, utils, templates and Libauth) and to cashc and CashScript 0.14.0. Contracts adopted from other projects are rebuilt with their original compiler, so their deployed bytecode and address stay the same: `cashc-0.9` is cashc 0.9.3 and `cashc-0.10` is cashc 0.10.0-next.4 (the prerelease BadgerStake was built with), and npm overrides point their Libauth at our pinned 3.1, because Libauth 2 no longer loads in Node 22+. TokenBurner’s and Drip Mine’s tests prove the rebuilt bytecode matches upstream. A verbatim file with no `pragma` (Drip Mine) is pinned to its compiler in `shared/compile.ts`, and sources are compiled with LF line endings so artifacts are the same on every OS.
- Templates are passed to `parseTemplate` as objects, never through our own `JSON.stringify`: XO’s extended JSON writes bigints as `<bigint: 0n>`, and a plain `"0n"` string is not read as a number. Each system’s tests check that the committed `template.json` is current.
- Don't let the shared chipnet test wallet in `.xo-demo` watch a busy address. After the Drip Mine run it watched one with about 45,000 history entries and could no longer start, so we removed that script hash and its coins from the wallet's state database by hand (the engine has no API for it; backup in `.xo-demo/backup-2026-11-18`). See drip-mine/README.md, "XO engine notes".
- Systems without a `.cash` source (Block Points, whose live script is hand-written CashASM) keep an unmodified copy of the upstream file under `upstream/`, and their tests check the embedded script against it.
- `shared/chipnet-tokens.ts` mints test CashTokens on chipnet for systems that need them.
- npm only runs install scripts that `allowScripts` in `package.json` lists. `sqlite3` is allowed because the XO engine's state package loads it.
- The tests import the registry audit from `../server/src/audit`. `vitest.config.ts` resolves its packages from this workspace, so `server/` needs no install of its own.
