# Independent contract security review — SeekerTag escrow v1

> Registro anterior ao compromisso v2. O comportamento atual e as verificações estão no [relatório v2](skr-commitment-review.md); consulte também o [ABI atual](skr-protocol.md). Artefatos de teste podem ter sido atualizados pela execução v2.

Reviewed September 16, 2026. This review was performed by an agent that did not write the escrow contract; the same reviewer implemented the application wallet interface. This is an independent source review within this development task, not an external audit, certification, or authorization to use real funds.

Scope: `programs/reward-escrow/src/lib.rs`, `shared/reward-protocol.mjs`, their ABI and the planned local-validator attack suite. No mainnet program or upgrade authority was inspected. Source hashes at review:

```text
lib.rs: e5d1c85ad69f26b18bfd0a0488bef6c6535bd027fd95ef6f7dfdb4ccd987fa2e
reward-protocol.mjs: 75a5a0ed93013e80727d3d90050341f8bb37c798c43b26f3dc81278a89b36829
```

No third-party theft, missing-owner-signature, substituted-vault, or receipt-reinitialization path was identified in the reviewed source. This conclusion is limited by the review scope and does not replace execution of the compiled program or deployment verification.

## Material findings and limitations

| Finding | Severity / scope | Result |
| --- | --- | --- |
| The funding owner can release to their own or another controlled wallet before expiry. | Material economic limitation; high impact if represented as an unconditional lock until expiry. | Disclosed design limitation, retained by the owner-authorized MVP. |
| Upgrade authority can change the behavior of a deployed upgradeable program. | Deployment-critical trust assumption; no live deployment inspected. | Program ID pinning alone is insufficient evidence of immutable custody rules. |
| Account rent and excess token donations remain in retained accounts. | Low financial/operational limitation. | Intentional v1 behavior, disclosed in funding UI and ABI. |
| An out-of-app owner release can use a report reference unknown to the API. | Operational limitation affecting the owner's own record. | API must report unavailable/unknown payment rather than invent a verified conversation payout. |

### Owner-directed release is not a guaranteed finder payment

`settle` at `lib.rs:420` accepts any nonzero recipient and report reference after checking the original owner's signature. It does not verify finder proof, a recipient signature, a server attestation, or physical return. The refund instruction checks expiry, but the owner can economically recover the tokens earlier by using release with their own associated token account, or a different wallet they control.

Reproduction: fund a reward with future expiry, create the owner's canonical token account if needed, then invoke `releaseRewardInstruction` with `recipient=owner` and an arbitrary nonzero 32-byte report reference. The expected result is a paid receipt and the original amount returned to the owner's account before expiry. This is an authorized owner operation, not a signer bypass. Blocking equality between owner and recipient would not address another wallet controlled by the same person.

The selected product model is retained: the deposit proves the quantity present at the most recent verified observation; the owner controls release. Current application copy explicitly says that owner-authorized payments can occur before expiry and that the contract does not verify physical return or guarantee the finder's payment. Finder verification is an application rule, not an on-chain claim about identity. A stronger guarantee would require a different dispute/authorization model and still must account for collusion.

### Deployment trust is separate from source correctness

