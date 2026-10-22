#!/usr/bin/env node
/**
 * help-drift — which help guides may have fallen behind the code they describe.
 *
 * Help refresh Phase 0 (docs/help-refresh/STRUCTURE.md). For each guide, the
 * code paths it covers (COVERS below) and the commits that touched those paths
 * since the guide's own file (src/src/config/help/<area>.js) last changed. A
 * guide with commits listed is not necessarily wrong; it is where to look
 * first. Run it before every push to test (CLAUDE.md, "Before every push to
 * test").
 *
 *   node scripts/help-drift.js            guides with commits since, newest first
 *   node scripts/help-drift.js --all      every guide, including the quiet ones
 *   node scripts/help-drift.js --since <ref>   count from <ref> instead of each
 *                                         guide file's last change
 *
 * Advisory: it always exits 0. No dependencies; it reads the corpus files as
 * text (they are ES modules for the app) and asks git.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HELP = 'src/src/config/help';
const S = 'src/src';
const L = 'lambda-functions';

/**
 * GUIDE → THE CODE IT DESCRIBES. Repo-relative paths (files or folders).
 * When you add a guide, add it here; the report lists guides with no entry.
 */
const COVERS = {
  // players
  'player-getting-started': [`${S}/PlayerPage.jsx`, `${S}/components/PlayerShell.jsx`, `${S}/config/gameTypes.js`],
  'player-joining': [`${S}/components/JoinCodeEntry.jsx`, `${S}/components/JoinNameCollision.jsx`, `${S}/components/joinResult.js`],
  'player-playing': [`${S}/PlayerPage.jsx`, `${S}/components/survey`, `${S}/config/lateWords.js`],
  'player-scoring': [`${S}/components/stage/scoreboard`, `${L}/game/get-results.js`],
  'player-voting': [`${S}/PlayerPage.jsx`, `${L}/game/submit-vote.js`],
  'player-feedback': [`${S}/PlayerPage.jsx`, `${S}/components/RoundReport.jsx`],
  'player-trouble': [`${S}/PlayerPage.jsx`, `${S}/components/joinResult.js`, `${S}/config/lateWords.js`],
  // hosts: setting up
  'host-quick-start': [`${S}/components/WelcomeScreen.jsx`, `${S}/components/GameSetupDialog.jsx`, `${S}/components/QuickstartMenu.jsx`, `${S}/components/stage/Dock.jsx`],
  'host-game-setup': [`${S}/components/GameSetupDialog.jsx`, `${S}/components/HostQuestionSetsDialog.jsx`, `${S}/components/stage/ScreensGroup.jsx`, `${S}/config/roomScreen.js`, `${S}/config/displayProfile.js`],
  // hosts: running the room
  'host-running-engagements': [`${S}/components/stage/SessionSetupPanel.jsx`, `${S}/components/QuestionsPanel.jsx`, `${S}/components/PastRound.jsx`, `${S}/GameHostPage.jsx`],
  'host-session-panel': [`${S}/components/stage/SessionSetupPanel.jsx`, `${S}/components/stage/ScreensGroup.jsx`],
  'host-stage-by-type': [`${S}/GameHostPage.jsx`, `${S}/components/stage`, `${S}/config/roomContent.js`],
  'host-late-items': [`${S}/components/LateList.jsx`, `${S}/components/ReportLate.jsx`, `${S}/config/lateWords.js`],
  'host-player-management': [`${S}/components/stage/PlayersList.jsx`, `${S}/components/JoinNameCollision.jsx`],
  // hosts: two screens and the phone
  'host-two-screens': [`${S}/components/console`, `${S}/present`, `${S}/PresentPage.jsx`, `${S}/HostRemote.jsx`, `${S}/components/stage/RoomWindowStatus.jsx`, `${S}/config/consoleWords.js`],
  // hosts: results and reports
  'host-reporting': [`${S}/components/GameReport.jsx`, `${S}/components/RoundReport.jsx`, `${S}/components/ReportsPanel.jsx`, `${S}/components/AISummaryStatus.jsx`, `${S}/components/console/panels/ReadPanel.jsx`, `${L}/game/save-report.js`],
  'host-what-we-heard': [`${S}/components/console/panels/ReadPanel.jsx`, `${S}/components/AskComposer.jsx`, `${S}/components/FeedbackRoundPanel.jsx`, `${S}/config/followUpWords.js`],
  'host-plan': [`${S}/components/BillingPanel.jsx`, `${S}/components/UsageMeter.jsx`, `${L}/websocket/session-count.js`],
  // Build Room
  'host-build-room': [`${S}/buildroom`, `${S}/present/buildwall`, `src/public/engage-mcp.mjs`],
  'build-room-running': [`${S}/buildroom`],
  'build-room-sharing': [`${S}/buildroom/BuildWifiShare.jsx`, `src/public/engage-mcp.mjs`],
  'build-room-two-screens': [`${S}/buildroom`, `${S}/present/buildwall`, `${S}/components/console`],
  'build-room-wrap-up': [`${S}/buildroom`],
  'build-room-claude': [`src/public/engage-mcp.mjs`],
  'player-build-room': [`${S}/buildroom`],
  // admin console
  'admin-getting-started': [`${S}/AdminPage.jsx`, `${S}/components/AdminShell.jsx`, `${S}/config/consoleSections.js`],
  'admin-question-sets': [`${S}/components/QuestionSetsPanel.jsx`, `${S}/components/QuestionSetEditor.jsx`, `${S}/components/QuestionSetUploadPanel.jsx`, `${S}/components/ArchivePanel.jsx`],
  'admin-public-library': [`${S}/components/PublicLibraryPanel.jsx`, `${L}/admin`],
  'admin-members': [`${S}/components/TeamPanel.jsx`],
  'admin-activity': [`${S}/components/UsageStatsPanel.jsx`, `${S}/config/consoleSections.js`],
  'admin-plan-usage': [`${S}/components/BillingPanel.jsx`, `${S}/components/PlanRequestDialog.jsx`, `${S}/components/LeavePlanDialog.jsx`, `${S}/components/UsageMeter.jsx`],
  'admin-data-privacy': [`${S}/components/PrivacyPanel.jsx`, `${L}/game/session-ttl.js`, `${L}/game/save-report.js`],
  'admin-game-management': [`${S}/AdminPage.jsx`],
  'admin-settings': [`${S}/AdminPage.jsx`],
  // AI
  'admin-ai-prompts': [`${S}/components/PromptLibraryPanel.jsx`, `${S}/components/AIPromptManager.jsx`, `${S}/components/PromptVersionsPanel.jsx`, `${S}/components/PromptRepoReview.jsx`, `${S}/config/templateVariables.js`],
  'admin-ai-builders': [`${S}/components/TriviaAIBuilder.jsx`, `${S}/components/PollAIBuilder.jsx`, `${S}/components/SurveyAIBuilder.jsx`, `${S}/components/AIScenarioBuilder.jsx`, `${S}/components/DestinationField.jsx`, `${S}/components/GenerationJobPanel.jsx`, `${S}/components/AddQuestionsDialog.jsx`],
  'ai-drafts': [`${S}/components/DraftReview.jsx`, `${S}/components/DraftsStrip.jsx`, `${S}/components/NotificationsBell.jsx`, `${S}/components/HostNotificationsBell.jsx`, `${S}/utils/notificationsApi.js`, `${L}/admin/shared/generation-drafts.js`, `${L}/admin/orgs/my-notifications.js`],
  'ai-workie': [`${S}/components/WorkieContextHint.jsx`, `${S}/components/BriefingField.jsx`, `${S}/components/SessionOptions.jsx`, `${S}/components/QuestionSetEditor.jsx`, `${L}/game/get-ai-summary.js`],
  'builder-ai': [`${S}/components/AIFormAssist.jsx`, `${S}/components/FieldLock.jsx`, `${S}/components/QuestionsPanel.jsx`, `${S}/components/QuestionSetUploadPanel.jsx`],
  // builders
  'builder-manual': [`${S}/components/QuestionsPanel.jsx`, `${S}/components/QuestionImageField.jsx`, `${S}/components/SurveyQuestionFields.jsx`, `${S}/components/CategoryPicker.jsx`],
  // technical
  'technical-troubleshooting': [`${S}/components/JoinCodeEntry.jsx`, `${S}/auth`, `${S}/utils`],
  'technical-requirements': [`${S}/config/displayProfile.js`, `${S}/config/roomScreen.js`],
  // the glossary: the screens its terms are checked against (its header comment)
  glossary: [`${S}/utils/setOwnerTag.js`, `${S}/config/consoleWords.js`, `${S}/config/roomScreen.js`, `${S}/config/followUpWords.js`, `${S}/components/WelcomeScreen.jsx`, `${S}/components/stage/Dock.jsx`],
};

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
};

