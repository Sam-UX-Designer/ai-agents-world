# tools/ - integration logos

One file per integration, named for its id in the tool catalogue.

Square, transparent background, at least 128x128 (256 is safer - the detail
panel draws them at 52px on a 2x screen).

Until a file lands here the card shows a lettermark instead of a broken image,
so the Tools screen is usable with none of these uploaded. The lettermark is
the only thing that makes Gmail, Google Calendar and Google Drive look alike,
which is the main reason to upload them.

## Needed

```
gmail.png            google-calendar.png   google-drive.png
slack.png            notion.png            figma.png
github.png           meta.png              x.png
youtube.png          hubspot.png           salesforce.png
airtable.png         zapier.png            linear.png
```

Use each company's official brand asset. Most publish one - do not trace or
recreate a logo by hand, and do not place it on a coloured tile: the UI
supplies the tile, and a logo with its own background will not match.
