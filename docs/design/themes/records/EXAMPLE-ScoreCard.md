---
unit: EXAMPLE-ScoreCard
status: example
commit: none (scratch copy)
base: 5a24f887
worker: tooling agent, 2026-10-13
date: 2026-10-13
before: colour=8 font=0 primary=3
after: colour=0 font=0 primary=0
classic_deltas: 0
---
# EXAMPLE: ScoreCard.css, round trip in a scratch copy

**A worked example, not a unit.** It shows the record format with real output. It was run on a
scratch copy of `src/src` with the SPEC §4 fixture skins and roles
(`scripts/skins/fixtures/spec-skins`) copied in, because the real `styles/roles.css` does not exist
until Phase 0a. The real ScoreCard.css is unchanged; W6-a owns it.

## Counts (measure.js)

| File | rule literals | decl literals | --primary | --secondary | before (gate) | after (gate) |
|---|---:|---:|---:|---:|---|---|
| `components/ScoreCard.css` | 5 → 0 | 3 → 0 | 1 → 0 | 2 → 0 | colour=8 font=0 primary=3 | colour=0 font=0 primary=0 |

## Dead CSS removed

`deadSelectors.js --file components/ScoreCard.css`: 47 live · 3 unsure · 0 dead. Nothing removed.

## Decisions

auto 6: `--scard-rule` → `var(--rule)`, `--scard-rule-strong` → `var(--rule-strong)`,
`--scard-row-hover` → `var(--row-hover)` (exact); two `rgba(229,100,94,.55)` borders →
`rgb(var(--danger-rgb) / .55)`; the scrim `rgba(15,26,46,.72)` → `rgb(var(--shade-rgb) / .72)`
(channel; `--shade-rgb` is a PROPOSED role, see README "Gaps found").

decide 5: info 3 (`.scard-back` link colour, `.scard-chip--low` colour and its blue border) ·
accent-text 1 (`.scard-chip--medium` colour) · warn 1 (`.scard-chip--medium` amber border: a
medium-severity chip is a caution, not a selection). keep: none.

## Classic

    ## components/ScoreCard.css — 0 difference(s)
    themes: dark · 0 difference(s) in Classic

Accepted Classic deltas: none.

## Present

Not shot (ScoreCard renders only on the signed-in participant flow: `gallery:` / W6-a's `/play`
fixtures). Under Present, the medium chip stays amber (`warn`), the low chip and the back link
stay blue (`info`), and the chip copy `accent-text` turns `#9CBEF0`.

## Tests

None touched in the example. W6-a owns `scardPalette.test.js`; it would move to
`H.eachSkinTheme` and assert the chip borders on `--surface` in both skins.

## Gates

Scratch copy only; no gates run. A real unit quotes them here.

## Could not do

Allowance 0 needed `--shade-rgb`, which SPEC §4 does not define. Without it the scrim is a
`keep:` and the allowance ends at colour=1.
