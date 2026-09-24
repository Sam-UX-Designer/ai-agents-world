# mascots/ - agent pictures

**One image per agent, and this folder is the only place it goes.**

There used to be a second folder, `agents/`, described as holding portraits for
the panel and History. Nothing ever read it, so filling it changed nothing and
having two folders for one picture was a trap. It is gone; this is the one.

The file here is an agent's face everywhere it appears:

- the icon on its card on the island
- the picture in its detail panel
- the row in the working-agents list
- the agent list on a tool's page
- the dot beside a past run in History

It is not drawn standing on the station itself. It was for a while, directly
under the card that already shows the same face, and two copies of one picture
forty pixels apart read as a mistake rather than as a character. The station
keeps a light that pulses while its agent works.

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

- **Square, and a portrait rather than a full figure.** These are drawn small
  and rounded, as an avatar. A transparent background is fine but no longer
  required, because nothing is laid over the artwork any more.
- **512px is plenty**, and smaller is better. It renders at 38px in the panel
  and 26px on a card, so anything past 512 is bytes nobody sees. The build cuts
  a 256px WebP from whatever is here and that is what ships, so a large upload
  costs repository size rather than load time.
- **Centred, with the face filling most of the canvas.** At 26px a full figure
  is a smudge; a face reads.

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
