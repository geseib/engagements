---
unit: W0-x
status: done
commit: 0000000
base: 0000000
worker: <agent or person>
date: 2026-10-13
before: colour=0 font=0 primary=0
after: colour=0 font=0 primary=0
classic_deltas: 0
---
# <unit id>: <title>

Copy this file to `records/<unit>.md`. The front matter is read by `scripts/skins/progress.js`
(keep the keys; `status` is `done`, `blocked` or `in-progress`; `before`/`after` are the sums
over every file you own). Nobody else writes your record, and you write no other.

## Counts (measure.js, per file)

| File / range | rule literals | decl literals | font literals | --primary | --secondary | before (gate) | after (gate) |
|---|---:|---:|---:|---:|---:|---|---|
| `components/X.css` | 5 → 0 | 3 → 0 | 0 → 0 | 1 → 0 | 2 → 0 | colour=8 font=0 primary=3 | colour=0 font=0 primary=0 |

## Dead CSS removed

`deadSelectors.js` output for each file: which classes were dead, which you deleted (commit),
which "unsure" ones you read and kept, and why.

## Decisions

Totals by kind (from `codemod.js --apply`): action N · accent N · accent-text N · info N ·
warn N · other roles N · keep N · raw N. Decisions files: `records/<unit>*.decisions.json`.

Every `keep:` with its reason:
- `line:col selector property literal` — reason

## Classic

`node scripts/skins/classicEquivalence.js --base <base> --unit <unit>` last line, verbatim.
Accepted Classic deltas (the owner reviews these in a batch), each with its reason:
- none

## Present

Shots: `docs/design/themes/shots/<unit>/index.html` (local; not committed). Anything that looks
wrong in Present but is layout (not this project's), and any box `shoot.js` reported as moved.

`diff.js --skin classic` last line, verbatim.

## Tests

Files touched. Foreign assertions (tests you do not own — the assertion you need, and which
unit owns the test):
- none

## Gates

The exact commands, in order, and their final lines (suite counts):

    rm -rf .aws-sam
    cd src && npx jest <pattern>                     -> Tests: …
    cd src && CI=true npx jest                       -> Test Suites: … passed, … total
    cd src && npm run lint                           -> 0 errors
    cd src && npm run build                          -> compiled …
    backend: xargs over tests/*.js                   -> (nothing printed) 321 suites

## Could not do
