# Token Vault

Lock fungible tokens in a vault that releases them on a schedule like Bitcoin's block reward. For every block mined since the last release, the owner may release a fixed number of tokens. Every `halvingLength` blocks, that reward halves (never below 1). Only the owner can release, and the tokens always go to the owner's own address.

This template wraps FoldingCash's **TokenVault_Release contract unchanged**. Each vault made through the template gets its own owner key from the XO wallet, so it has its own address.

| | |
| --- | --- |
| Status | Chipnet verified 2026-11-21: the full lifecycle (lock, a release that stops at a halving, fee coins, a normal release, the final release) from the template tools page's invitations, finished by an XO wallet; accepted by chipnet, unconfirmed when recorded. 30 offline tests, 16 page tests. Blaze Tool check pending. |
| Contract | [`TokenVault_Release.cash`](TokenVault_Release.cash), verbatim from upstream, rebuilt with cashc 0.10.0-next.4: the same bytecode as upstream's 0.10.0-next.5 artifact. 294-byte redeem script with a 33-byte key, 246 opcodes. |
| Template | [`template.ts`](template.ts) → [`template.json`](template.json) |
| Template identifier | `d27bf857f00a61f15632993bea305f9c11964e1c55f0fbb4c6ec6227eb4e55f3` |
| Invitation tool | `web/` page, `#token-vault`: a guide, then lock, release, fee coin and final release invitations for the owner's XO wallet to finish |

## Credits

