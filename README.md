# XOGrid

XOGrid is a marketplace for XO templates: a registry ("Docker Hub for XO templates") where anyone can publish a template, get a content-addressed identifier, see automated audit results, community flags and moderator reviews, and discover templates by what they do.

Built for BCH BLAZE 2026 (Mainnet Track, Community Choice and the Build with XO bounty).

## What is in it

- A registry server (Fastify; SQLite locally, PostgreSQL in production) that stores and serves templates by identifier, runs audit checks, tracks flags and reviews, and previews a wallet trust policy.
- A moderator portal with wallet login (WizardConnect or a signed message).
- A React and Tailwind web app: browse, template detail, admin and a live demo.
- A novel template, the claim-code voucher: lock satoshis to the hash of a secret code, and whoever knows the code can claim them. Verified end to end on chipnet.
- A live demo page where two templates run for real, in the browser: the claim-code voucher, and Drip Mine, a shared pot of coins that pays out to miners and that anyone can trigger. Both build their transactions with the XO engine from the registry templates. Each build is compared byte for byte with an independent implementation written with libauth, and nothing is sent if the two differ. Every other template opens as a guided walk-through.

## Status

The build window opened on Nov 14. The registry, audit and login groundwork was prototyped earlier in the original repository (StrungSafe/Blaze2026, public history) and is being brought into this repository in stages, each as its own pull request. The demo, the voucher flow, the live Drip Mine runs, the XO engine builds, the mainnet transaction and the polish are built here.

## Docs

- [Scope](docs/SCOPE.md)
- [Build spec](docs/XO%20SPEC.md)
- [Proposal checklist](docs/PROPOSAL.md)
- [Handoff notes](HANDOFF.md)

