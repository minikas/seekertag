# Token marks

`skr.svg` is the unmodified circular SKR mark served by Solana Mobile's official staking site.

- Source: https://stake.solanamobile.com/skr-logo.svg
- Official application: https://stake.solanamobile.com/
- Official press kit: https://solanamobile.com/press
- Retrieved: 2026-09-19

`src/SkrTokenMark.tsx` renders its four visible paths with React Native SVG. It preserves the original geometry and colors: black (#000000) on white (#FFFFFF). The SVG's bounding-box-only mask and clip are unnecessary for these paths. The mark is bundled locally and is not tinted by the application theme.
