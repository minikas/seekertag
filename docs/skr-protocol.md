# SeekerTag reward escrow protocol v2

Implementation ABI for direct handover with a prior owner commitment. This is not a deployment or external audit certificate. Only the original SPL Token program is accepted. The application pins network, program and mint, including the official SKR mint for mainnet. All integers are little endian, with u64 token base units and i64 Unix timestamps.

## Addresses and accounts

`reward = findProgramAddress([utf8("reward"), owner.toBytes(), rewardId], programId)`

`vault = findProgramAddress([utf8("vault"), reward.toBytes()], programId)`

Reward IDs and report references are opaque random 32-byte values. They must not contain tag codes, contact information, database IDs or predictable hashes of those values. The receipt PDA owns the custom vault PDA. Funding and payout/refund accounts are canonical ATAs for the recorded mint. The owner funds rent and destination ATA creation; the finder pays the transaction fee for waiver. There is no fee sponsorship.

## State machine

```text
funded --owner commits recipient/reference--> committed
funded --owner renews-----------------------> funded (same receipt and QR)
funded --owner refunds after offer expiry---> refunded
committed --owner pays fixed recipient------> paid
committed --recipient signs waiver----------> funded (no token transfer)
```

Scanning a QR, sending a message or proving control of a wallet does not create a commitment or extend any deadline. In the application, the owner selects an open conversation with a verified recipient wallet and signs the commitment before handover. The wallet proof authenticates control to the backend; it is not an on-chain declaration of physical possession or finder consent to an agreement.

A confirmed commitment blocks refund, renewal and recipient replacement. The owner must still sign payout. The original deadline limits acceptance of new commitments and withdrawal of **uncommitted** offers; it does not terminate an existing commitment. Payout remains possible after that deadline. A finder may voluntarily waive without receiving tokens, clearing the binding while preserving principal, original offer expiry and QR. A now-expired offer can then be refunded by its owner.

Every commitment increments `claimSeq`. Commit takes the expected old sequence; release and waiver require the active sequence. Old signed instructions cannot apply to a later commitment, including a later commitment to the same wallet/reference. Paid and refunded receipts are terminal and cannot be reused.

Without payment or finder waiver, a disagreement can leave the funds committed indefinitely. There is no implied arbitrator. The contract cannot verify a physical handover or distinguish people controlling multiple wallets. Before committing to an honest finder, an owner can still commit to and pay another wallet they control. This model protects the fixed recipient after commitment, but cannot guarantee that the owner will sign payment.

## Instructions

Exactly the listed accounts and data length are required. S = signer; W = writable; others readonly.

| Instruction | Data | Accounts in order |
| --- | --- | --- |
| Create (0) | `0, rewardId[32], amount:u64, expiresAt:i64` — 49 bytes | owner(S,W), reward(W), vault(W), mint, owner ATA(W), System, SPL Token |
| Release (1) | `1, claimSeq:u64` — 9 bytes | owner(S), reward(W), vault(W), mint, fixed recipient ATA(W), SPL Token |
| Refund (2) | `2` — 1 byte | owner(S), reward(W), vault(W), mint, owner ATA(W), SPL Token |
| Renew (3) | `3, expiresAt:i64` — 9 bytes | owner(S), reward(W) |
| Commit (4) | `4, expectedSeq:u64, recipient[32], reportRef[32]` — 73 bytes | owner(S), reward(W) |
| Waive (5) | `5, claimSeq:u64` — 9 bytes | recorded recipient(S), reward(W) |

Create atomically allocates accounts and transfers the exact positive amount. Non-native initialized mints without freeze authority are accepted. SOL prefunding of either PDA does not prevent creation. Create/renew allow at most 365 days from the chain clock. Renew strictly increases the previous expiry and may revive an expired, uncommitted offer. Commit requires a live funded offer, a nonzero recipient/reference, and a sequence that can increment without overflow.

