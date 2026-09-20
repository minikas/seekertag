# SeekerTag app demo

[Watch the demo](https://github.com/minikas/seekertag/releases/download/v1.0.0-clock-in/seekertag-seeker-demo-en.mp4) · [GitHub release](https://github.com/minikas/seekertag/releases/tag/v1.0.0-clock-in) · [English SRT](seekertag-seeker-demo-en.srt) · [English WebVTT](seekertag-seeker-demo-en.vtt)

[![Watch the SeekerTag app demo](preview.jpg)](https://github.com/minikas/seekertag/releases/download/v1.0.0-clock-in/seekertag-seeker-demo-en.mp4)

A walkthrough of the updated application for the Solana hackathon, recorded on September 20, 2026, with English narration and burned-in captions. The release is 2:46, 1920×1080 at 30 fps, H.264 video and AAC audio.

| Time | Demonstration |
| --- | --- |
| 0:00 | Continue with Seeker, wallet selection and Seed Vault sign-in |
| 0:18 | Item name/category, private note, public message, 1 SKR reward, seven-day reservation and real deposit |
| 0:55 | Unique QR, matching printable PDF, NFC writing screen and marking the item lost |
| 1:20 | Finder report, Seeker notification and live conversation on two Android devices |
| 1:56 | Receiving-address entry/review, Finish return from the owner conversation, payout review and signature |
| 2:30 | Reward paid and completed return on both devices |

## Edit and render

This standalone source includes all 35 trimmed screen recordings, the complete narration, six HyperFrames scenes, timing, touch markers and captions. Raw recordings and temporary production files are not needed to render it.

Requires Node.js 22+, FFmpeg/ffprobe and Python 3. HyperFrames was upgraded from **0.8.49 to 0.8.56**, which is pinned in `edit/package.json`. Narration uses Kokoro's `af_heart` English voice. The phone frame and brief press indicators adapt the upstream [HyperFrames](https://github.com/heygen-com/hyperframes) `device-frame-stage` and `touch-indicator` patterns. The entire phone stays visible, with no editorial zooms or duplicated enlargement. Native sheets, keyboards and scrolling provide the movement.

From this directory:

```sh
python3 author-edit.py
mkdir -p renders
cd edit
npm run check
PRODUCER_STREAMING_ENCODE_MAX_DURATION_SECONDS=300 npm run render -- --quality delivery --fps 30 --video-frame-format png --low-memory-mode --strict --output ../renders/seekertag-seeker-demo-en.mp4
```

`cuts.json` maps each clip to `edit/assets/<id>.mp4`, with scene-relative timing and source interval metadata. `edit-timing.json` defines chapters and captions. `motion.json` records the screen coordinates and timing of actual taps. `author-edit.py` regenerates HTML, storyboard, SRT and WebVTT from those files. The narration is frozen locally in `edit/assets/narration.wav`; update it alongside any spoken-text changes. `edit/BRIEF.md` and `edit/design.md` describe the visual direction.

The release is a full render of this source. Secure biometric screens and long authorization waits are cut out; transaction outcomes come from the real application recordings.

To validate a downloaded or rendered MP4, install Pillow in your Python environment and run:

```sh
python3 validate-video.py renders/seekertag-seeker-demo-en.mp4
```

The validator checks complete scene coverage, codecs, resolution, duration, all 4,980 video frames and full decoding, then writes review frames and contact sheets to `qa/`. Generated output and preview caches are ignored by Git.

## Recording evidence

Both devices ran the APK built from [324e120](https://github.com/minikas/seekertag/commit/324e1205d20875d3e9f04e57034062e9d5312ab6). The owner uses a physical Solana Seeker and the finder a separate QEMU Android session. The finder enters and reviews Testuser's receiving address; connecting a finder wallet is optional in this version. The owner signs the payout in Seed Vault. The NFC scene shows the writing screen; no physical NFC tag was written. The handover is simulated and the reward uses devnet test SKR, with native SOL for network fees.

One coherent **Travel Backpack** item (`UZyz7_JaSuLG0BMu`) is shown from creation through return. Its 1 test SKR reward was reserved for seven days, then released to Testuser (`8E5uestVQxEXGqZryCyMzQhcdPannurf2CpEqBtkkajU`). The finalized transaction transferred **0.95 test SKR** to the finder and **0.05 test SKR** to the treasury, emptying the escrow token account.

See the [reserved reward](evidence/public-tag-reserved.json), [released reward](evidence/public-tag-released.json), [finalized payout and token balance changes](evidence/payout-finalized.json), and [matching exported label PDF](evidence/Travel-Backpack-label.pdf). The payout finalized in slot **501598937** and is linked to Solana Explorer in the proof file. The older SOL payout and separate wallet-verification retake have been removed from this project.

## Published master

Independent motion, video and editing reviews inspected the encoded master. Their corrections were applied and rechecked: seven-day narration timing, recipient confirmation cut, final chat delivery, shorter reservation hold and touch-marker cleanup.

The MP4 is distributed through the linked GitHub release. The repository keeps editable source assets; generated renders remain outside Git. The release's `SHA256SUMS.txt` covers the video, both subtitle files, current pitch PDF and Android APK.

- Size: 13,228,110 bytes
- SHA-256: `fda98a94b70538dd50246eb8a1a1e8bb8bc6bb011a45c6731077da8bd2c2dd3c`
