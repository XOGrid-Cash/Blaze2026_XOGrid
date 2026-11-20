# Decision record: how XOGrid tracks reviews on-chain

Status: **decided in discussion on 2026-11-18; receipt builder and parser built, reader and UI not yet.** Written 2026-11-19 for the BCH BLAZE 2026 judges and for whoever builds it.

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
- **Review address custody (open).** Someone on the team must hold the key if we ever want to sweep the dust. Recommendation: a team-held address; the dust is not the point.

## 5. Relationship to what exists today

At the last handoff, reviews were **off-chain**: the server stores them in its database, after the wallet signs a challenge. The hybrid above is an **optional on-chain receipt layer** on top, not a replacement. Whether the existing database reviews and the on-chain ones are merged or shown side by side is still to be decided when it is built.

## 6. Related idea, not decided: review without WizardConnect (item 8)

Instead of requiring a WizardConnect session, XOGrid could hand the reviewer an **XO invitation** that builds the review transaction above, for any XO wallet to import and broadcast. Open points:

- It needs the importing wallet to add the reviewer's own coin and signature. Whether an XO wallet does that on import is **not verified** (the same unknown as our Revenue Split invitation). It would have to be tested with a real wallet first.
- The invitation would hold only the review output and the OP_RETURN, so it should carry no funds of ours.
- Reading history back is unchanged, because the on-chain format is identical.

Recommendation: build it **after** the basic receipt flow works and one chipnet import has succeeded. Do not present it as working before then.

## 7. To build

1. **Built (2026-11-19):** the receipt builder and parser, with tests (`server/src/review-receipt.ts`, `server/test/review-receipt.test.ts`). The parser checks structure and the signer's key, not signatures, so it must only be given confirmed transactions.
2. Not started: a server reader on the review address (Electrum), with earliest-wins and hash matching.
3. UI: a "recorded on-chain" badge with a transaction link, and the pending state.
4. Decide the review address and its custody.
5. Chipnet end-to-end test with a real wallet.
