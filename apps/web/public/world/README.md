# world/ - full-screen backgrounds

One image per surface. All three should share the same 16:9 composition and
colour treatment so moving between them feels like moving around one place.

| File | Surface | Status |
|---|---|---|
| `island-hero.png` | Home - the Agent World | **needed** |
| `tools-bg.png` | Tools - integrations | needed |
| `history-bg.png` | History - past work | needed |

## Notes

**Home** reads `/world/island-hero.png`. Until that file exists the page shows
a panel naming the path rather than a broken image, so a missing asset is
obvious instead of silently wrong.

The artwork was previously at `public/island-hero.png` and was moved here, so
the code now points at this folder. 1672x941 (16:9) was the size in use.

**Tools and History** backgrounds sit much further back than Home - in the
reference they are a distant island under cloud, with the content reading over
the top. They can be darker and lower-contrast than the Home artwork, because
UI sits directly on them rather than beside them.

**16:9, at least 1920px wide.** Anything the composition depends on should sit
away from the edges: the image is cropped to fill on screens that are not 16:9,
and on a tall phone a surprising amount of the left and right is lost.