Release transfers the principal to the recipient stored in the receipt; there is no freely selected recipient in its instruction data. Refund requires a funded offer at or beyond its expiry. Waive requires the stored recipient's signature, transfers no tokens, clears recipient/reference/commit timestamp, and preserves the sequence. The on-chain program does not depend on the API to enforce these restrictions.

Unsolicited token donations cannot block settlement; surplus tokens remain in the vault. Receipt and vault remain open after settlement, with no rent or surplus recovery instruction. Transactions are atomic and double settlement fails.

## Receipt layout (224 bytes)

| Offset | Length | Field |
| --- | --- | --- |
| 0 | 8 | ASCII `SKREWRD2` |
| 8 | 1 | Version 2 |
| 9 | 1 | Status: 1 funded, 2 paid, 3 refunded, 4 committed |
| 10 | 1 | Canonical reward bump |
| 11 | 1 | Canonical vault bump |
| 12 | 1 | Mint decimals |
| 13 | 3 | Reserved zero bytes |
| 16 | 32 | Funding owner |
| 48 | 32 | Mint |
| 80 | 32 | Reward ID |
| 112 | 8 | Amount u64 |
| 120 | 8 | Offer expiry i64 |
| 128 | 32 | Recipient in committed/paid; otherwise zero |
| 160 | 32 | Report reference in committed/paid; otherwise zero |
| 192 | 8 | Created timestamp i64 |
| 200 | 8 | Settled timestamp; zero in funded/committed |
| 208 | 8 | Monotonic claimSeq u64, initially zero |
| 216 | 8 | Committed timestamp; zero in funded/refunded |

`decodeReward` validates layout and state consistency. Consumers must also verify program ownership, canonical address, configured network/mint, account authorities and sufficient vault principal against trusted RPC state. API synchronization uses finalized state and rejects sequence rollback or altered identity within the same observed commitment. Immutable wallet proof history keeps a binding reconcilable if a direct on-chain commitment races a new wallet proof.

## JavaScript builders

Import `shared/reward-protocol.mjs` with declarations in `shared/reward-protocol.d.mts`. Public keys accept PublicKey or base58; references are exactly 32 bytes. Integer parameters accept bigint or canonical decimal strings, never floating-point token amounts.

- `createRewardInstruction({ programId, owner, mint, rewardId, amount, expiresAt, source? })`
- `commitRewardInstruction({ programId, owner, rewardId, recipient, reportRef, expectedSeq })`
- `releaseRewardInstruction({ programId, owner, mint, rewardId, recipient, claimSeq, destination? })`
- `waiveRewardInstruction({ programId, owner, rewardId, recipient, claimSeq })`
- `refundRewardInstruction({ programId, owner, mint, rewardId, destination? })`
- `renewRewardInstruction({ programId, owner, rewardId, expiresAt })`

Release's recipient argument derives its ATA; the contract checks that ATA against the stored recipient. Builders do not send transactions. Frontend validation reconstructs the entire allowed transaction and checks sequence, signer, recipient and conversation before asking the wallet to sign. Only waiver uses the finder as fee payer.

## Compatibility and validation

V2 receipts and instructions are incompatible with v1 (208-byte `SKREWRD1`). The SQLite schema migration preserves database rows and relationships; it does **not** convert deployed on-chain receipts. Deploy v2 separately after reviewing upgrade authority. Existing v1 funds, if any, need their original compatible client/program and settlement plan; never replace a funded v1 program with v2 blindly. No mainnet deployment is performed by the local build/tests.

```sh
cargo test --manifest-path programs/reward-escrow/Cargo.toml
cargo clippy --manifest-path programs/reward-escrow/Cargo.toml --all-targets -- -D warnings
npm run build:rewards
npm run test:rewards:unit
npm run test:rewards:localnet
npm run test:rewards:browser
```

Local integration tests use disposable validators, wallets and test mints. Production still requires deployment, verified configuration, operational decisions and independent external review.
