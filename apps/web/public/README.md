# Static assets

## island-hero.png (required)

The hero background: the Agent World island render.

Drop the supplied artwork here as `island-hero.png`. The hero reads it from
`/island-hero.png` and falls back to a gradient until it exists, so the page
works either way — but the fallback is a placeholder, not the design.

Guidance:
- Roughly 16:9. The supplied render is 1664x936, which is right.
- Export at 2x for retina (about 2400px wide) and keep it under ~600KB.
  A hero image is the first thing a visitor downloads, and a 4MB PNG is felt.
- WebP is better than PNG here. Save as `island-hero.webp` and change the one
  `HERO_IMAGE` constant in `components/hero/Hero.tsx`.

Agent label positions are expressed as fractions of this image's width and
height, in `zone.hero` in `packages/shared/src/agents/registry.ts`. If the
artwork is recropped, those fractions move with it.
