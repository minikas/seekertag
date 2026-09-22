# SeekerTag — A way back

[Watch/download the vertical promo](https://github.com/minikas/seekertag/releases/download/v1.0.0-clock-in/seekertag-promo-en-vertical.mp4) · [English subtitles](seekertag-promo-en-vertical.srt) · [Full walkthrough](../README.md)

**19.8 seconds · 1080×1920 · 30 fps · English.** A separate promotional cut for Reels, Shorts and Stories, within the canonical `presentation/video` project. The full demo remains the detailed feature walkthrough.

| Time | Visual |
| --- | --- |
| 0–4.2 | Current Home, notifications icon and all navigation tabs |
| 4.2–8.4 | Travel Backpack QR, printable-label and NFC actions |
| 8.4–12.6 | Owner and finder chatting in separate Android phones |
| 12.6–16.2 | Actual reward-paid confirmation, labeled devnet/test SKR |
| 16.2–19.8 | SeekerTag, “What is yours. Back to you.” and website |

The same Travel Backpack example and finalized 1 test SKR return are documented in the [recording evidence](../README.md#recording-evidence). The promo does not show a physical NFC write. Secure wallet screens and personal authentication are not included. Feature titles are visible in the video; the optional SRT contains the complete spoken narration.

## Reproduce

Requires Node.js 22+, Python 3 with Pillow, and FFmpeg. Source media and the finished narration/music are bundled locally, so rendering requires no paid services or TTS setup.

```sh
# From presentation/video/promo
npm ci
python3 author-promo.py
npm run check
npm run render -- --quality delivery --fps 30 --video-frame-format png --low-memory-mode --strict --output ../renders/seekertag-promo-en-vertical.mp4
python3 ../validate-video.py ../renders/seekertag-promo-en-vertical.mp4 --timing timing.json --qa-dir ../qa/promo
```

HyperFrames **0.8.59** is pinned. `author-promo.py` generates five narrative scenes plus the persistent header, with the frozen music carve in `audio-mix.json`. The design adapts the upstream `device-frame-stage` and `line-by-line-slide` registry components. There are no editorial zooms or duplicated app enlargements. The static Home and QR footage run at 0.8×; chat and reward footage run at real time.

## Audio and assets

- `assets/*.mp4`: trimmed Seeker/QEMU recordings from `../edit/assets`, captured September 20, 2026. See [source provenance](ASSETS.md).
- `assets/voice-{1..5}.txt` and `.wav`: English Kokoro `af_heart`, speed 1.08 (closing line 1.12). To regenerate a line: `npx hyperframes@0.8.59 tts --text-file assets/voice-1.txt --voice af_heart --speed 1.08 --output assets/voice-1.wav`.
- `author-audio.py`: combines the lines, writes timed SRT, and synthesizes the original instrumental cue. Requires `numpy` and `soundfile`. It uses no external samples.
- `audio-mix.json`: dynamic spectral carve against the narration, with a gentle music fade. The voice has light compression and a peak ceiling for phone playback. After changing audio, rerun the installed HyperFrames audio skill's `scripts/carve.mjs --comp index.html --bed music-bed --voice narration`, then `python3 freeze-mix.py`. `@hyperframes/core` is installed for this operation.
- `assets/Arimo.ttf`: locally bundled variable font under the included SIL Open Font License. Logo comes from the SeekerTag website.

Generated renders, snapshots and QA stay in the ignored parent directories. The release includes the MP4 and SRT, covered by `SHA256SUMS.txt`.

## Validation of published cut

HyperFrames check passed with zero errors or warnings, nine layout samples and 28/28 contrast checks. The final MP4 decodes without errors: 594 frames, H.264/AAC, 19.8 seconds. Scene frames, transition frames and the final frame were inspected. Speech in the encoded mix was checked against the script with local ASR; integrated loudness is −18.4 LUFS and true peak is −2.0 dBFS. Media source ranges fit their clips, and all five app recordings match the canonical footage byte for byte.

SHA-256: `592aff05360603b796ea720b19ae94dea4f7fc607e9efe83d19c111d6bc6fdfa` · 3,749,611 bytes.
