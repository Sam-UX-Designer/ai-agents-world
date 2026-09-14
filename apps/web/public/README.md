# Public assets

Everything here is served from the site root. A file at
`public/tools/gmail.png` is reachable at `/tools/gmail.png`.

**Claude does not create artwork in this folder.** Every image here is supplied
by the product owner. Until a file exists the UI shows a labelled placeholder
that names the exact path it expects, so a missing asset is obvious rather than
silently broken.

## Where each asset goes

| Folder | What goes in it |
|---|---|
| `world/` | Full-screen backgrounds for the three surfaces |
| `tools/` | Integration logos on the Tools screen |
| `agents/` | Agent portraits shown in detail panels and History |
| `icons/` | Interface icons (navigation, actions, status) |
| `mascots/` | Robot mascot renders used in empty states and onboarding |

## Current state

No artwork is in the repository yet. Every surface shows a labelled placeholder
naming the path it expects. Start with `world/island-hero.png` - that one is
the Home background and the most visible gap.

## Guidance for every image

- **Export at 2x** for retina, then compress. A hero is the first thing a
  visitor downloads, and `island-hero.png` is currently 2.9 MB — large enough
  to be felt on a phone connection. WebP at the same visual quality is
  typically 4-6x smaller.
- **Use transparent PNG or SVG for logos and icons**, never a white box.
- **Name files in lowercase with hyphens** (`google-calendar.png`), because
  URLs are case-sensitive in production and not on macOS - a mismatch works
  locally and 404s once deployed.
