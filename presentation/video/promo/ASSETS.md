# Asset provenance

App footage comes from the canonical September 20, 2026 Seeker/QEMU recordings in `../edit/assets`. App states and transaction confirmations were not generated or recreated.

| Asset | Source and use |
| --- | --- |
| `unique-qr.mp4` | Travel Backpack QR; source 0.2–3.2s |
| `owner-notification.mp4` | Current Home and incoming report; source 1.4–5.0s |
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

All five video files match the canonical app clips byte for byte and play at real time. The phone frames preserve the entire screen. Press indicators use recorded coordinates and source timestamps from `../motion.json`. The generated image is saved in the project at `assets/backpack-cafe.png`; the other scenes are genuine screen recordings.

## Opening-image prompt

Mode: built-in image generation. No reference image was supplied. The original output is copied into the project without raster edits; HTML displays it as the opening plate.

> Use case: ads-marketing. Asset type: opening photographic plate for a vertical 9:16 SeekerTag lost-and-found app commercial. Create one high-end editorial photograph, portrait 1080x1920 or the closest portrait ratio. A single charcoal black fabric everyday travel backpack is left unattended on a simple brushed chrome cafe chair, an espresso cup sits on the edge of a small round cafe table nearby. No people. Close, tangible, authentic slightly imperfect nylon fabric and zippers, warm late afternoon side lighting and soft contact shadows. The backpack is clearly the hero in the middle to lower-middle of the frame, centered around 60% down, occupying about 55% width and 42% height. Background is a very pale mint ivory wall, almost flat, with abundant clean empty space in the upper third for large black typographic overlay, and some breathing room below. Composition feels contemporary, witty, premium real-world brand advertising, not generic corporate stock, not an illustration, no screens, no text, no symbols, no watermark, no logo, no QR, no NFC tag, no artificial glow or gradients. Restrained color: charcoal, natural silver, pale mint ivory, gentle warm daylight. Subject sharp, background softly focused; editorial still-life shot with a 50mm lens.