/** guide id → the area file that declares it (`  id: '<guide>',` at guide level). */
function guideFiles() {
  const dir = path.join(ROOT, HELP);
  const out = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/^const \w+ = \{\n {2}id: '([^']+)',/gm)) out[m[1]] = `${HELP}/${f}`;
  }
  return out;
}

function main(argv) {
  const all = argv.includes('--all');
  const sinceAt = argv.indexOf('--since');
  const since = sinceAt >= 0 ? argv[sinceAt + 1] : null;

  const files = guideFiles();
  const rows = [];
  const notes = [];

  Object.keys(files).filter((id) => !COVERS[id]).forEach((id) => notes.push(`no COVERS entry for guide ${id} (${files[id]})`));
  Object.keys(COVERS).filter((id) => !files[id]).forEach((id) => notes.push(`COVERS names ${id}, which no help file declares`));

  for (const [id, paths] of Object.entries(COVERS)) {
    const file = files[id];
    if (!file) continue;
    const existing = paths.filter((p) => fs.existsSync(path.join(ROOT, p)));
    paths.filter((p) => !existing.includes(p)).forEach((p) => notes.push(`${id}: covered path ${p} does not exist`));
    const base = since || git('log', '-1', '--format=%H', '--', file);
    if (!base || !existing.length) continue;
    const log = git('log', '--no-merges', '--format=%h %ad %s', '--date=short', `${base}..HEAD`, '--', ...existing);
    const commits = log ? log.split('\n') : [];
    rows.push({ id, file, base: base.slice(0, 8), commits });
  }

  rows.sort((a, b) => b.commits.length - a.commits.length);
  const shown = all ? rows : rows.filter((r) => r.commits.length);
  console.log(`Help drift: commits to the code each guide covers, since ${since ? `${since}` : 'its help file last changed'}.`);
  console.log('Advisory only. A count is where to look, not proof the guide is wrong.\n');
  if (!shown.length) console.log('Every guide is newer than the code it covers.');
  for (const r of shown) {
    console.log(`${String(r.commits.length).padStart(3)}  ${r.id}  (${r.file} @ ${r.base})`);
    r.commits.slice(0, 5).forEach((c) => console.log(`       ${c}`));
    if (r.commits.length > 5) console.log(`       … and ${r.commits.length - 5} more`);
  }
  if (notes.length) {
    console.log('\nMap notes:');
    notes.forEach((n) => console.log(`  - ${n}`));
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
  process.exit(0);
}

module.exports = { COVERS, guideFiles };
