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

They are 2-3 MB each as PNG, which is heavy for a first paint - the Home hero
is the first thing a visitor downloads. Re-exporting as WebP at the same visual
quality typically cuts that 4-6x; the only change needed is the file extension
in `HERO_IMAGE` (`components/world/World.tsx`) and in the two page files.

**Tools and History** backgrounds sit much further back than Home - in the
reference they are a distant island under cloud, with the content reading over
the top. They can be darker and lower-contrast than the Home artwork, because
UI sits directly on them rather than beside them.

**16:9, at least 1920px wide.** Anything the composition depends on should sit
away from the edges: the image is cropped to fill on screens that are not 16:9,
and on a tall phone a surprising amount of the left and right is lost.
