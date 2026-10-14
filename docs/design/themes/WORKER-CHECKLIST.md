# Worker checklist: one unit, ten steps

For a worker converting one unit (PLAN.md). Do the steps in order. Every tool lives in
`scripts/skins/`, has `--help`, and runs from the worktree root. Your prompt (made by
`prompt.js`) names your unit, files, range, themes, tests and routes.

Ground rules: edit only the files you own · no `npm install` · no push, no deploy · nothing
named `*token*` · jest runs on Node 18 in the pipeline (no `toSorted`, `Object.groupBy`) ·
**no layout change**: Present may change colour, font treatment and the select mark, never a
size, a position or a line break.

## 1. Read and re-derive

- SPEC §3-§4 (roles, the two skins) and §7 (the gate); your unit's row in PLAN.
- `node scripts/skins/prompt.js --unit <ID>` shows your files expanded against today's tree. If
  a file in your row is gone or new, say so in your record; do not take files from another unit.
- styles.css ranges: find each by its marker `/* skin-allowance SC-xx: … */`, never by line.

## 2. Measure "before", and take the Classic baseline

```bash
node scripts/skins/measure.js --file <css>              # each file you own
node scripts/skins/measure.js --range SC-xx             # each styles.css unit you own
node scripts/skins/measure.js --jsx | grep -F <yours>   # JSX literals in your .jsx
cd src && npm run build && cd ..
node scripts/skins/shoot.js --unit <ID> --out docs/design/themes/shots/<ID>.base   # skip if your routes are all gallery:
```

Paste the numbers into your record (`records/TEMPLATE.md` → `records/<ID>.md`).

## 3. Delete dead CSS first

```bash
node scripts/skins/deadSelectors.js --file <css> [--range SC-xx] --dead
```

`dead` = no component names the class. Read each rule, grep once more yourself (markdown
renderers and third-party widgets can set classes), then delete it. `unsure` = a prefix or
suffix is built at runtime (`` `phase-${x}` ``): read the code; keep unless you can prove it dead.
One commit: "Skins <ID>: remove dead CSS". Re-measure.

## 4. Report, then decide every DECIDE

```bash
node scripts/skins/codemod.js --report --file <css> [--range SC-xx] --theme <dark|light|both> --unit <ID>[.<file>]
```

It writes `docs/design/themes/records/<ID>.decisions.json`:
- `auto[]`: exact role matches and Classic-identical channel forms. Read them; they apply as-is.
- `decide[]`: fill every `choice`. Each candidate carries its Classic verdict. Use SPEC §4.4:

| What it is | choice | Classic |
|---|---|---|
| the one main button's background | `action` (its ink `on-action`) | same |
| a state, chip, count, selection, progress, badge (fill/border) | `accent` | same (orange) |
| the same, as copy | `accent-text` | same on dusk; **differs on paper** (#9A5B18): record it or keep |
| `--secondary` as link / connected | `info` | same |
| `--secondary` as showing / selected / pressed | `accent` | **differs** (blue → orange): only with the owner's reason |
| amber tint `rgba(246,169,76,a)` | `accent` (selection) or `warn` (caution) | same |
| blue tint `rgba(124,167,230,a)` | `info` | same (`accent` differs) |
| a monospace stack | `font-mono` | same |
| anything with no role | `keep:<reason>` or `raw:<css>` (a channel form, a local alias) | yours to prove |

Never merge a near-variant (`.18`, `.22`, `rgba(182,194,212,…)`) into a role: SPEC §4.2.
The codemod refuses `--apply` while any choice is `null`, and refuses on a tree without
`styles/roles.css` (before Phase 0a nothing can be applied for real).

## 5. Apply, then adopt components

```bash
node scripts/skins/codemod.js --apply --file <css> [--range SC-xx] --decisions docs/design/themes/records/<ID>.decisions.json
```

It edits, lowers your pragma, and prints the Classic deltas your choices introduce. Then
adopt the listed `components/ui/*` **only where the element already exists**, with no layout
change. A needed change to a `ui/` component is a separate mini-unit: stop and say so.

## 6. Tests

Update the palette tests you own to the harness and to both skins:

```js
const H = require('../testing/skinHarness');
describe.each(H.CASES)('%s / %s', (skin, theme) => {
  test('text on the panel clears AA', () => {
    const on = H.on(H.role('--text', { skin, theme }), [H.role('--bg', { skin, theme }), H.role('--surface', { skin, theme })]);
    expect(on).toBeGreaterThanOrEqual(H.AA);
  });
  test('a hovered row', () => {
    const hover = H.scopeVar(MY_CSS, '.mine {', '--mine-row-hover', { skin, theme });
    expect(H.on(H.role('--muted', { skin, theme }), [H.role('--bg', { skin, theme }), hover])).toBeGreaterThanOrEqual(H.AA);
  });
});
```

`H.CASES` holds only the skins whose values file exists, so a test cannot "pass for Present"
before Present exists. Assert AA on every pairing and every composited tint. Tests that read
your sheets but you do not own: write the assertion into your record, do not edit them.

## 7. The allowance

The codemod lowered it. Check: `node scripts/skins/measure.js --file <css>` equals the pragma,
and `cd src && npx jest skinLiteralsPalette` is green. Target 0; every remainder is a `keep:`.

## 8. Classic is unchanged

```bash
node scripts/skins/classicEquivalence.js --base <BASE_REF> --unit <ID>
```

`0 difference(s) in Classic`, or each difference is either fixed or written into your record as
an accepted Classic delta with its reason. "removed" lines are your dead-CSS deletions.

## 9. Look at it

```bash
cd src && npm run build && cd ..
node scripts/skins/shoot.js --unit <ID>
node scripts/skins/diff.js --unit <ID> --skin classic --base docs/design/themes/shots/<ID>.base
```

Open `docs/design/themes/shots/<ID>/index.html`. Classic must diff 0 pixels (or each shot is a
recorded delta). Present: look at every shot; any box `shoot.js` reports as **moved** between
skins is a layout change, i.e. a bug. `gallery:` routes are not shootable until the gallery
exists: say so in the record; classicEquivalence is your evidence.

## 10. Gates, commit, record, hand back

```bash
rm -rf .aws-sam
cd src && npx jest <your tests> && cd ..
cd src && CI=true npx jest && npm run lint && npm run build && cd ..
ls tests/*.js | grep -v verify-question-set-ui.spec.js | xargs -P 8 -n 1 sh -c 'node "$0" >/dev/null 2>&1 || echo "FAIL $0"'
```

Judge by exit code AND suite count. The last command must print nothing. Commit on
`skins/<ID>` (messages end with the Co-Authored-By line), write `records/<ID>.md`, and report:
sha, before → after, decisions by kind with keep reasons, Classic deltas, tests touched and
foreign assertions, gate lines, anything you could not do.
