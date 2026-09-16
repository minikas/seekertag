# SKR rewards implementation contract

> Registro anterior ao compromisso v2. O comportamento atual e as verificações estão no [relatório v2](skr-commitment-review.md); consulte também o [ABI atual](skr-protocol.md). Artefatos de teste podem ter sido atualizados pela execução v2.

Status: implemented locally, not deployed. Repository: SeekerTag. Execution evidence and remaining limits are recorded in [the delivery review](skr-delivery-review.md). No mainnet deployment or real-fund transaction is part of local development.

## Agreed product behavior

- Rewards are optional. Existing QR/NFC URLs remain unchanged and identify the item, independently of reward escrow accounts.
- An owner funds a fixed SPL-token reward in a program-controlled vault. Production uses the official SKR mint `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` (6 decimals, legacy SPL Token program, verified on mainnet September 16, 2026).
- Only the funding wallet can authorize release to the verified wallet of the finder selected in the conversation. Scanning a public QR never authorizes payout.
- The refund instruction is unavailable before expiry. After expiry, the funding wallet can refund or renew if the reward has not been paid/refunded. Renewal strictly increases expiry; it does not change the amount or QR.
- Release requires an unexpired funded reward; an expired reward can first be renewed. Payment, refund, and renewal must be mutually consistent under transaction races. A paid/refunded receipt cannot be reused.
- Public wording distinguishes a pledge, a deposit pending confirmation, funded tokens, an expired deposit, paid, and refunded. The owner still decides whether the physical return occurred; escrow does not adjudicate disputes.
- Contact details remain private; blockchain addresses and transfers are public. Finder wallet is optional for chat, required for the SKR payout. SOL covers network fees.
- Use integer base units, never floating-point arithmetic for on-chain token amounts. Test networks must explicitly identify the asset as a test token, never real SKR.

## Security limit of the agreed owner-authorized model

An owner can invoke release directly, outside the application, to any wallet they control with an arbitrary nonzero report reference. Off-chain wallet proof and conversation selection are enforced by the application, not by the program. Refusing a literal owner==recipient payment would not prevent an alternate-key/Sybil payment. Consequently v1 does **not** promise unconditional lock-until-expiry, honest physical-return confirmation, or guaranteed payment to a finder. Its guarantee is verifiable deposited balance and an on-chain record of owner-authorized settlement. There is no server custody key and no third-party arbitration authority. The UI must disclose owner control and avoid stronger guarantees. A direct payout outside a verified application intent must not be misattributed to a conversation by the API.

Receipt/vault accounts are retained; their SOL rent deposits are not reclaimed by v1. Tokens sent to the vault outside the prescribed exact deposit are unsolicited donations and not recoverable by v1. Wallet previews disclose network/account creation costs separately from the reward.

## Ownership for parallel work

- Contract implementer: `programs/`, `shared/reward-protocol.*`, protocol documentation and contract tests. Publish the ABI/export names immediately for API and integration work.
- API implementer: `server/` reward module, routes, migrations, authentication/signature verification, lifecycle guards and API tests. Own `server/package*.json` only if dependencies are required.
- Application implementer: `src/` reward UI, native/web wallet signing adapters, component integration and relevant UI tests. Do not edit package manifests.
- Coordinator: root dependency manifests, build/test tooling, deployment documentation, end-to-end integration, final verification and reconciliation.

## API boundary to implement

All new endpoints return JSON and use existing bearer authorization. No bearer credentials, contact details or internal database identifiers are written to the chain. Existing envelopes remain intact; add reward endpoints instead of changing public tag key sets.

- `GET /api/rewards/config`: `{ enabled, cluster, assetLabel, mint, programId, reason? }`. No private RPC credentials or service keys. Disabled unless explicitly configured.
- `GET /api/tags/:id/reward`: owner view `{ reward }`.
- `GET /api/public/tags/:code/reward`: public funding proof `{ reward }` (no personal data).
- `GET /api/reports/:id/reward` and `GET /api/finder/reports/:id/reward`: authenticated conversation view `{ reward, recipient? }`.
- `POST /api/tags/:id/reward/prepare`: `{ wallet, amount, days }`, amount is a decimal string. Return `{ reward, transaction, wallet, action, lastValidBlockHeight }`. Transaction is unsigned base64. Retrying must not create duplicate deposits.
- `POST /api/tags/:id/reward/renew`: `{ wallet, days }`, return a prepared transaction. Extend from `max(now, previousExpiry)`.
- `POST /api/tags/:id/reward/refund`: `{ wallet }`, return a prepared transaction; enforce expiry on-chain too.
- `POST /api/reports/:id/reward/release`: `{ wallet }`, prepare release to the wallet verified by this finder. Store an opaque per-report reference in the receipt to reconcile concurrent report selections.
- `POST /api/finder/reports/:id/reward/wallet/challenge`: `{ wallet }`, return `{ message, nonce }`.
- `POST /api/finder/reports/:id/reward/wallet/verify`: `{ wallet, nonce, signature }` with base64 detached Ed25519 signature. Single-use, short-lived, domain/report/wallet-bound challenges; no changes to recipient during an active release intent.
- `POST /api/tags/:id/reward/sync` and owner/finder report reward sync endpoints: verify chain state and optional transaction signature; tag sync returns `{ reward }`, report sync includes `{ reward, recipient, canResolve }`. Submitted signatures or client status must never mark a reward funded/paid without chain verification.

Reward view shared with UI: `{ id, status, amount, assetLabel, cluster, wallet, expiresAt, address, explorerUrl, recipientWallet?, transactionSignature? }`. `amount` is a decimal string, `expiresAt` is ISO 8601, status is `draft | funded | expired | paid | refunded | unavailable`. Add fields only if coordinated. `unavailable` means verification failed and must never claim currently verified funds.

## Integrity requirements

- Validate the configured RPC network and executable program, the mint/token program/decimals, account owners, canonical PDA and vault, funding wallet, exact amount, and receipt reference.
- Persist preparations before signing; retain enough information to recover after timeout/restart. Never blindly retry a different transaction after an ambiguous result. Reconcile against the receipt first.
- Owner/finder authorization and recipient proofs are separate. A copied wallet address is not proof of control. Wallet signatures never authorize a different conversation or nonce.
- Pending/live rewards must prevent tag transfer and reward edits that could misrepresent the deposit. Resolve-with-reward waits for verified payment to the selected report; refund/reward history remains consistent.
- RPC failures fail closed, without falsely labeling a reward as guaranteed or silently allowing protected lifecycle changes. No arbitrary client-supplied RPC URLs.
- Retain contract receipt accounts to prevent replay. Avoid closing the token vault in a way that unsolicited token donations can block settlement.

## Validation

Compile the actual Solana program and exercise real token movement on a local validator or SVM. Cover foreign signers, substituted accounts/mints/vaults, repeated release/refund, early refund, expiry boundaries, shortening renewal, donation griefing, overflow, and renewal/settlement races. API tests must exercise authorization, replay protection, timeout recovery, wrong-network configuration and lifecycle guards. Browser checks exercise the UI with the actual backend. Distinguish simulator validation from physical Android wallet testing.

## Sources

- https://solanamobile.com/blog/skr-is-live
- https://solana.com/docs/core/pda
- https://solana.com/docs/payments/advanced-payments/spend-permissions
- https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly
- https://docs.expo.dev/versions/v57.0.0/
