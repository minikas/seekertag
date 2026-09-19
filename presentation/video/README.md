# SeekerTag app demo

[Watch the demo](https://api-seeker.viralizai.co/demo/seekertag-seeker-demo-en.mp4) · [Download MP4](https://github.com/minikas/seekertag/releases/download/v1.0.0-clock-in/seekertag-seeker-demo-en.mp4) · [English SRT](seekertag-seeker-demo-en.srt) · [English WebVTT](seekertag-seeker-demo-en.vtt)

[![Watch the SeekerTag app demo](preview.jpg)](https://api-seeker.viralizai.co/demo/seekertag-seeker-demo-en.mp4)

An actual app walkthrough for the Solana hackathon, with English narration and burned-in captions. The final release is 2:40, 1920×1080 at 30 fps, H.264 video and AAC audio.

| Time | Demonstration |
| --- | --- |
| 0:00 | Seeker sign-in and Seed Vault wallet approval |
| 0:20 | Item creation, private note, public message, 0.01 SOL reward and deposit |
| 0:55 | QR code, printable PDF preview and NFC writing screen |
| 1:18 | Finder report and live owner–finder conversation in separate Android sessions |
| 1:49 | Receiving-wallet verification, return confirmation and payout approval |
| 2:23 | Reward paid and completed return on both sides |

## Edit and render

This is the standalone source project for the final edit. It includes all 31 trimmed screen recordings, the complete narration, six HyperFrames scenes, timing and captions. Earlier drafts and raw production intermediates are not required.

Requires Node.js 22+, FFmpeg/ffprobe and Python 3. HyperFrames is pinned to **0.8.49** in `edit/package.json`. The frozen narration was generated with Kokoro's `af_heart` English voice. The phone frame and focus motion adapt the upstream [HyperFrames](https://github.com/heygen-com/hyperframes) `device-frame-stage`, `ui-focus-zoom` and `coordinate-target-zoom` patterns.

From this directory:

```sh
python3 author-edit.py
mkdir -p renders
cd edit
npm run check
PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=300 npm run render -- --quality delivery --fps 30 --video-frame-format png --low-memory-mode --strict --output ../renders/seekertag-seeker-demo-en.mp4
```

`cuts.json` maps each clip ID to `edit/assets/<id>.mp4`; start times are relative to its scene. `edit-timing.json` holds chapter and caption timing. `author-edit.py` regenerates the composition HTML and storyboard. Update the SRT/VTT files alongside caption edits. `edit/BRIEF.md` and `edit/design.md` describe the visual direction.

The release MP4 is the approved master. A full render recreates the edit from the included media, but may differ at the encoding level because the release preserves previously encoded footage outside the wallet verification insert.

To validate a downloaded or rendered MP4, install Pillow in your Python environment and run:

```sh
python3 validate-video.py renders/seekertag-seeker-demo-en.mp4
```

The validator checks codecs, resolution, duration, all 4,800 video frames and full decoding, then writes review frames and contact sheets to `qa/`. Generated output and preview caches are ignored by Git.

## Recording evidence

The owner flow was recorded on a physical Solana Seeker; the finder chat uses a separate Android emulator session. The QR and PDF are real app output. The NFC scene shows the writing screen; no physical NFC tag was written. The handoff is a demonstration, and the reward transactions use devnet test SOL.

The original 0.01 SOL reward for tag `uHSgieUJDQAQwpe3` was deposited and released on devnet. The finder received 0.0095 SOL, with a 0.0005 SOL service fee. See the [reserved reward](evidence/public-tag-reserved.json), [released reward](evidence/public-tag-released.json) and [finalized payout](evidence/payout-finalized.json), including its Solana Explorer link.

The Seed Vault **Testuser** shot is a separately labeled receiving-wallet verification retake for tag `9qcHZq2arNbx9vmv`. The user confirmed biometrics on the physical Seeker and the API verified wallet `8E5uestVQxEXGqZryCyMzQhcdPannurf2CpEqBtkkajU`. That message signature proves address ownership and does not authorize a transfer. Testuser is not the recipient of the original payout. See the [verification record](evidence/seed-vault-testuser.json) and [confirmed receiving wallet](evidence/testuser-receiving-wallet-confirmed.png).

## Published master

The MP4 is distributed through the linked GitHub release and public playback URL. The repository keeps the editable source assets; the generated MP4 is excluded from Git.

- Size: 25,402,344 bytes
- SHA-256: `59e9650b6ae9a84a49621cfed27440a262df17068fc6ef1710ad114d7acf9e54`

The release's `SHA256SUMS.txt` also covers the subtitles, current pitch PDF and Android APK.
