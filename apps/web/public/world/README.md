# world/ - full-screen backgrounds

One image per surface. All three should share the same 16:9 composition and
colour treatment so moving between them feels like moving around one place.

| File | Surface | Status |
|---|---|---|
| `../island-hero.png` | Home - the Agent World | **uploaded** (1672x941) |
| `tools-bg.png` | Tools - integrations | needed |
| `history-bg.png` | History - past work | needed |

## Notes

**Home** already works. The file sits at `public/island-hero.png` rather than
in this folder because the code references it there. To move it, put it here as
`world/home.png` and change the one `HERO_IMAGE` constant in
`apps/web/components/hero/Hero.tsx`.

**Tools and History** backgrounds sit much further back than Home - in the
reference they are a distant island under cloud, with the content reading over
the top. They can be darker and lower-contrast than the Home artwork, because
UI sits directly on them rather than beside them.

**16:9, at least 1920px wide.** Anything the composition depends on should sit
away from the edges: the image is cropped to fill on screens that are not 16:9,
and on a tall phone a surprising amount of the left and right is lost.
