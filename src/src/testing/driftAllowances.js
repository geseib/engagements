/* eslint-env node */
/**
 * THE DRIFT ALLOWANCES (docs/design/experience-plan/PLAN.md §5.3, Phase 0).
 *
 * The count of each kind of drift each file may have. Every number may only go DOWN,
 * and must go down in the same change that lowers the count: the guards in
 * src/src/__tests__/driftRatchets.test.js and helpTruth.test.js fail when a count is above its allowance (new drift)
 * and when it is below (a stale allowance). Regenerate after a merge with
 *   node scripts/drift-baselines.js --module > src/src/testing/driftAllowances.js
 * and read the diff: every number in it should have fallen.
 *
 * buttonFamilies is one total across all stylesheets (see driftScan.js for "family");
 * buttonFamilyNames only lets a failure name the new family, it is not a ratchet itself.
 * Not named *token*: .gitignore has an unanchored `*token*`.
 */
module.exports = {
  "buttonFamilies": 89,
  "dialogs": {
    "GameHostPage.jsx": 6,
    "components/AddQuestionsDialog.jsx": 1,
    "components/GameReport.jsx": 1,
    "components/PlanRequestDialog.jsx": 1
  },
  "closeGlyphs": {},
  "primaryButtons": {
    "BuilderPage.css": 1,
    "auth/auth.css": 1,
    "components/AIPromptManager.css": 1,
    "components/ArchivePanel.css": 1,
    "components/BillingPanel.css": 1,
    "components/DiscountCodes.css": 1,
    "components/DraftReview.css": 1,
    "components/FileUploadPrompt.css": 1,
    "components/GeneratedItemsTable.css": 1,
    "components/GenerationJobPanel.css": 1,
    "components/InviteDialog.css": 1,
    "components/InvoicePanel.css": 1,
    "components/IssueReportForm.css": 1,
    "components/LeavePlanDialog.css": 1,
    "components/ModerationPanel.css": 1,
    "components/OrgBillingDrawer.css": 1,
    "components/OverviewPanel.css": 1,
    "components/PlanLimitNotice.css": 1,
    "components/PlanRequests.css": 1,
    "components/PrivacyPanel.css": 1,
    "components/PublicLibraryPanel.css": 1,
    "components/QuestionSetEditor.css": 1,
    "components/QuestionSetsPanel.css": 1,
    "components/ReportShare.css": 1,
    "components/RootPage.css": 1,
    "components/SetMediaPanel.css": 1,
    "components/SetReviewBanner.css": 1,
    "components/ShareSetDialog.css": 1,
    "components/TeamPanel.css": 1,
    "components/UsageStatsPanel.css": 1,
    "components/UserManagement.css": 1,
    "marketing/HomePage.css": 1,
    "marketing/MarketingShell.css": 1,
    "styles.css": 1
  },
  "bannedWords": {
    "AdminPage.jsx": {
      "AI summary": 1,
      "Settings": 2,
      "game": 1
    },
    "App.jsx": {
      "game": 1
    },
    "BuilderPage.jsx": {
      "AI summary": 1
    },
    "GameHostPage.jsx": {
      "Back to Menu": 1,
      "Back to the agenda": 1,
      "Game ID": 2,
      "game": 4,
      "the summary": 2
    },
    "HostRemote.jsx": {
      "Results": 1,
      "big screen": 5,
      "projector": 1
    },
    "PresentPage.jsx": {
      "Presentation": 1,
      "Show QR": 2
    },
    "WordCloudTest.jsx": {
      "game": 1
    },
    "buildroom/BuildCrew.jsx": {
      "Feedback": 1
    },
    "buildroom/BuildOpening.jsx": {
      "SESSION": 1
    },
    "buildroom/BuildPlayer.jsx": {
      "Results": 1
    },
    "buildroom/BuildPlayerCrew.jsx": {
      "Feedback": 1
    },
    "buildroom/BuildRoomPage.jsx": {
      "game": 1
    },
    "buildroom/BuildStageDecide.jsx": {
      "Results": 1
    },
    "buildroom/words.js": {
      "Feedback": 1,
      "Players": 1,
      "Settings": 1,
      "Unlock name": 1,
      "big screen": 2,
      "projector": 2
    },
    "components/AIGenerationPromptEditor.jsx": {
      "game": 1
    },
    "components/AIPromptManager.jsx": {
      "game": 2,
      "the summary": 2
    },
    "components/AIScenarioBuilder.jsx": {
      "game": 2
    },
    "components/BriefingField.jsx": {
      "the summary": 1
    },
    "components/EventBuilder.jsx": {
      "Main screen": 1
    },
    "components/EventDetailsDialog.jsx": {
      "Main screen": 1
    },
    "components/FormatWalkthrough.jsx": {
      "stage": 1
    },
    "components/GameReport.jsx": {
      "Comment": 1,
      "Results": 1
    },
    "components/GameSetupDialog.jsx": {
      "Main screen": 1
    },
    "components/GenerationJobPanel.jsx": {
      "game": 2
    },
    "components/IssueReportForm.jsx": {
      "Game ID": 1,
      "game": 1
    },
    "components/PromptAssembledPreview.jsx": {
      "projector": 1
    },
    "components/PromptLibraryPanel.jsx": {
      "game": 1
    },
    "components/PromptOutputSectionsField.jsx": {
      "projector": 1
    },
    "components/PromptPreflightPanel.jsx": {
      "the summary": 1
    },
    "components/QuestionSetUploadPanel.jsx": {
      "AI summary": 1,
      "Presentation": 1,
      "game": 1
    },
    "components/ReportsPanel.jsx": {
      "the summary": 2
    },
    "components/RoundReport.jsx": {
      "Comment": 1
    },
    "components/SessionsPanel.jsx": {
      "All sessions": 2
    },
    "components/SiteSkinPanel.jsx": {
      "Presentation": 1
    },
    "components/SkinGallery.jsx": {
      "Results": 1
    },
    "components/event/EventStage.jsx": {
      "Back to the agenda": 2,
      "Back to the console": 1
    },
    "components/event/HostEventAgenda.jsx": {
      "Main screen": 1,
      "the summary": 1
    },
    "components/stage/Dock.jsx": {
      "PRESENT": 2,
      "SESSION": 1,
      "Session panel": 3
    },
    "components/stage/PhaseBar.jsx": {
      "Results": 1
    },
    "components/stage/PlayersList.jsx": {
      "Asking to take this name": 1,
      "Unlock name": 1
    },
    "components/stage/Rail.jsx": {
      "Results": 1
    },
    "components/stage/ScreensGroup.jsx": {
      "projector": 1
    },
    "components/stage/SessionSetupPanel.jsx": {
      "AI summary": 2,
      "game": 1
    },
    "components/stage/WorkieSettings.jsx": {
      "the summary": 1
    },
    "components/ui/fixtures/Chip.jsx": {
      "Results": 1
    },
    "config/aiAuthoringPrompt.js": {
      "game": 3
    },
    "config/comments.js": {
      "Results": 1
    },
    "config/consoleSections.js": {
      "Settings": 2
    },
    "config/formatGuide.js": {
      "Main screen": 1,
      "big screen": 2
    },
    "config/gameTypes.js": {
      "big screen": 1
    },
    "config/help/admin-console.js": {
      "All sessions": 2,
      "Settings": 2
    },
    "config/help/ai.js": {
      "Session panel": 1
    },
    "config/help/build-room-participant.js": {
      "Main screen": 2
    },
    "config/help/build-room.js": {
      "SESSION": 1,
      "game": 2,
      "stage": 1,
      "the summary": 1
    },
    "config/help/glossary.js": {
      "Main screen": 1,
      "Session panel": 1
    },
    "config/help/host-events.js": {
      "Back to the agenda": 1,
      "Main screen": 1,
      "Session panel": 2
    },
    "config/help/host-reports.js": {
      "Session panel": 2
    },
    "config/help/host-running.js": {
      "Back to Menu": 1,
      "Session panel": 3,
      "Unlock name": 2
    },
    "config/help/host-setup.js": {
      "Main screen": 1,
      "Session panel": 4
    },
    "config/help/host-surveys.js": {
      "Back to Menu": 1
    },
    "config/help/host-two-screens.js": {
      "Feedback": 2,
      "Results": 2,
      "Session panel": 1,
      "Show QR": 1
    },
    "config/help/player.js": {
      "Results": 1
    },
    "config/help/technical.js": {
      "Players": 1,
      "Session panel": 2,
      "Session tools": 1,
      "the summary": 3
    },
    "config/hostControls.js": {
      "Back to Menu": 2,
      "game": 2
    },
    "config/hostRemote.js": {
      "game": 1
    },
    "config/lateWords.js": {
      "Results": 2
    },
    "config/presentStatus.js": {
      "projector": 1
    },
    "config/roomScreen.js": {
      "projector": 15
    },
    "config/roundWords.js": {
      "Back to Menu": 1,
      "Feedback": 1,
      "Results": 1
    },
    "config/setTopics.js": {
      "game": 3
    },
    "config/skins.js": {
      "Presentation": 1
    },
    "config/templateVariables.js": {
      "All players": 1,
      "Results": 6,
      "game": 6,
      "the summary": 1
    },
    "config/topicKeywords.js": {
      "game": 2
    },
    "marketing/HomePage.jsx": {
      "game": 1
    },
    "marketing/components/ClipStill.jsx": {
      "Results": 1
    },
    "present/PresentMoments.jsx": {
      "Feedback": 3,
      "Results": 3
    }
  },
  "helpFalseClaims": {},
  "buttonFamilyNames": [
    "add-set-buttons",
    "adjl-btn",
    "adm-sections-btn",
    "alog-btn",
    "analyze-btn",
    "arch-btn",
    "au-btn",
    "auth-button",
    "bill-btn",
    "btn",
    "category-browse-btn",
    "category-button",
    "category-toggle-btn",
    "close-button",
    "close-modal-btn",
    "continue-btn",
    "corg-btn",
    "create-prompt-btn",
    "dcode-btn",
    "drv-btn",
    "entry-btn",
    "game-action-btn",
    "git-btn",
    "help-back-btn",
    "help-button",
    "help-close-button",
    "help-footer-btn",
    "help-home-btn",
    "help-quick-btn",
    "hrqp-seg-btn",
    "inv-btn",
    "inv__btn",
    "late-btn",
    "lvp-btn",
    "magic-wand-btn",
    "mcmp-btn",
    "mk-btn",
    "mk-report-btn",
    "mobile-minimize-btn",
    "mobile-submit-btn",
    "mode-btn",
    "modq-btn",
    "nbell-btn",
    "obill-btn",
    "ovw-btn",
    "pap-room-btn",
    "pinv-btn",
    "plib-btn",
    "plim-btn",
    "pmode-btn",
    "pobs-btn",
    "porgs-btn",
    "porgs-head-btn",
    "preq-btn",
    "present-strip-btn",
    "primary-action-btn",
    "priv-btn",
    "prompt-buttons",
    "publib-btn",
    "pubshare-btn",
    "qprev-btn",
    "qprev-seg-btn",
    "qsets-btn",
    "quickstart-nav-btn",
    "quickstart-welcome-btn",
    "regenerate-ai-btn",
    "revert-btn",
    "rsc-btn",
    "rshare-btn",
    "scard-btn",
    "schs-btn",
    "scr-seg-btn",
    "select-question-btn",
    "setup-q__btn",
    "sks-btn",
    "smed-btn",
    "srev-btn",
    "start-btn",
    "tab-btn",
    "team-btn",
    "template-buttons",
    "trivia-answer-button",
    "ui-btn",
    "um-btn",
    "ust-btn",
    "variable-btn",
    "vote-btn",
    "vote-buttons",
    "wfs-view-btn"
  ]
};
