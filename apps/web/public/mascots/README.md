# mascots/ - agent characters

One image per agent. The file is used twice: standing on the agent's station
on the island, and as the small icon inside its card.

**Name each file after the agent's key**, exactly as listed below. That is how
the app finds it — there is no registration step. Drop the file in, reload, and
the agent is wearing it.

## Files needed

```
orchestrator.png     the central hub agent
hr.png
finance.png
marketing.png
sales.png
operations.png
general.png
development.png
design.png
```

## Format

- **PNG with a transparent background.** The mascot stands on the island, so
  any background colour will show as a rectangle on the artwork.
- **512px tall** is plenty. It renders at 54px on the island and 26px in a
  card, so bigger than 512 is bytes nobody sees.
- **Full body, feet at the bottom edge** of the canvas, with no padding
  underneath. The image is anchored by its feet so a taller character grows
  upward and still stands on its station rather than floating above it.
- **Facing forward or three-quarter.** These are viewed from an elevated
  isometric angle, so a straight side profile reads oddly.

## What they do once they are here

While its agent is working, the character lifts and settles on a slow loop and
picks up a blue rim light. That is the only way the robot itself can be made to
move: the ones painted into `world/island-hero.png` are part of the picture, so
animating one would mean cutting it out and redrawing what is behind it, which
is not something this repo does to supplied artwork.

Until a file is here, the station shows the light instead — a ring leaving it
on a loop, which is legible from across the island but is not the robot moving.

## Until they exist

Each station shows a soft glow instead — deliberately not a robot silhouette,
because a placeholder shaped like the real thing tends to survive to
production. A missing file is never a broken-image icon.

## Adding an agent later

Agents will become user-created rather than a fixed list. When that lands,
`default.png` here becomes the fallback for any agent without its own render,
so the island never has a blank station.
