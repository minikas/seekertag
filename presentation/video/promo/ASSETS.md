# Asset provenance

App footage comes from the canonical September 20, 2026 Seeker/QEMU recordings in `../edit/assets`. App states and transaction confirmations were not generated or recreated.

| Asset | Source and use |
| --- | --- |
| `chat-owner-send.mp4` | Owner reply; source 3.8–7.4s |
| `chat-owner-receive.mp4` | Owner conversation; source 5.9–9.5s |
| `chat-finder-send.mp4` | Finder typing and sending; source 3.5–7.1s |
| `reward-paid.mp4` | Same confirmed return; source 0.75–4.35s |
| `backpack-cafe.png` | Original illustrative photo created with the built-in image-generation tool. It is not evidence of a real physical handover. Prompt below. |
| `logo.svg` | SeekerTag website's `apps/landing/public/favicon.svg` |
| `gsap.min.js` | Existing local runtime from `../edit/assets/gsap.min.js`; trailing comment whitespace removed |
| `Arimo.ttf`, `ArchivoBlack.ttf` | [Google Fonts](https://github.com/google/fonts/tree/main/ofl), included SIL Open Font Licenses |
| `music.wav` | Original procedural instrumental by `author-audio.py`, seed 210926; no external music samples |
| `sfx-*.mp3` | HyperFrames media-use skill's bundled `notification`, `click-soft`, `chime` and `whoosh-short` sounds |
| `sound-design.wav` | Timed assembly of those frozen SFX; offsets in `audio-timing.json` |

The four app recordings match their canonical clips byte for byte and play at real time. The phone frames preserve the entire screen. Press indicators use recorded coordinates and source timestamps from `../motion.json`. The generated image is saved in the project at `assets/backpack-cafe.png`; app screens are genuine recordings; the camera scan and wallet/coin motion are illustrative Rive scenes.

## Opening-image prompt

Mode: built-in image generation. No reference image was supplied. The original output is copied into the project without raster edits; HTML displays it as the opening plate.

> Use case: ads-marketing. Asset type: opening photographic plate for a vertical 9:16 SeekerTag lost-and-found app commercial. Create one high-end editorial photograph, portrait 1080x1920 or the closest portrait ratio. A single charcoal black fabric everyday travel backpack is left unattended on a simple brushed chrome cafe chair, an espresso cup sits on the edge of a small round cafe table nearby. No people. Close, tangible, authentic slightly imperfect nylon fabric and zippers, warm late afternoon side lighting and soft contact shadows. The backpack is clearly the hero in the middle to lower-middle of the frame, centered around 60% down, occupying about 55% width and 42% height. Background is a very pale mint ivory wall, almost flat, with abundant clean empty space in the upper third for large black typographic overlay, and some breathing room below. Composition feels contemporary, witty, premium real-world brand advertising, not generic corporate stock, not an illustration, no screens, no text, no symbols, no watermark, no logo, no QR, no NFC tag, no artificial glow or gradients. Restrained color: charcoal, natural silver, pale mint ivory, gentle warm daylight. Subject sharp, background softly focused; editorial still-life shot with a 50mm lens.

## Rive sources

- `rive/bag-scan.riv` / `.scene.json`: attached QR, camera-phone entry, one scan, recognition, matched phone handoff. `author-rive.mjs` composes the existing photo with vector tag hardware; no raster image editing is used.
- `rive/finder-reward.riv` / `.scene.json`: three stylized SKR coins arc into a wallet; the readable total is **0.95 test SKR**, representing the existing confirmed devnet payment.
- `rive/qr.json`: QR matrix reconstructed from the URL independently decoded from `../edit/assets/unique-qr.mp4`: `https://api-seeker.viralizai.co/found/UZyz7_JaSuLG0BMu`. This API host is the tag's existing finder route; the promotional video remains hosted on GitHub.
- `assets/skr.svg`: unchanged current-app SKR mark. `rive/skr-shapes.json` is its vector conversion via `riv_import_svg`.
- `assets/chat-owner-send.mp4`: unchanged `../edit/assets/chat-owner-send.mp4`, 3.8–7.4s. The exact recorded send is at source 5.569s.
- `rive/tokens.json`: motion/layout tokens from `riv_design_tokens`; the approved SeekerTag palette overrides the suggested alternate colors.
- Community MCP: [ODU33104/rive-mcp](https://github.com/ODU33104/rive-mcp), pinned npm `rive-mcp-server@0.6.1`. Calls: design tokens, SVG import, create, lint and two critique passes. Rendering uses its official `@rive-app/canvas-advanced` runtime with deterministic frame stepping, then FFmpeg.
- Rive skill: [rive-design-guidelines](https://github.com/ODU33104/rive-mcp/blob/main/skills/rive-design-guidelines/SKILL.md), read before authoring. The [official Rive desktop MCP](https://rive.app/docs/editor/ai/mcp) requires an open desktop editor at `127.0.0.1:9791`; none was present here. The server used is community-maintained, not the official desktop MCP.

Intermediate `assets/bag-scan.mp4` and `assets/finder-reward.mp4` are regenerated and ignored by Git. Actual `.riv` files and their editable author/source remain tracked. Full frame PNG sequences, critique images and motion reports live in ignored `../qa/`.

The community tool is used under its [Freeware License](https://github.com/ODU33104/rive-mcp/blob/main/LICENSE), which permits distribution of generated `.riv` assets. Its implementation is an npm development dependency and is not vendored into this repository.
