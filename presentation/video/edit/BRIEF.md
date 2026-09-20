---
workflow: general-video
flow: companion
---
# SeekerTag app demonstration

Create a 2–3-minute walkthrough for the Solana hackathon using real application recordings, with English narration and captions.

Show Seeker sign-in, Seed Vault approval, item creation, a reward deposit, QR and PDF output, the NFC writing screen, an owner–finder conversation, receiving-wallet address confirmation and a finalized devnet payout. The physical Seeker and a separate Android session represent the two participants.

Use a graphite smartphone frame and keep the full phone visible. Two phones appear together during the conversation and completed-return scenes. Keep the application's controls legible and the narration synchronized with each action.

All prepared media is local in `assets/`. `../cuts.json` and `../edit-timing.json` describe the edit; `../author-edit.py` generates the scenes. The current revision records one coherent SKR reward from deposit through payout, using the updated APK. SKR is the default reward currency; native SOL still pays Solana transaction fees. The receiving wallet uses the current address-entry flow. The NFC scene shows the writing screen without claiming a physical write. Preserve those distinctions when editing.

## Accepted revisions

Reduce repeated zooms and abrupt camera resets. Keep the full phone visible for navigation; use no editorial camera zooms in this revision. Add brief touch indicators to real recorded presses, inside the phone screen. Remove idle pauses after narration without cutting spoken words. Synchronize the amount and reservation-period shots with their respective narration. After the edit is rendered, run independent motion, video and editing reviews before replacing the GitHub release assets.

## Verified capture — September 20

The Travel Backpack recording uses the updated app on both devices (source 324e120). All 35 clips are from this capture: sign-in, creation, 1 test SKR deposit for seven days, QR, matching PDF, NFC screen, lost status, finder report, notification, two-device chat, receiving-address review, owner signature and completed return. The final edit is 166 seconds. Seed Vault's secure biometric frames and signing waits are omitted.

The payout is finalized in devnet slot 501598937: 0.95 test SKR to Testuser, 0.05 test SKR to the treasury. The evidence files identify the same tag, reward, escrow and recipient throughout. Both current completed-return screens are captured. No footage from the older SOL payout or separate wallet verification retake remains.
