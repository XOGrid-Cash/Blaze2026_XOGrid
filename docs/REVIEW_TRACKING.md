# Decision record: how XOGrid tracks reviews on-chain

Status: **decided on 2026-11-18 and built on 2026-11-19/20** (server, page and tests). Chipnet and mainnet runs with a real wallet are reported separately; this document does not claim them. Written for the BCH BLAZE 2026 judges and for whoever continues the work.

## 1. Question

If a review is also recorded on Bitcoin Cash, how does anyone (our server, a judge, another registry) find those reviews again?

Two designs were on the table:

- **A. Prefix.** Every review transaction carries an OP_RETURN that starts with a fixed XOGrid tag. Rebuild history by finding every transaction with that tag.
- **B. Address.** Every review transaction pays one known XOGrid review address. Rebuild history from that address's transaction list.

The trade-off, as put by the team: a prefix makes rebuilding history simple but makes spam easier; tracking by address still needs an identifier so unrelated payments are not indexed as reviews, and it ties us a little more to one address.

## 2. Decision

Use **both**, each doing the job it is good at (a hybrid):

1. The review transaction **pays a small amount to one XOGrid review address**. This is how the history is *found*, using the Electrum calls the server already uses.
2. The same transaction carries **one OP_RETURN output with a fixed prefix**. This is how a payment is *recognised* as a review and read.

The reviewer is whoever's key signs the first input. That is a real transaction proof, not a claim in text.

### OP_RETURN layout (version 1)

| Field | Size | Content |
|---|---|---|
| Prefix | 4 bytes | ASCII `XGRD` |
| Version | 1 byte | `0x01` |
| Template identifier | 32 bytes | The 64-hex identifier of the reviewed template |
| Rating | 1 byte | 1 to 5 |
| Text hash | 32 bytes | SHA-256 of the review text (the text itself stays off-chain) |

