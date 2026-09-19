# brand/ - the logo

| File | What it is |
|---|---|
| `logo.png` | **The master, as supplied.** 1254x1254, transparent corners. |
| `logo-128.webp` | What the interface renders. Cut from the master. |

The mark is 38px on screen, so 128 covers it at 3x on the densest phone. The
master is 1.4 MB and would otherwise be downloaded in full to be drawn at the
size of a fingernail.

## Replacing the logo

Drop the new file in as `logo.png`, then regenerate the three derived sizes -
`logo-128.webp` here, and `app/icon.png` and `app/apple-icon.png`, which are
Next's own conventions for the browser tab and the iOS home screen. Ask and I
will cut them; they are three lines of Pillow, not a design decision.

`app/apple-icon.png` is the only one with a filled background. iOS composites a
transparent touch icon onto black, which would turn the rounded corners into
black notches, so it sits on the logo's own edge blue and iOS applies its own
mask over the top.

Do not add a border-radius when rendering this. The logo carries its own
rounded square; clipping it again shaves the corners twice.
