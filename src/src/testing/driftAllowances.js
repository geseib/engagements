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
  "buttonFamilies": 111,
  "dialogs": {
    "AdminPage.jsx": 1,
    "GameHostPage.jsx": 7,
    "PlayerPage.jsx": 6,
    "buildroom/BuildCrew.jsx": 3,
    "buildroom/BuildRoomPage.jsx": 2,
    "components/AIScenarioBuilder.jsx": 1,
    "components/AddQuestionsDialog.jsx": 1,
    "components/DiscountCodesPanel.jsx": 2,
    "components/DraftReview.jsx": 1,
    "components/EventDetailsDialog.jsx": 1,
    "components/EventItemDialog.jsx": 1,
    "components/GameReport.jsx": 1,
    "components/NewSetDialog.jsx": 1,
    "components/OrgBillingDrawer.jsx": 1,
    "components/OverviewPanel.jsx": 2,
    "components/PlanRequestDialog.jsx": 1,
    "components/PlanRequestsPanel.jsx": 1,
    "components/PlatformOrgsPanel.jsx": 1,
    "components/PollAIBuilder.jsx": 2,
    "components/QuickstartMenu.jsx": 1,
    "components/SessionsPanel.jsx": 2,
    "components/SurveyAIBuilder.jsx": 2,
    "components/TriviaAIBuilder.jsx": 1,
    "components/UserManagement.jsx": 2
  },
  "closeGlyphs": {
    "components/AIGenerationPromptEditor.jsx": 1,
    "components/AIPromptManager.jsx": 2,
    "components/AddQuestionsDialog.jsx": 1,
    "components/ArchivePanel.jsx": 3,
    "components/AskComposer.jsx": 1,
    "components/AuditLog.jsx": 1,
    "components/CreateOrgDialog.jsx": 1,
    "components/DiscountCodesPanel.jsx": 1,
    "components/DraftReview.jsx": 1,
    "components/EventDetailsDialog.jsx": 1,
    "components/EventItemDialog.jsx": 1,
    "components/GameSetupDialog.jsx": 1,
    "components/HostQuestionSetsDialog.jsx": 2,
    "components/HostReportsDialog.jsx": 1,
    "components/InvoicePanel.jsx": 1,
    "components/IssueReportForm.jsx": 1,
    "components/LeavePlanDialog.jsx": 1,
    "components/ModerationPanel.jsx": 1,
    "components/NewSetDialog.jsx": 1,
    "components/OrgBillingDrawer.jsx": 3,
    "components/PlanRequestDialog.jsx": 1,
    "components/PlanRequestsPanel.jsx": 1,
    "components/PlatformOrgsPanel.jsx": 1,
    "components/PromptOutputSectionsField.jsx": 1,
    "components/PromptReadOnlyView.jsx": 1,
    "components/PromptRepoReview.jsx": 1,
    "components/PublicLibraryPanel.jsx": 2,
    "components/QuestionSetDeleteDialog.jsx": 1,
    "components/QuestionSetEditor.jsx": 1,
    "components/QuestionsPanel.jsx": 2,
    "components/QuickstartMenu.jsx": 1,
    "components/ReportsPanel.jsx": 1,
    "components/ScoreCard.jsx": 2,
    "components/SessionHistoryPanel.jsx": 1,
    "components/SetChooser.jsx": 1,
    "components/SetTopicField.jsx": 1,
    "components/ShareSetDialog.jsx": 1,
    "components/stage/ModelCompare.jsx": 1,
    "components/stage/SessionSetupPanel.jsx": 1,
    "components/ui/fixtures/Dialog.jsx": 1
  },
  "primaryButtons": {
    "BuilderPage.css": 2,
    "HostRemote.css": 1,
    "auth/auth.css": 1,
    "buildroom/BuildRoom.css": 1,
    "components/AIPromptManager.css": 1,
    "components/ArchivePanel.css": 1,
    "components/BillingPanel.css": 1,
    "components/DiscountCodes.css": 1,
    "components/DraftReview.css": 1,
    "components/EventBuilder.css": 1,
    "components/EventsPanel.css": 1,
    "components/FileUploadPrompt.css": 1,
    "components/GameSetupDialog.css": 1,
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
    "components/SessionHistoryPanel.css": 1,
    "components/SetMediaPanel.css": 1,
    "components/SetReviewBanner.css": 1,
    "components/ShareSetDialog.css": 1,
    "components/TeamPanel.css": 1,
    "components/UsageStatsPanel.css": 1,
    "components/UserManagement.css": 1,
    "components/event/HostEventAgenda.css": 1,
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
      "Back to Menu": 1,
      "Display on screen": 1,
      "Players & rounds": 1,
      "Results": 1,
      "big screen": 6,
      "projector": 1
    },
    "PlayerPage.jsx": {
      "Back to the agenda": 1,
      "Feedback": 6,
      "Game ID": 1,
      "Join Game": 2,
      "Main screen": 14,
      "Results": 3,
      "game": 4
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
      "SESSION": 1,
      "game": 1
    },
    "buildroom/BuildSessionPanel.jsx": {
      "Session panel": 1
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
    "components/FeedbackRoundPanel.jsx": {
      "Comment": 1,
      "the summary": 1
    },
    "components/FormatWalkthrough.jsx": {
      "stage": 1
    },
    "components/GameReport.jsx": {
      "Comment": 1,
      "Results": 1,
      "Session reports": 2
    },
    "components/GameSetupDialog.jsx": {
      "Main screen": 1
    },
    "components/GenerationJobPanel.jsx": {
      "game": 2
    },
    "components/HostReportsDialog.jsx": {
      "Your reports": 3
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
    "components/QuestionSetEditor.jsx": {
      "game": 2,
      "the summary": 1
    },
    "components/QuestionSetUploadPanel.jsx": {
      "AI summary": 1,
      "Presentation": 1,
      "game": 1
    },
    "components/QuickstartMenu.jsx": {
      "game": 4
    },
    "components/ReportsPanel.jsx": {
      "the summary": 2
    },
    "components/RoundReport.jsx": {
      "Comment": 2
    },
    "components/SessionHistoryPanel.jsx": {
      "Players": 1,
      "Results": 1,
      "Session reports": 1
    },
    "components/SessionsPanel.jsx": {
      "All sessions": 2,
      "Players": 1
    },
    "components/SiteSkinPanel.jsx": {
      "Presentation": 1
    },
    "components/SkinGallery.jsx": {
      "Results": 1
    },
    "components/event/EventAttendeePage.jsx": {
      "Main screen": 1
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
      "Feedback": 1,
      "game": 1
    },
    "components/stage/WorkieSettings.jsx": {
      "the summary": 1
    },
    "components/survey/SurveyRunner.jsx": {
      "Main screen": 3
    },
    "components/ui/fixtures/Chip.jsx": {
      "Results": 1
    },
    "config/aiAuthoringPrompt.js": {
      "game": 3
    },
    "config/comments.js": {
      "Results": 1,
      "the summary": 1
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
      "Players & rounds": 1,
      "Settings": 2
    },
    "config/help/admin-team.js": {
      "Session reports": 1
    },
    "config/help/ai.js": {
      "Session panel": 1
    },
    "config/help/build-room-claude.js": {
      "Session panel": 2
    },
    "config/help/build-room-participant.js": {
      "Join Game": 1,
      "Main screen": 2,
      "game": 1
    },
    "config/help/build-room.js": {
      "Players": 1,
      "SESSION": 3,
      "Session panel": 11,
      "game": 2,
      "stage": 1,
      "the summary": 1
    },
    "config/help/glossary.js": {
      "Main screen": 1,
      "SESSION": 2,
      "Session panel": 3
    },
    "config/help/host-events.js": {
      "Back to the agenda": 1,
      "Main screen": 1,
      "Session panel": 2
    },
    "config/help/host-reports.js": {
      "Session panel": 2,
      "Session reports": 1
    },
    "config/help/host-running.js": {
      "Back to Menu": 2,
      "SESSION": 3,
      "Session panel": 6,
      "Unlock name": 2
    },
    "config/help/host-setup.js": {
      "Main screen": 1,
      "Session panel": 8
    },
    "config/help/host-surveys.js": {
      "Back to Menu": 1,
      "Session panel": 2
    },
    "config/help/host-two-screens.js": {
      "Back to Menu": 1,
      "Display on screen": 1,
      "Feedback": 2,
      "Players & rounds": 1,
      "Results": 2,
      "Session panel": 1,
      "Show QR": 1
    },
    "config/help/player-events.js": {
      "Back to the agenda": 1,
      "Main screen": 2
    },
    "config/help/player-surveys.js": {
      "Main screen": 1
    },
    "config/help/player.js": {
      "Join Game": 3,
      "Main screen": 18,
      "Results": 1,
      "game": 5
    },
    "config/help/technical.js": {
      "Join Game": 1,
      "Main screen": 1,
      "Players": 1,
      "Session panel": 3,
      "Session tools": 1,
      "game": 3,
      "the summary": 3
    },
    "config/hostControls.js": {
      "Back to Menu": 2,
      "game": 2
    },
    "config/hostRemote.js": {
      "Players": 1,
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
    "config/setupPanel.js": {
      "Players": 1,
      "Settings": 1
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
    "add-option-btn",
    "add-set-buttons",
    "adjl-btn",
    "adm-sections-btn",
    "alog-btn",
    "analyze-btn",
    "arch-btn",
    "au-btn",
    "auth-button",
    "bill-btn",
    "bpl-open-btn",
    "brm-btn",
    "brm-chip--btn",
    "brm-halist-btn",
    "brr-btn",
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
    "evb-btn",
    "evts-btn",
    "game-action-btn",
    "git-btn",
    "gsd-btn",
    "hc-btn",
    "hea-btn",
    "help-back-btn",
    "help-button",
    "help-close-button",
    "help-footer-btn",
    "help-home-btn",
    "help-quick-btn",
    "hr-btn",
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
    "nav-button",
    "nbell-btn",
    "obill-btn",
    "ovw-btn",
    "pap-room-btn",
    "pinv-btn",
    "plib-btn",
    "plim-btn",
    "plr-btn",
    "plr-feedback-btn",
    "pmode-btn",
    "pobs-btn",
    "porgs-btn",
    "porgs-head-btn",
    "preq-btn",
    "present-strip-btn",
    "preset-btn",
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
    "remove-option-btn",
    "revert-btn",
    "rp-btn",
    "rsc-btn",
    "rshare-btn",
    "scard-btn",
    "schs-btn",
    "scr-seg-btn",
    "select-question-btn",
    "set-correct-btn",
    "setup-q__btn",
    "shist__btn",
    "sks-btn",
    "smed-btn",
    "sp-btn",
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
    "wel-btn",
    "wfs-view-btn"
  ]
};
