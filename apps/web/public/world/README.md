# world/ - full-screen backgrounds

One image per surface. All three should share the same 16:9 composition and
colour treatment so moving between them feels like moving around one place.

| File | Surface | Status |
|---|---|---|
| `island-hero.png` | Home - the Agent World | **in use** |
| `tools-bg.png` | Tools - integrations | **in use** |
| `history-bg.png` | History - past work | **in use** |

## Notes

All three are wired up and 1672x941 (16:9). Each surface shows a panel naming
its path if the file is ever missing, rather than a broken image.

## Upload the PNG. The WebP takes care of itself.

Replace the `.png` and push - nothing else. `scripts/optimize-world-art.mjs`
runs on every build and re-encodes each PNG here as a `.webp` beside it, and
the page asks for the WebP first with the PNG as its fallback.

The re-encode runs at **WebP quality 95**, which takes about 80% off these
files. That number is the owner's decision, made by comparing a 2x crop of the
lighthouse - the most detailed part of the artwork - against the original and
against a lossless encode, and finding no visible difference.

If artwork is ever replaced with something that suffers at 95 - flat gradients
and hard edges are where WebP shows its teeth, foliage and water are not -
raise `QUALITY` in the script, or set `lossless: true` there and accept that
the files only shrink by about a quarter.

Do not hand-edit the `.webp` files, and do not delete a `.png` - the PNG is the
asset of record and the input the WebP is made from. It is also what a browser
too old for WebP loads instead.

If a WebP cannot be produced, the build **fails** rather than deploying. That
is deliberate: a missing WebP renders a broken image, it does not quietly fall
back to the PNG, so a red build is the only outcome that cannot ship a hole
where the island should be.

**Tools and History** backgrounds sit much further back than Home - in the
reference they are a distant island under cloud, with the content reading over
the top. They can be darker and lower-contrast than the Home artwork, because
UI sits directly on them rather than beside them.

**16:9, at least 1920px wide.** Anything the composition depends on should sit
away from the edges: the image is cropped to fill on screens that are not 16:9,
and on a tall phone a surprising amount of the left and right is lost.