- **Contract:** Token Vault by **FoldingCash** ([foldingcash/smart-contracts](https://github.com/foldingcash/smart-contracts)).
- **Source:** [`TokenVault/TokenVault_Release.cash`](https://github.com/foldingcash/smart-contracts/blob/0604bfbabc711a7a74af24b8535e71476922f7c0/TokenVault/TokenVault_Release.cash) at commit `0604bfba`. Upstream's artifact, [`TokenVault_Release.artifact.cash`](https://github.com/foldingcash/smart-contracts/blob/0604bfbabc711a7a74af24b8535e71476922f7c0/TokenVault/TokenVault_Release.artifact.cash), is kept unmodified as [`upstream/TokenVault_Release.artifact.json`](upstream/TokenVault_Release.artifact.json), and the tests compare against it.
- **Licence:** [MIT](https://github.com/foldingcash/smart-contracts/blob/0604bfbabc711a7a74af24b8535e71476922f7c0/LICENSE), "Copyright (c) 2024 FoldingCash".
- **Adapted by:** XOGrid, in this folder. Only the XO template is new. The contract is unchanged. Upstream's `TokenVault_Mint.cash` is not used: the template's `lock` action creates a vault from the wallet's own tokens, as upstream's `lockToken.js` does.

## Design

One contract with one function, `release(sig, blockHeight)`, and two constructor parameters: the owner's public key (`fund` in the source) and `halvingLength`. A vault is two coins at the contract address, made in the same transaction:

- **The token coin:** the fungible tokens still locked.
- **The state NFT:** an immutable NFT whose 24-byte commitment is the vault's state.

| Offset | Bytes | Field | Encoding |
| --- | --- | --- | --- |
| 0 | 8 | Last release height | little-endian number (`bytes8`) |
| 8 | 8 | Last halving height | little-endian number |
| 16 | 8 | Reward per block | little-endian number |

A release, with every position fixed by the contract:

| Position | Holds | Constrained by |
| --- | --- | --- |
| input 0 | the vault's tokens | the owner's signature; same transaction as input 1 |
| input 1 | the state NFT | the owner's signature; its commitment is the state |
| input 2 | a plain BCH coin | no tokens; for the template, output 0 of its transaction |
| output 0 | the released tokens, to the owner's P2PKH | exact amount, owner's address, token category |
| output 1 | the tokens left, back to the vault | exact amount, vault address, token category |
| output 2 | the new state NFT, back to the vault | vault address, exact new commitment |
| locktime | the release height | `tx.time >= blockHeight` |

The contract releases `reward` tokens for each block since the last release. A release stops at the next halving: the state then records the halving height and half the reward, and the next release continues from there. When a release would take all the tokens left, there is a single output with everything, and the vault closes.

**Why input 2 must be output 0 of its transaction.** The state NFT is immutable, so a new commitment needs a new NFT. Each release mints it with the category of input 2's transaction hash. CashTokens allows that only for an input that spends output 0. Upstream's `releaseToken.js` does the same.

### Why the contract is used unchanged

The contract is deployed with tokens locked in it, and changing a byte would separate this template from it. Our house rules would usually flag the following, but they come with the deployed contract:

- **Fixed indices and exact input and output counts.** A release can't share a transaction with another contract.
- **A key, not a token, for the owner's rights.** Releases are signed with the owner's key, and tokens go to that key's P2PKH address.
- **Block heights, not time.** The schedule is defined in blocks, like Bitcoin's.

### Mapping into the template

| Contract | Template |
| --- | --- |
| Compiled bytecode | `scripts.vaultBytecode`, read from `artifact/TokenVault_Release.json` (equal to upstream's artifact) |
| Constructor `(fund, halvingLength)` | `vaultRedeem`: `<halvingLength> <ownerKey.public_key> vaultBytecode`, `lockingType: "p2sh"` (P2SH32) |
| `release(sig, blockHeight)` | unlocking `unlockRelease`: `<blockHeight> <ownerKey.schnorr_signature.all_outputs>`, on both vault inputs |
| The owner's address (`new LockingBytecodeP2PKH(hash160(fund))`) | `ownerLockingScript`: P2PKH of `ownerKey`. The owner's balance (released tokens, fee coins) |
| The release, normal case | action `release` → `releaseTransaction`, locktime `$(<blockHeight>)`, outputs `releasedOutput`, `vaultTokenOutput`, `vaultStateOutput` |
| The release that empties the vault | action `releaseFinal` → `releaseFinalTransaction`, output `finalOutput` |
| Creating a vault (no contract function) | action `lock`: a provider (the page) may fill in the settings and pick the coins; the owner's wallet generates `ownerKey`, and makes `feeCoinOutput` (index 0), `lockTokenOutput`, `lockStateOutput` and `vaultRecordOutput` |
| A coin to pay for the next release | action `addFeeCoin`: `feeCoinOutput` at output 0 of the owner's address |

**The release maths.** XO output values can't read input values, so the release takes the vault's coins as variables: token amount, satoshis, state and categories. A tool fills them in from the chain (role `provider`). Every output is then computed with the contract's formulas (`releaseAmount`, `tokensLeft`, `nextStateCommitment`). Wrong values can't move anything the contract doesn't allow: the contract rejects the spend.

**Commitments as hex text.** The engine evaluates token fields as text. The state commitments are built as hex text with `bytes8HexText` and `binToHexText` (the same loop helper as Badgers Stake), and the tests check them against the contract's bytes.

**The vault record.** `lock` adds a 0-satoshi output, `OP_RETURN "TVLT" <owner public key> <halving length>`. A tool can rebuild both addresses from the lock transaction alone. The contract doesn't see this output.

**Change.** A release can't have a change output. The fee coin pays a fixed `releaseMinerFeeSatoshis` (2000, about 1.6 sats per byte of a ~1,250-byte release), and the rest of it goes to the owner with the released tokens on output 0. A test checks that the fee covers the signed size.

**Guards.** The engine refuses to build:
- a lock of nothing, with a reward of 0 or above the amount locked, or with a halving length outside 1 to 500,000,000;
- a release that doesn't move past the last release, or one above 500,000,000;
- a fee coin under 3000 sats;
- a `release` that would empty the vault, or a `releaseFinal` that wouldn't.

Roles:
- **`owner`** locks, signs releases and funds fee coins.
- **`provider`** is a tool (like the `web/` page) that fills in a lock, a release or a fee coin from the chain. It holds no keys and gets nothing.

The vault's coins have zero balance and `selectable: false`. Coins at the owner's address count as the owner's.

## Using it

The template tools page (`#token-vault`, see [web/README.md](../web/README.md)) runs the whole lifecycle. Each step builds an invitation that the owner's XO wallet imports as **Owner**, finishes, signs and broadcasts:

1. **Lock** ("1 · Lock"). Paste the XO wallet address that holds the tokens and some BCH. Pick the token, its decimals (typed by hand; the chain only stores base units), the amount, the reward per block, the halving length and the start block. The page shows the schedule and builds a `lock` invitation with the settings and the coins to spend: the token coins, a coin at output 0 (whose hash becomes the state NFT's category) and BCH. The wallet generates the vault key, adds the vault's outputs and its change, signs and broadcasts. The lock also makes the first fee coin.
2. **Release** ("2 · Manage"). Enter the lock transaction id. The page reads the vault record and the vault's coins, shows the state, and builds a release up to a height you pick (at most the current block). The wallet signs the three inputs and broadcasts.
3. **Fee coins.** Each later release needs a new fee coin at output 0 of the owner's address. The page builds an `addFeeCoin` invitation; the wallet pays for it.
4. **Final release.** When a release would take all the tokens left, the page builds `releaseFinal`, which pays everything to the owner and closes the vault.

The `lock` action can also be started from the wallet itself, without the page. Only the wallet that locked a vault can release it, because the owner key is derived inside that wallet.

## Safety notes

- **Tokens are locked** until the schedule releases them, and they can only go to the owner's address. Losing the wallet that locked a vault means losing the vault.
- **The halving length can't be changed.** A vault halves every `halvingLength` blocks for its whole life. Small values release quickly: the reward halves down to 1 token per block.
- **Each release needs its own fee coin** at output 0 of the owner's address.

## Tests

```bash
cd templates && npm test
```

- `test/contract.test.ts` (13 tests): the contract alone, compiled into an independent Libauth wallet template (`test/vault.ts`) with signed vault, owner and fee coins in the BCH 2026 VM.
  - **Accepts:** a release between halvings, a release that stops at a halving, and the release that empties the vault.
  - **Rejects:** each spend below fails in the VM, not while it is being built.
    - releasing past a halving at the old reward
    - a signature from another key
    - one token too many
    - another recipient
    - a locktime below the release height
    - a wrong next state
    - a fee coin with tokens
    - a state NFT from another transaction
    - an extra output
    - a final release with two outputs
- `test/template.test.ts` (17 tests):
  - **Contract and scripts:**
    - the embedded bytecode equals upstream's artifact, and cashc 0.10.0-next.4 rebuilds it
    - the redeem script is the one the VM hashes to the vault address
    - the unlocking order matches CashScript's
    - the vault record's layout
    - the state commitments as hex text
  - **Spends:**
    - the lock outputs
    - releases built from template outputs pass the VM: between halvings, at a halving, after one, at a reward of 1, and the final release
    - locktime and sequence numbers
    - the guards
    - the fee covers the signed size
  - **Publishing:**
    - `template.json` is current
    - the registry audit reports no failures. Its offline compile check is skipped, because every locking script needs the owner's key.
- `web/test/token-vault-lock.test.ts` (6 tests): the schedule (eras, the last short era, a reward of 1); the coins the page picks for a lock (token coins, an output-0 coin for the state NFT, BCH, never other tokens) and the messages when something is missing; the settings it refuses; and a lock invitation that a test wallet completes (vault key, outputs, change, signatures) into a transaction the VM accepts.
- `web/test/token-vault-invitation.test.ts` (10 tests): release, halving and final invitations on both networks. Each one:
  - passes XO validation;
  - becomes a transaction from XO's builder that the VM accepts once it is signed with the owner's test key.

  The fee coin invitation pays output 0 of the owner's address.

## Chipnet

```bash
cd templates
npx tsx token-vault/scripts/chipnet.ts mint             # or set TOKEN_CATEGORY to a test token the wallet holds
npx tsx token-vault/scripts/chipnet.ts lock             # XO action lock, started in the wallet: 5000 tokens, 1000 per block, halving every 3 blocks
npx tsx token-vault/scripts/chipnet.ts lock-page <addr> # the page's lock invitation from one address, completed by the wallet
npx tsx token-vault/scripts/chipnet.ts finish <file>    # any invitation copied from the page, finished as the owner's wallet does
npx tsx token-vault/scripts/chipnet.ts release          # page-built release, imported and signed by the wallet as owner
npx tsx token-vault/scripts/chipnet.ts feecoin          # page-built addFeeCoin, funded by the wallet
npx tsx token-vault/scripts/chipnet.ts status
```

The release and fee coin invitations come from `web/src/lib/token-vault-core.ts`, the page's own builder. The script saves each one as the page would hand it out, then imports it into the test wallet as `owner`.

### Full lifecycle from the page (vault 4)

Run on 2026-11-21 with template `d27bf857…55f3`. The lock, the first release and the first fee coin were built **in the browser page** and copied out exactly as its Copy button gives them; the script's `finish` mode then did the wallet's part. The second release, the second fee coin and the final release came from the same builder through the script's `release` and `feecoin` modes. Settings typed in the page: test token `0b7ed51a…e4b4` with 2 decimals, 50.00 tokens, 10.00 per block, halving every 3 blocks, from block 333300.

| Step | Transaction | What happened |
| --- | --- | --- |
| Lock (page) | `87919eb31787edaf0abfe186de274a513f0a8ba892275a6e3d7dfae98aa68d89` | Page `lock` from `bchtest:zzcw30jg2q3d6s4qfak83erdk4pamgwwj545g0vfk5`: the 640,000-token coin and a 501,756-sat coin at output 0 (the state NFT's genesis). The wallet added the vault key, the outputs, the token change (635,000) and the BCH change. Vault `bchtest:rwpwzns2fuhjqzfaxs9fjtxm75yd72ndjzfddpqfw2pavh382untkqvssq59m` |
| Release to a halving (page) | `dbc2743358ada4b5ff64cc94164bbd37b18ff15d2db40235ca2de651d5c6eb8f` | Up to block 333384, stopped at the halving at 333303: 30.00 tokens; reward now 5.00 |
| Fee coin (page) | `515794b6785fede3da48247566881a04fc92d3d4e0942babed650e0ca088fa6b` | 5000 sats at output 0 of the owner address |
| Release | `635a2738e7f691fe5cd927d7155df14ac5b7e96d73eda251f38496e9e47ea456` | Up to block 333304: 10.00 tokens |
| Fee coin | `c9661ef2c2e08d75ade714ad5205771df9f132b65691c91b24ebc2bc8b8e5e60` | 5000 sats |
| Final release | `43ccea9bef85fd245bb2e3e78c29974c7b7c9c5fa121da7d9666f08fc1108421` | The last 10.00 tokens and all the BCH to the owner; the page then shows the vault as closed |

Vault 3 (`d16214edfbed78c3ed8926a49ed98bf0b7fc7cb520d726768925bb692500969a`, a `lock-page` run from the vault-2 owner address) was the first page-built lock; its release `6d549f6f12685d7b48ff3bc174fa1f472e44db8bc3b8847f3b6ca62c17c004ac` showed the wallet tracks a vault it locked from the page's invitation.

### Releases and fee coins (vault 2)

Run on 2026-11-21, vault 2 (`VAULT=token-vault-2 START_HEIGHT=333370 FEE_COIN_SATS=3000`, test token `0b7ed51a…e4b4`, 5000 tokens, 1000 per block, halving every 3 blocks):

| Step | Transaction | What happened |
| --- | --- | --- |
| Lock | `a487c1c2af26096ee5ff920656c8c4c178891a60fa8cc34b580f5f15c132e23a` | XO action `lock`: fee coin (output 0), 5000 tokens and the state NFT at `bchtest:r065qa8trmegmc88p4epmlzmrc3y944ur4c3g8tjvrqkeguadxqty7me6m8rd`, and the vault record. Owner `bchtest:zp0pdgsqq89kef5krfq4wt8r0ratuktftudf8aqv9n` |
| Release to a halving | `914881910aec2ec712951c502d6d968ba18dbc26c64979765f08bd8a83fb5c7b` | Up to block 333375, stopped at the halving at 333373: 3000 tokens; reward now 500. Locktime 333375 |
| Fee coin | `38c56d1598e59c75e6da8a4984244f9ac914ae820bb559672fc3874de7fb33ae` | Page-built `addFeeCoin`, funded by the wallet: 3000 sats at output 0 of the owner address |
| Release | `b2e7e63b58ef8c4fce99e2b333e381721efbff7b2e06647e0c4567568b1c8dcf` | Up to block 333374: 2 blocks at 500, 1000 tokens. Locktime 333374 |
| Fee coin | `000c724e891372767596de88cd8a89c4c57e076ba6b5e4981229ac7fcdc35f61` | Page-built `addFeeCoin` |
| Final release | `d3e4f91b78ca3aba901b5a812f65496dd626d52385307b25bf94eb83674b801d` | `releaseFinal` up to block 333384: the last 1000 tokens and all the BCH to the owner, in one output. The vault address is empty; the owner holds all 5000 tokens |

Each release was built by the page's code, saved as the page hands it out, imported into the XO wallet with `acceptInvitation` as `owner`, signed on all three inputs and broadcast by the engine.

**Why vault 2 starts at block 333370.** On 2026-11-21 the chipnet Electrum servers reported a tip of about 341,800, but chipnet's nodes rejected every transaction with a height locktime above 333384 as `bad-txns-nonfinal`. A plain P2PKH probe found the exact boundary, and it did not move as new blocks arrived. The first vault (`b616d6762e67b237c47e16432b03bf7bb66abe30370fd4c9e76490d7479bd205`, starting at block 341761) could therefore not be released, so vault 2 starts below the boundary. This is a chipnet problem, not the template's: the contract needs the locktime to be at least the release height, and mainnet nodes accept locktimes up to their tip.

## XO engine notes (engine 0.1.1-next.18029697917)

- **Signing needs tracking.** A wallet signs a contract input only for coins it tracks, with keys it derived itself. An outside key can't be imported. `lock` makes the wallet track both the vault and the owner's address.
- **A transaction's `locktime` can be a CashAssembly expression** (`$(<blockHeight>)`). Inputs default to sequence number 0 (not final), so the locktime is enforced.
- **Signing twice conflicts.** After the wallet signs the three release inputs itself, the shared `signAndBroadcast` helper must not sign them again (`sign: false`). A second signature on the same input is rejected as a conflicting commit.
- **A locking script compiled with the owner's key needs the `owner` role, even when it is unspendable.** The vault record's locking script lists `owner` with `relevant: false`.
- **An accepted invitation isn't tracked.** `acceptInvitation` doesn't start tracking an invitation's outputs; only `createInvitation` and `appendInvitation` do. So the page's lock invitation carries no outputs: the wallet adds them with `appendInvitation` as `owner`, which compiles them with the key it just generated and starts tracking the vault and the owner address. Releases then work because the wallet already tracks the vault.
- **Accepting as `owner` generates the vault key.** `acceptInvitation(..., { roleIdentifier: 'owner' })` generates the role's `generate` keys (`ownerKey`), the same as starting the action in the wallet.
