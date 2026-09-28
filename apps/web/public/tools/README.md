# tools/ - integration logos

One file per integration, named for its id in the tool catalogue. All fifteen
are here: 256x256 PNG, transparent, no background of their own, because the UI
draws the tile.

If an integration is added and its file is missing, the card falls back to a
lettermark rather than a broken image, so the screen stays usable.

## Where these came from

Each is the company's own mark, not a redrawing. Two sources, both of which
publish the official asset and cite the brand's own guidelines:

- **Full colour** - the `gilbarbara/logos` collection:
  Gmail, Google Calendar, Google Drive, Slack, Figma, Meta, YouTube,
  Salesforce, Airtable.
- **Single-colour glyph** - `simple-icons`, painted in each brand's own
  primary colour: HubSpot `#FF7A59`, Zapier `#FF4A00`, Linear `#5E6AD2`, and
  GitHub, Notion and X in white.

Every hex above was checked against the brand's own published palette rather
than taken on trust. That caught one: simple-icons carries Zapier as `#FF4F00`,
and Zapier's palette gives `#FF4A00`. HubSpot's coral and Linear's lavender
came back correct.

`scripts/build-tool-icons.mjs` in the scratchpad that produced these is not
kept; the mapping above is the record. To replace one, drop a 256px
transparent PNG in here under the integration's id.

## Three decisions worth knowing

**Google's marks are the 2020 redesigns.** The collection carries both the old
and the current file for Gmail, Calendar and Drive. They were rendered side by
side and compared - the `-2020` files are the marks Google uses now.

**GitHub, Notion and X are white, and Linear is purple.** The tile they sit on
is `rgb(255 255 255 / 0.08)` over a dark card. Measured rather than eyeballed:
the black versions came out at a mean luminance of 35 or less against it, which
is invisible. All three brands publish a white mark for dark backgrounds, and
Linear's own brand purple is the colour linear.app gives.

**Zapier is a wordmark, and that is not a mistake.** Zapier has no icon-only
mark - their brand is the lowercase orange wordmark, confirmed against their
own brand material. The square form here is their app tile, an orange square
with the wordmark knocked out, which is how Zapier appears in an app grid. At
26px it reads as "the orange Zapier tile" rather than as anything legible.
That is the best that exists rather than a shortcut, but it is still the first
one to replace if a better file turns up.

## Format for a replacement

- Square, transparent, 256x256.
- The mark only. No coloured tile of its own - the UI supplies that, and a logo
  carrying its own background will not match the others. Zapier above is the
  one exception, and it is an exception rather than a pattern.
- Check it against a dark background before committing it. A black mark on a
  dark card is the failure this file exists to prevent.
