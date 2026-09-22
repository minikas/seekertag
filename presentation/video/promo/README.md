# SeekerTag — Where's my bag?

[Watch/download the vertical promo](https://github.com/minikas/seekertag/releases/download/v1.0.0-clock-in/seekertag-promo-en-vertical.mp4) · [English captions](seekertag-promo-en-vertical.srt) · [Full walkthrough](../README.md)

**19.8 seconds · 1080×1920 · 30 fps. Music and sound effects; no voiceover.** A QR hangs from the forgotten backpack. An illustrated phone scans it, the real app conversation opens, the two people agree to meet by the café entrance, and SKR coins enter the finder's wallet alongside the actual devnet confirmation.

| Time | Beat |
| --- | --- |
| 0–2.4 | “Where's my bag?” — café photograph with the actual tag QR attached |
| 2.4–5.4 | “Scan. Say hello.” — Rive camera-phone animation scans that QR |
| 5.4–9.0 | “I found your backpack.” — real private conversation and owner reply |
| 9.0–12.6 | “Meet at the café.” — two phones, finder sends “I will wait by the entrance” |
| 12.6–16.2 | “Bag back. SKR received.” — animated coins enter the wallet; actual return confirmation |
| 16.2–19.8 | “Lost. Found. Rewarded.” — SeekerTag and website |

The four app recordings come from the same Travel Backpack return documented in the [recording evidence](../README.md#recording-evidence): 1 test SKR reserved, 0.95 to the finder and 0.05 service fee. The animation represents that **one** payment. The video labels it as a devnet demonstration. The café photo, scan and wallet are illustrations; they are not recorded evidence of a physical handover or a new transaction.

## Rive authoring

`author-rive.mjs` creates genuine `.riv` files through the [community Rive MCP](https://github.com/ODU33104/rive-mcp), pinned to `rive-mcp-server@0.6.1`. The official Rive Canvas Advanced runtime renders exact frames. Editable files, scene specs, QR matrix, imported SKR vectors and motion tokens live in `rive/`.

The [official Rive desktop MCP](https://rive.app/docs/editor/ai/mcp) requires an open desktop editor. No editor or listener was present at `127.0.0.1:9791`, so this project uses the independent community MCP, not the official desktop MCP. Its [rive-design-guidelines skill](https://github.com/ODU33104/rive-mcp/blob/main/skills/rive-design-guidelines/SKILL.md) guided the token/import/create/critique workflow.

The bag and camera QR encode the real Travel Backpack finder URL, independently decoded from the canonical recording. Both are vector-generated from the saved matrix. The photo is unchanged; Rive composes the label and device over it. The current app's SKR SVG supplies the coin artwork.

## Reproduce

Requires Node.js 22+, Chromium, Python 3 with Pillow, and FFmpeg. No Rive account or desktop editor is needed.

```sh
# From presentation/video/promo
npm ci
# Point this at your installed Chromium/Chrome executable.
export RIVE_MCP_CHROME="/absolute/path/to/chromium"
node author-rive.mjs --render
python3 author-promo.py
npm run check
npm run render -- --quality delivery --fps 30 --video-frame-format png --low-memory-mode --strict --output ../renders/seekertag-promo-en-vertical.mp4
python3 ../validate-video.py ../renders/seekertag-promo-en-vertical.mp4 --timing timing.json --qa-dir ../qa/promo
```

`--only-reward` rebuilds only the reward Rive scene. Intermediate `assets/bag-scan.mp4` and `assets/finder-reward.mp4` are ignored; the rebuild above creates them. Full-frame PNGs, critique sheets, snapshots and renders also remain outside Git. Fonts, source footage, photo and sound files are bundled.

HyperFrames **0.8.59** assembles six scenes. The first two share continuous Rive footage; the camera phone moves into the position of the real chat phone. One cyan wipe introduces the closing brand. Whole Android screens remain visible, with no editorial zooms or duplicated UI crops. The owner/finder send indicators match recorded coordinates at source 5.569s and 4.92s respectively.

`author-audio.py` regenerates the original 100 BPM instrumental and timed SFX using `numpy`, `scipy`, `soundfile` and FFmpeg. Scan recognition, incoming chat, both sends and reward receipt have synchronized accents. [ASSETS.md](ASSETS.md) records the media provenance and original image prompt.

## Validation

HyperFrames check: zero errors or warnings, nine layout samples, 23/23 contrast checks. The unchanged full walkthrough also passes its required check, with its existing four timeline-density advisories. Rive scenes were inspected in two critique passes, including scan alignment, arced/staggered coin motion and settled states. The QR on the bag decodes to the correct tag at 0, 3.4 and 4.5 seconds.

The community Rive linter reports one false asset-reference error for `camera-photo`: it compares global asset ID 2 with a count of images alone. The file's global asset table is FontAsset 0, ImageAsset 1 and ImageAsset 2; both references were independently checked and both images render correctly in the official runtime. Its two size warnings concern the intentionally embedded full-resolution photo. The reward has no lint errors or warnings; the generic stagger notice counts initial invisible keyframes, while its actual coin arrivals are staggered by six frames.

The GSAP animation map covers editorial text, presses and the closing wipe; Rive and native app motion are reviewed in their rendered footage. The map's apparent holds during scan/reward are not frozen video.

Final MP4: H.264/AAC, 594 frames, 19.8 seconds, 1080×1920, complete decode without errors. Audio: −17.9 LUFS integrated, −1.3 dBFS true peak. Exact cut-adjacent frames, scan recognition, both sends, token arrival and the last frame were inspected.

SHA-256: `2e8f7912d9298d26f30b5587ba8d03a86b04154b767c346bfb7998ab66afbade` · 4,254,395 bytes.
