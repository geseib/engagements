# Worker prompt (template)

The coordinator does not fill this by hand. Run

```bash
node scripts/skins/prompt.js --unit W4-b --base <wave-start-sha> --worktree <path>
```

and paste the output as the `prompt` of one Agent call. `prompt.js` fills every `{…}` from
`units.json`, `measure.js` (today's counts) and the test-ownership rule (PLAN §7). The text
between the two `PROMPT` markers is the template. Edit it here; `prompt.js` reads this file.

<!-- PROMPT START -->
You are converting unit {UNIT_ID} ({TITLE}) of the Engage site-skins migration, phase {PHASE}.

WHERE
- Repo worktree: {WORKTREE}. Work only there. Create branch `skins/{UNIT_ID}` from {BASE_REF}.
- Do NOT push, deploy, touch the dev/test/prod branches, or run `npm install` (it prunes the
  worktree's packages; scripts resolve playwright and postcss from what is installed).
- Never name a file with `token` in it (.gitignore:35). Tests end `Palette.test.js`.

READ FIRST, in full
- CLAUDE.md (repo root), .claude/skills/engage-design/SKILL.md and its references/
- docs/design/themes/SPEC.md §3-§4 and §7 (roles, the two skins, the accent-vs-action rule)
- docs/design/themes/PLAN.md, your unit's row
- docs/design/themes/WORKER-CHECKLIST.md: the ten steps you will follow, in order

YOUR UNIT
- Files you own (edit nothing else):
{FILES}
- styles.css range(s): {SC_RANGE}. Find each by its `/* skin-allowance SC-xx: … */` marker
  (it sits above the unit's banner); never by line number.
- Theme(s) these sheets render in: {THEMES}. Pass `--theme {THEME_ARG}` to the codemod.
- {TOKENS_ONLY}
- Today's counts (measure.js at the time this prompt was made):
{BEFORE}
- Target: every allowance pragma you own at {TARGET} (colour, font and primary), or each
  remaining literal kept with a written `keep:` reason.
- Components to adopt where the element already exists (no layout change): {COMPONENTS}
- Tests you OWN (update them; assert AA for every skin x theme with the harness):
{OWNED_TESTS}
- Tests you must NOT edit (they belong to another unit; write the assertions you need into
  your record under "Foreign assertions" and the coordinator hands them over):
{FOREIGN_TESTS}
- Routes to shoot: {ROUTES}
- Notes from the plan: {NOTES}

THE TOOLS (each has --help)
- node scripts/skins/measure.js --file <css> | --range SC-xx      counts, before and after
- node scripts/skins/deadSelectors.js --file <css> [--range SC-xx] --dead
- node scripts/skins/codemod.js --report --file <css> [--range SC-xx] --theme {THEME_ARG} --unit {UNIT_ID}
    then fill every "choice" in docs/design/themes/records/{UNIT_ID}.decisions.json, then
  node scripts/skins/codemod.js --apply --file <css> [--range SC-xx] --decisions docs/design/themes/records/{UNIT_ID}.decisions.json
  (one decisions file per stylesheet or range: add a suffix to --unit, e.g. {UNIT_ID}.QuestionSetsPanel)
- node scripts/skins/harness.js --role --accent-text --skin present --theme dark --explain
- node scripts/skins/classicEquivalence.js --base {BASE_REF} --unit {UNIT_ID}
- node scripts/skins/shoot.js --unit {UNIT_ID}   then   node scripts/skins/diff.js --unit {UNIT_ID} --skin classic --base docs/design/themes/shots/{UNIT_ID}.base

HOW TO DECIDE (SPEC §4.4, abridged; the codemod shows each candidate's Classic verdict)
- The main button's background (`--primary` as the one action) -> `action`; its ink -> `on-action`.
- A state, chip, count, selection, progress, badge -> `accent` (fills, borders) or
  `accent-text` (copy). Under Classic these are orange, so Classic is unchanged.
- `--secondary` as a link or "connected" -> `info`. As "showing/selected/pressed" -> `accent`,
  which IS a Classic change (blue -> orange): only with a recorded reason.
- Amber tint `rgba(246,169,76,a)`: `accent` for selection, `warn` for a warning. Blue tint
  `rgba(124,167,230,a)`: `info` keeps Classic; `accent` changes it.
- A literal with no role: keep a scope-local alias in channel form if one exists
  (`rgb(var(--slate-rgb) / .22)`), else `keep:<reason>`. Never merge a near-variant into a
  role silently (SPEC §4.2): that is a Classic delta.

DONE WHEN
- classicEquivalence reports 0 differences, or each one is listed in your record as an
  accepted Classic delta with its reason;
- the gate is green: cd src && npx jest skinLiteralsPalette skinHarnessPalette;
- every PLAN §1 gate is green and you ran them in this order and quote their last lines:
    rm -rf .aws-sam
    cd src && npx jest <your tests> && cd ..
    cd src && CI=true npx jest && npm run lint && npm run build && cd ..
    ls tests/*.js | grep -v verify-question-set-ui.spec.js | xargs -P 8 -n 1 sh -c 'node "$0" >/dev/null 2>&1 || echo "FAIL $0"'   (must print nothing)
- your work is committed on skins/{UNIT_ID} in small commits ("remove dead CSS" separate),
  each message ending with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- docs/design/themes/records/{UNIT_ID}.md is written from records/TEMPLATE.md (your own
  file: no two units ever write the same record; the coordinator's progress.js rolls them up).

REPORT BACK (your final message): commit sha(s); before -> after counts per file; decisions
by kind with every keep reason; Classic deltas; tests touched and foreign assertions;
the gate lines; anything you could not do and why.
<!-- PROMPT END -->
