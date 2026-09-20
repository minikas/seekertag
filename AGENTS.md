# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Android delivery requirement

After every change that affects `apps/mobile`, rebuild and reinstall the Android
application on the connected ADB device before handing the work back to the
user. Do not rely on an already-installed development build or Metro refresh:
the user must be able to test the exact delivered APK immediately.

# Video and motion

Use the [HyperFrames skills](https://github.com/heygen-com/hyperframes) for video
and motion work. Read the relevant installed `SKILL.md` before editing:

- `hyperframes`: mandatory entry point for creating, editing, inspecting,
  validating or rendering a video; resume the existing brief for revisions.
- `general-video`: the workflow for this narrated, multi-scene app walkthrough.
- `hyperframes-core`: composition structure, media timing, sub-compositions
  and deterministic rendering.
- `hyperframes-animation`: motion rules, scene transitions and GSAP animation.
- `hyperframes-keyframes`: camera moves, phone focus, zoom and reframing.
- `hyperframes-registry`: find reusable components before hand-building a
  named effect; this demo adapts `device-frame-stage` and `touch-indicator`.
  Camera patterns were reviewed, but the current edit uses no editorial zooms.
- `media-use`: narration, captions and preparation of recorded media.
- `hyperframes-cli`: checks, previews, snapshots and rendering.

The canonical project is `presentation/video/`; follow its `README.md`,
`edit/BRIEF.md` and `edit/design.md`. Keep one current project rather than
creating `demo-v2`, `demo-v3` or other duplicate production directories.

Use recordings of the current app, English narration/captions, and one smartphone
frame per participant. Keep one coherent item and SKR reward from deposit through
payout. Show the current receiving-address review and finish the return directly
from the owner conversation. Match touch indicators to recorded actions. Show
the NFC writing screen without claiming a physical tag was written. Never fill
a missing current payment confirmation with footage from an older return.

After composition changes, run `python3 presentation/video/author-edit.py` and
`npm run check --prefix presentation/video/edit`, then inspect affected scenes.
After rendering, run `python3 presentation/video/validate-video.py` against the
MP4 in `presentation/video/renders/` (or pass another MP4 path). Publish the final
video and subtitles as GitHub release assets; commit the editable source and
keep generated renders, QA frames and preview caches out of Git.