That is 70 data bytes. The standard OP_RETURN limit on Bitcoin Cash is **223 bytes per transaction**, so there is room to spare, and we still have room for a version bump. The limit was checked on 2026-11-19 in a [Bitcoin Cash Research thread](https://bitcoincashresearch.org/t/op-return-length-limit-on-bch/1786/3); that thread discusses raising it, but I found no change made. Recheck before building.

### Reading history back

1. List the review address's transactions (plain Electrum, no special indexer).
2. Keep a transaction only if it has exactly one OP_RETURN, starting with `XGRD` and a known version, and the length is right.
3. The reviewer key is the public key in the first input's unlocking script (P2PKH inputs only; anything else is ignored).
4. One review per (reviewer key, template identifier); the **earliest confirmed** one wins (ordered by block height, then position in the block). This is the same rule the database already uses ("This wallet has already reviewed this template"), so a key cannot change its rating by sending a second receipt.
5. Fetch the text from the XOGrid server by its hash. If the text is missing or its hash does not match, show the rating only and say the text is unavailable.

## 3. Why not the alternatives alone

- **Prefix only.** Easy to define, but a plain Electrum server cannot search OP_RETURN data by prefix, as far as I know. It would need a Chaingraph-style indexer or our own node, which is more infrastructure than we have time to run before Nov 22. Anyone can also post a prefixed transaction for free-ish, with nowhere to filter it from.
- **Address only.** Works with what we already run, but every stray payment to the address would count as a review, and we would have no template identifier or rating to read.
- **Hybrid.** The address makes history *findable*, the prefix makes it *readable and filterable*, and the dust plus the fee give each review a small cost.

## 4. Honest limits

- **Spam is slowed, not stopped.** A review costs the dust amount (about 546 sats) plus the miner fee, which is a few hundred sats. That deters casual spam, not a determined person with many keys. Mitigations we have: the UI counts distinct reviewer keys, moderators can hide a review, and the earliest-wins rule stops one key from stacking ratings.
- **Chain data cannot be deleted.** Moderation happens in our database (hide the review in XOGrid); the transaction stays on-chain. This is stated in the UI.
- **Text is off-chain.** Only a hash is on-chain, so the text can be lost, and the hash proves only that *this* text was committed to by *this* key.
- **A reviewer key is not a person.** It shows control of a key, not a real identity.
- **Unconfirmed reviews** should show as pending and not count until confirmed (reorg protection).
- **Review address custody (decided).** The review address is derived from the admin identity the team already controls (a public key or address as is; the first child key of an xpub), so the key that signs moderator logins also controls the received coins. Mainnet and chipnet addresses come from the same key. Each receipt sends 546 sats to the team; the network fee goes to the miner, not to XOGrid.
- **"Confirmed" trusts the chain server.** The server accepts a receipt as confirmed when the Electrum server reports at least one confirmation. It does not verify block headers or merkle proofs. Transaction ids are recomputed from the bytes, so the server cannot swap in another transaction, but it could misreport a confirmation count.

## 5. Relationship to what exists today

Reviews stay **off-chain first**: the server stores them in its database after the wallet signs a challenge. The hybrid above is an **optional on-chain receipt layer** on top, not a replacement.

**Decided: one list, with a badge.** A database review gets a "Recorded on-chain" badge (with a transaction link) once its receipt is confirmed, or "On-chain receipt pending" before that. A receipt with no matching database review counts for nothing, so a stray or spam transaction cannot change any rating. The one-review-per-wallet rule stays in one place (the database), and on-chain the **earliest** confirmed receipt per key and template is the one that counts.

### How it works as built

1. The reviewer publishes the review (wallet signs a message-only challenge; nothing is broadcast).
2. Optionally the page offers "Also record it on-chain" with a network choice (chipnet is the default, mainnet moves real coins) and the cost.
3. `prepare`: the server builds an unsigned transaction paying 546 sats to the review address, one OP_RETURN of the layout above, and change back to the reviewer. It spends one plain coin (smallest confirmed coin that fits) from the wallet's first receive address. Fee rate 1.5 sat/byte (about 460 sats).
4. The wallet only **signs** (`broadcast: false`).
5. `broadcast`: the server checks the signed transaction before sending: exactly one input, it parses as a receipt, it matches this review's template, rating, text hash and key, the signature is valid in the BCH virtual machine, and the fee is at most 10,000 sats. Only then does the server send it. The result is "pending".
6. The page asks the server to re-check every 20 seconds; the server also re-checks pending receipts whenever a template's reviews are read (at most once a minute per review), so a receipt confirms even after the reviewer leaves.

## 6. Related idea, not decided: review without WizardConnect (item 8)

Instead of requiring a WizardConnect session, XOGrid could hand the reviewer an **XO invitation** that builds the review transaction above, for any XO wallet to import and broadcast. Open points:

- It needs the importing wallet to add the reviewer's own coin and signature. Whether an XO wallet does that on import is **not verified** (the same unknown as our Revenue Split invitation). It would have to be tested with a real wallet first.
- The invitation would hold only the review output and the OP_RETURN, so it should carry no funds of ours.
- Reading history back is unchanged, because the on-chain format is identical.

Recommendation: build it **after** the basic receipt flow works and one chipnet import has succeeded. Do not present it as working before then.

## 7. Status of the build list

1. **Built:** receipt builder and parser (`server/src/review-receipt.ts`). The parser checks structure and the signer's key, not signatures, so signatures are checked separately before sending (step 5 above).
2. **Built, in a smaller form than first planned:** the server looks up a **given transaction** (Electrum) and attaches it to a stored review, plus the verified broadcast. It does **not** scan the whole review address to rebuild history; that is the larger design (option B in the handoff) and is not done.
3. **Built:** the "Record on-chain" step, the badge, the pending state and the explorer link (`frontend/src/components/hub/RecordOnChain.tsx`).
4. **Decided:** the review address comes from the admin identity (see section 4).
5. **Needs a real wallet, not verified by the build:** a chipnet end to end run (review, record, pending to confirmed), then one mainnet run. Also unchecked: the default Electrum servers (`bch.imaginary.cash:50002`, `chipnet.imaginary.cash:50002`, overridable with `ELECTRUM_MAINNET` / `ELECTRUM_CHIPNET`), whether the wallet accepts the signing request for a real transaction, and the chipnet explorer link format.
6. **Not built:** history rebuilt from the review address alone, merkle or header verification, receipts that spend more than one coin, and review by XO invitation (section 6).
