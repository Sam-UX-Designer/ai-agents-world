# tools/ - integration logos

One file per integration, named for its id in the tool catalogue. All fifteen
are here: 256x256 PNG, transparent, no background of their own. The UI draws a
white rounded tile and the mark sits on it.

If an integration is added and its file is missing, the card falls back to a
lettermark rather than a broken image, so the screen stays usable.

## Where these came from

Each is the company's own mark, not a redrawing. Two collections, both of
which publish the official assets:

- **Full colour** - `gilbarbara/logos`, via the `@iconify-json/logos` package:
  Gmail, Google Calendar, Google Drive, Slack, Figma, Meta, YouTube,
  Salesforce, Airtable, GitHub, Notion, X, Linear, Zapier.
- **Single-colour glyph** - `simple-icons`, painted in the brand's own primary
  colour: HubSpot `#FF7A59`.

Each hex was checked against the brand's published palette rather than taken on
trust, which caught one - simple-icons carries Zapier's orange as `#FF4F00`
where Zapier's own palette gives `#FF4A00`. That no longer matters here, since
Zapier now uses its full-colour file, but the habit is the point.

## Why the tile is white

The tile used to be a near-transparent wash over the dark card, and that drove
the whole set: GitHub, Notion and X had to be swapped for their white variants
to be visible at all, Linear had to be recoloured, and the result read as a row
of shapes floating on glass rather than as logos.

White is what these marks are drawn for, and it is what every other product's
integrations page does. A logo is a fixed thing; the surface accommodates it.
So each brand's ordinary mark is now the right one, and the build check looks
for marks that are too **pale** to read rather than too dark.

## Two things worth knowing

**Google's marks are the 2020 redesigns.** The collection carries both the old
and the current file for Gmail, Calendar and Drive. They were rendered side by
side and compared - the `-2020` files are the marks Google uses now.

**Zapier has an icon mark, and this is it.** For a while this was Zapier's app
tile - an orange square with the wordmark knocked out - because the collection
index in the repository did not list `zapier-icon` and a search only described
the wordmark. It exists: the orange asterisk. The index that was read was
simply out of date, and a newer copy of the same collection has it.

## Format for a replacement

- Square, transparent, 256x256.
- The mark only. No tile of its own - the UI supplies the white one, and a logo
  carrying its own background will not match the others.
- Check it against white before committing it. A near-white mark is now the
  failure this file exists to prevent.