The program has no explicit administrator withdrawal instruction. If deployed with an active upgrade authority, that authority can replace the code under the same program ID. Before production, verify the deployed binary against the reviewed source and record the authority policy. Making the program immutable or securing upgrades through an explicitly accepted governance policy is a separate release decision. This review did not change deployment authority or deploy to mainnet. See the official [Solana deployment documentation](https://solana.com/docs/programs/deploying).

### Retained accounts and outside transfers

Persistent receipt ownership prevents reuse; the token vault remains open after payment/refund. Settlement transfers the recorded amount only, so extra tokens do not prevent settlement. The cost is permanently retained rent and no excess-token recovery path in v1. Do not manually transfer additional tokens to the vault. Source references: `allocate_pda` at `lib.rs:243`, `settle` at `lib.rs:409` and `lib.rs:449`.

A valid direct owner release with an arbitrary reference can be unknown to the application's intent history. Current API reconciliation fails closed for this case. This protects the public funding statement but can require manual support for an owner who bypassed the application.

## Invariants inspected

| Area | Source-level assessment |
| --- | --- |
| Funding authority | Create requires the owner signer; source must be the canonical ATA owned by that owner. Settlement and renewal match that signer to the persistent receipt. |
| Account substitution | Receipt owner, discriminator, version, canonical seeds/bump and lifecycle status are checked. Vault address/bump, token-program ownership, mint and token authority are checked before transfer. |
| CPI privileges | Only exact executable System and legacy SPL Token program IDs are invoked. The vault has no delegate or separate close authority. PDA authority is derived from the original owner's receipt; no arbitrary CPI target is accepted. |
| Mint hazards | Native SOL wrapper, uninitialized mint/account state, frozen accounts, and mints with freeze authority are rejected. Token-2022 hooks/extensions are outside the accepted program. App configuration must separately enforce official SKR and 6 decimals. |
| Reinitialization | Create requires system-owned empty accounts. Existing program-owned receipts cannot be recreated; paid/refunded receipts reject further lifecycle operations. |
| Address squatting | Unsolicited SOL in empty system-owned PDA accounts is accounted for using a rent top-up, signed allocate, and assign. A third party cannot sign for the canonical PDA. |
| Amount precision | Rust uses positive `u64` base units; transfers use `transfer_checked`. SDK rejects floating-point inputs and values outside u64. No amount arithmetic is used during settlement. |
| Time and renewal | Create/renew require future expiry within checked 365-day horizon; renewal strictly extends the previous deadline. Release is permitted strictly before expiry; refund is permitted at or after expiry. |
| Race behavior | Shared writable receipt/vault accounts and terminal status checks should serialize settlement; any failing transaction rolls back. Renewal and refund on the same expired receipt cannot both succeed. |
| Donations | Additional vault balance is allowed; exactly the recorded amount is transferred. Settlement does not attempt to close the vault. |
| Privacy | Reward/report references are opaque bytes; names, contact details, tokens and public QR codes are unnecessary on-chain. Wallets and amounts remain public. |

PDA signing and atomic transaction behavior were checked against the official [PDA documentation](https://solana.com/docs/core/pda) and [transaction documentation](https://solana.com/docs/core/transactions). These are runtime assumptions supporting the source analysis, not test results for this binary.

## Execution evidence and next validation

This reviewer ran the application's TypeScript check and eight client transaction-validation tests successfully. These tests reject hidden SOL transfers, amount changes, substituted wallet/mint/program/receipt, recipient/report-reference substitution, invalid renewals and network/pin downgrades before a wallet signature request. They are client tests, not contract execution evidence.

The coordinator owns compiled SBF and real local-validator execution in `tests/rewards/escrow.localnet.test.mjs`. That execution was pending during this source review. Coordinator addendum: the completed local suite passed 19 results, including the API lifecycle and independent adversarial tests. The [final delivery review](skr-delivery-review.md) records execution scope and remaining limits. The suite includes token movements, settlement replay, incorrect authority/program/vault/destination, SOL/token donation, expired release/refund, renewal after expiry, and refund-versus-renewal races.

Additional concrete adversarial cases recommended to the coordinator:

- Remove the funding owner's signer privilege entirely; distinguish this from signing with a different key.
- Substitute a different mint, an otherwise valid noncanonical source/destination account, and duplicate incompatible account roles.
- Use a freeze-authority mint; attempt zero amount, amount above available source balance, invalid instruction length/account count, and expiry above the 365-day horizon. Assert full rollback and no stranded initialized receipt.
- Submit two separately signed release transactions concurrently, including different recipients; exactly one may transfer the recorded amount.
- Exercise exact expiry equality and integer/time boundaries using a controllable SVM clock where feasible.
- Demonstrate the owner self-release behavior above and keep it classified as a disclosed model limitation, not a test failure to hide.

Production readiness additionally requires deployed-binary/authority review and physical Android wallet validation; browser simulation cannot establish those properties.
