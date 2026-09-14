# icons/ - interface icons

Only for icons that cannot be drawn as inline SVG in the components.

Prefer inline SVG in code for anything small and monochrome: it inherits
`currentColor`, so it follows the theme automatically, needs no network
request, and cannot 404. A file here should be something genuinely
illustrative - a multi-colour status glyph, an empty-state drawing.

Name by meaning, not appearance: `status-needs-approval.svg`, not
`amber-circle.svg`. The colour will change; the meaning will not.
