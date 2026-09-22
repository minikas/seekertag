# SeekerTag — Where's my bag?

[Watch/download the vertical promo](https://github.com/minikas/seekertag/releases/download/v1.0.0-clock-in/seekertag-promo-en-vertical.mp4) · [English text captions](seekertag-promo-en-vertical.srt) · [Full walkthrough](../README.md)

**19.8 seconds · 1080×1920 · 30 fps. Music and sound effects; no voiceover.** The promotional cut follows a backpack forgotten in a cafe, an incoming report, two people arranging the return, and the SKR reward. English text carries the story when watched without sound.

| Time | Beat |
| --- | --- |
| 0–2.4 | “Where's my bag?” — an illustrative cafe photograph |
| 2.4–5.4 | “One scan.” — the real Travel Backpack QR |
| 5.4–9.0 | “I found your backpack.” — current Home, notification badge and inbox |
| 9.0–12.6 | “I can meet you there.” — real owner/finder chat, including a send action |
| 12.6–16.2 | “Bag back. Reward paid.” — the actual confirmed return |
| 16.2–19.8 | “Lost. Found. Rewarded.” — SeekerTag and website |

The app recordings come from the same Travel Backpack return documented in the [recording evidence](../README.md#recording-evidence): 1 test SKR reserved, 0.95 to the finder and 0.05 service fee. The video labels the reward as a devnet demonstration. The opening photograph was generated as an illustration, not recorded evidence of a physical handover. No physical NFC write is shown or claimed.

## Reproduce

Requires Node.js 22+, Python 3 with Pillow, and FFmpeg. Media and audio are bundled; no cloud account is needed to render.

```sh
# From presentation/video/promo
npm ci
python3 author-promo.py
npm run check
npm run render -- --quality delivery --fps 30 --video-frame-format png --low-memory-mode --strict --output ../renders/seekertag-promo-en-vertical.mp4
python3 ../validate-video.py ../renders/seekertag-promo-en-vertical.mp4 --timing timing.json --qa-dir ../qa/promo
```

HyperFrames **0.8.59** remains pinned. `author-promo.py` generates six story scenes and a transition layer. Two cyan wipes mark the move into the app and the closing brand; the other cuts preserve reading time and device placement. Phone frames, weighted typography, transition masks and touch indicators adapt the upstream `device-frame-stage`, `caption-kinetic-slam`, `directional-wipe` and `touch-indicator` components. The actual app pixels keep their original colors. There are no editorial zooms or duplicated UI crops.

The bell, notification row and send-button indicators follow recorded coordinates from `../motion.json`. Audio events are listed in `audio-timing.json`. The original 100 BPM instrumental uses swung percussion, syncopated bass and electric-piano-style chords. `author-audio.py` regenerates it and assembles the frozen HyperFrames notification, click, chime and whoosh sources; it requires `numpy`, `scipy` and `soundfile`. The master group adds 3 dB, and the score ends within the 19.8-second timeline.

[ASSETS.md](ASSETS.md) records source files, licenses and the exact opening-image prompt. Rive was suggested during this revision, but no Rive MCP tools or plugin were available in the session; this edit uses HyperFrames/GSAP. The previous promo narration, carve data and unused clips were removed from this current project. The full walkthrough remains available independently.

Generated renders, snapshots and motion audits stay in the ignored parent directories. The GitHub release includes the MP4 and SRT, covered by `SHA256SUMS.txt`.

## Validation of the current cut

HyperFrames check passed with zero errors or warnings, nine layout samples and 24/24 contrast checks. The final H.264/AAC MP4 decodes fully: 594 frames, 1080×1920, 19.8 seconds. Scene midpoints, both wipes, message/send presses and the final frame were inspected. All source intervals fit and all five app clips match the canonical recordings. Audio measures −17.8 LUFS integrated with a −1.3 dBFS true peak.

The animation map was reviewed at the actual 1080×1920 canvas size. Its offscreen/collision flags are confined to the two intentional covering wipes; fast flags identify those wipes and brief press releases. Reading holds keep the native app video playing. The JPEG QA extractor now converts its color matrix explicitly, preserving the video's cyan in ordinary image viewers. The unchanged 2:46 walkthrough also passes the validator.

SHA-256: `9afce94bac3ad8cf528ce8f2c59abe1c5d6b6a2f172391c4da5ad945bf324b9c` · 2,802,714 bytes.
