# Arabesque — Hero video design system

Brand identity for the landing-page hero. Light, calm, premium — matches the
app's own UI (PicoCSS + the `--pt-*` token set).

## Palette

- Background base: `#f7f7f9` (app bg)
- Background accent wash: `#eef0fb` (accent-soft)
- Surface / cards: `#ffffff`
- Border: `#e3e5ec`, strong `#cdd1dc`
- Text: `#1c1f29`
- Text muted: `#5b6270`
- Accent (primary): `#2f3b8c` (deep indigo)
- Accent strong: `#1f2a6e`

### Status / feedback accents (use sparingly, for chips and note dots)

- Déchiffrage / expected note: `#3b82f6`
- Perfectionnement: `#f59e0b`
- Répertoire / played note: `#16a34a` (pills), played highlight `#22c55e`
- Missed note: `#ef4444`

## Typography

- UI / body: `Inter`, system-ui sans-serif. Headlines `font-weight: 700`,
  letter-spacing `-0.02em`.
- Captions / chips: 600 weight.

## Motion

- Easing: `power3.out` for entrances, `power2.inOut` for holds, `power2.in` for exits.
- Calm and confident — slow drifts (Ken Burns), gentle slides, soft crossfades.
  Nothing bouncy. This is a focused practice tool, not a hype reel.

## Surfaces

- Cards: radius `20px`, shadow `0 30px 80px rgba(15,18,30,0.16)`, 1px border `#e3e5ec`.
- Chips: pill radius, accent-soft background, accent-strong text.
