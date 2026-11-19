# Writing and adding XO templates to XOGrid

For anyone writing templates (Miguel) and for whoever integrates them into the registry. A template lives in the registry by its content-addressed identifier; the same content always gets the same id.

## Converting a CashScript contract

Contract conversions live in [`templates/`](../templates/README.md), one folder per contract system. Each folder holds the `.cash` source, its cashc artifact, the template, tests that prove the template builds exactly the contract, a chipnet script, and a Credits section for the original authors. Start from `contracts/_skeleton/`. `contracts/revenue-split/` is the worked example. Once a converted template is chipnet-verified, register it in the hub as described below.

## The fast path

1. Write the template as a TypeScript file in `server/src/templates/<name>.ts` that exports a plain object. `claim-voucher.ts` is the working example to copy.
2. Run it through the audit and check its identifier (see "Check it locally").
3. Add a test next to `server/test/claim-voucher.test.ts` that proves the script does what it claims.
4. Register it in the seed list in `server/src/seed.ts`.
5. Run `cd server && npm test`.
6. Run it on chipnet end to end (see "Prove it on chipnet") and keep the transaction ids.

## Template shape

Look at `server/src/templates/claim-voucher.ts`. The pieces that matter:

- `roles`, `start` (the first actions) and `actions` (who does what).
- `variables`, each with a `type` such as `satoshis`, `bytes`, `locking_script`.
- `transactions`, `inputs` and `outputs`, and `lockingScripts` and `scripts` for the contract code.
- `supported` VM versions. Our templates list `BCH_2023_05` to `BCH_2026_05`.

Reference templates (`p2pkh`, `faucet`, `multisig`, `wrapBCH`) ship in `@xo-cash/templates` and are a good source of patterns.

## Check it locally

The registry applies the same checks to every template, so run them before you publish. Publishing to a local hub shows the report:

    cd server && npm run dev                 # in one terminal
    curl -s -X POST localhost:3000/api/templates \
      -H 'content-type: application/json' \
      -d '{"template": <your template JSON>, "publisher": "Miguel"}'

or write a test the way `claim-voucher.test.ts` does, calling `runAudit(...)` and `generateTemplateIdentifier(parseTemplate(...))`.

The seven automated checks:

| Check | Fails when | Notes |
|---|---|---|
| Template schema | `parseTemplate` rejects the JSON | Publishing an invalid template is refused with a 400, so it is never stored |
| Template identifier | The stored form differs from the canonical form | A different key order is only a warning. The registry stores the canonical `serializeTemplate` output |
| Template size | Over 256 KB is rejected (413) | A large one warns |
| Internal references | An output uses an undefined locking script, an input an undefined script, and similar | Expressions like `$(<variable>)` are allowed |
| Offline compile | A locking script does not compile with sample values | Scripts that need keys or secrets are skipped, never failed |
| Test scenarios | Never fails. It warns when none are included | XO says scenarios do not provide trust |
| Resource links | Never fails. It warns when a resource address is not a plain `https` link (for example `http:`, `javascript:`, `data:`, or an address with a login in it) | The "resources" field is free text from the publisher and is shown as links. XOGrid does not make a flagged address clickable. A template with no resources is skipped |

Badges: `unchecked` (no report), `auto-checked` (no failing check, which is not a safety claim) and `reviewed` (a moderator reviewed this exact id). Only a moderator can set `reviewed`.

## Gotchas we hit (all cost real time)

- **Bytes variables are hex strings.** In an invitation, a `bytes` variable must be given as a hex string. Passing a `Uint8Array` silently compiles a different locking script, which can send funds to an unspendable script. Always check the compiled lock against what you expect.
- **`p2sh` compiles to P2SH32.** The XO locking type `p2sh` produces `OP_HASH256 <32-byte hash> OP_EQUAL` (`aa20...87`), not the older 20-byte P2SH.
- **Role on the output.** The engine tracks outputs that carry a role on the locking script, so give the receiving role an action on the locking script. Template inputs need an `inputIdentifier` on the invitation input.
- **Engine-generated secrets** must be `private_key` variables. A user-supplied value for a secret is fine.
- **Storage.** The engine must use `StorageType.INDEXEDDB`. The SQLite storage in the current state package is incomplete and fails with `listScriptHashes is not a function`.
- **Locktime and version.** Use `transactionVersion` and `transactionLocktime` on `createInvitation` and `appendInvitation` (fixed in engine `0.1.1-next.18029697917`). Template-level locktime, version and sequence numbers are now applied too.
- **`selectable: false`** outputs no longer show up as spendable in the current engine. Zero-value outputs are kept but must be OP_RETURN, and OP_RETURN outputs are not tracked.
- **Identifiers must not depend on the tooling version.** We verified `@xo-cash/utils` 0.0.10 and 0.0.11 give the same ids for all our templates. Re-check when you bump a version: seed templates must keep the same identifiers.

## Prove it on chipnet

The scripts in `server/scripts/` run a template against real chipnet coins with the XO engine:

- `chipnet-gate.ts` checks the setup (engine, storage, identifiers).
- `chipnet-voucher.ts issue` and `claim <code>` show the full flow for the voucher. Copy it as a starting point for a new template.
- `export-invitations.ts` writes each invitation as JSON that you can paste into the Blaze Tool at blaze.xo.cash (set to chipnet, import the template first).

Always run these against chipnet, never mainnet. Keep the transaction ids and the invitation files as evidence.

## Registering the template

Add an entry to `SEED_TEMPLATES` in `server/src/seed.ts`:

    { template: myTemplate, publisher: 'XOGrid', spotlight: 'One sentence on why it is worth featuring.' },

`spotlight` is optional and puts it on the Home page. Seeding is idempotent: running it again never duplicates a template. After adding one, update the counts in `server/test/hub.test.ts` (the test that checks how many templates are seeded).

## Definition of done

- [ ] Identifier computed and written down
- [ ] All seven automated checks pass or are explained
- [ ] A test proves the contract accepts what it should and rejects what it should not
- [ ] Ran end to end on chipnet; transaction ids recorded
- [ ] Executed invitation opens in the Blaze Tool with no validation issues
- [ ] Added to the seed list and the test counts updated
- [ ] A short description a newcomer can understand
