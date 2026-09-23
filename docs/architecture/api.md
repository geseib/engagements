# HTTP API surface

**Generated from `template-clean.yaml` — do not hand-edit.**
Regenerate with `node scripts/generate-api-doc.js`.

The template is the only description of these routes that cannot drift from
them, so it is the only source this doc will accept. The hand-written file it
replaced documented an `/api/…` prefix no route ever had, three handlers that
were already dead, and five files that did not exist.

133 routes across 7 groups. 115 carry the Cognito authorizer; 18 are public.

`public` means no authorizer **on the route**. Several public routes still
enforce rules in the handler: the participant journey carries no token by
design, so those checks live in code. See `callerMayDriveSession` in
`lambda-functions/game/tenant.js`, and note that `get-results.js` serves one
public route and one authenticated route from the same handler, discriminating
on `requestContext.routeKey`.

## /games

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/games` | **Cognito** | `lambda-functions/game/get-games-list.js` |
| POST | `/games` | **Cognito** | `lambda-functions/websocket/create-game.js` |
| GET | `/games/{gameId}` | public | `lambda-functions/game/get-game.js` |
| PUT | `/games/{gameId}` | **Cognito** | `lambda-functions/game/update-game.js` |
| POST | `/games/get-results` | public | `lambda-functions/game/get-results.js` |
| GET | `/games/{gameId}/ai-summary` | public | `lambda-functions/game/get-ai-summary.js` |
| GET | `/games/{gameId}/answers` | public | `lambda-functions/game/get-answers.js` |
| POST | `/games/{gameId}/close-round` | **Cognito** | `lambda-functions/game/get-results.js` |
| GET | `/games/{gameId}/comments` | public | `lambda-functions/game/comments.js` |
| POST | `/games/{gameId}/comments` | public | `lambda-functions/game/comments.js` |
| GET | `/games/{gameId}/exclusions` | **Cognito** | `lambda-functions/game/question-exclusions.js` |
| POST | `/games/{gameId}/exclusions` | **Cognito** | `lambda-functions/game/question-exclusions.js` |
| GET | `/games/{gameId}/feedback-round` | public | `lambda-functions/game/comments.js` |
| POST | `/games/{gameId}/next-question` | **Cognito** | `lambda-functions/game/next-question.js` |
| PUT | `/games/{gameId}/persona` | **Cognito** | `lambda-functions/game/update-game-persona.js` |
| GET | `/games/{gameId}/players` | public | `lambda-functions/game/get-players.js` |
| POST | `/games/{gameId}/players` | public | `lambda-functions/game/join-game.js` |
| PUT | `/games/{gameId}/prompt` | **Cognito** | `lambda-functions/game/update-game-prompt.js` |
| GET | `/games/{gameId}/question` | public | `lambda-functions/game/get-question.js` |
| GET | `/games/{gameId}/queue` | **Cognito** | `lambda-functions/game/question-queue.js` |
| POST | `/games/{gameId}/queue` | **Cognito** | `lambda-functions/game/question-queue.js` |
| GET | `/games/{gameId}/report` | public | `lambda-functions/game/get-report.js` |
| POST | `/games/{gameId}/report` | **Cognito** | `lambda-functions/game/create-report.js` |
| POST | `/games/{gameId}/reveal-authors` | **Cognito** | `lambda-functions/game/reveal-authors.js` |
| POST | `/games/{gameId}/save-report` | **Cognito** | `lambda-functions/game/save-report.js` |
| POST | `/games/{gameId}/stage-beat` | **Cognito** | `lambda-functions/game/stage-beat.js` |
| POST | `/games/{gameId}/stage-focus` | **Cognito** | `lambda-functions/game/stage-focus.js` |
| POST | `/games/{gameId}/start` | **Cognito** | `lambda-functions/game/start-game.js` |
| POST | `/games/{gameId}/start-question` | **Cognito** | `lambda-functions/websocket/start-question.js` |
| POST | `/games/{gameId}/start-vote` | **Cognito** | `lambda-functions/websocket/start-vote.js` |
| GET | `/games/{gameId}/state` | public | `lambda-functions/game/get-game-state.js` |
| POST | `/games/{gameId}/toggle-category` | **Cognito** | `lambda-functions/game/toggle-category.js` |
| GET | `/games/{gameId}/up-next` | **Cognito** | `lambda-functions/game/up-next.js` |
| GET | `/games/{gameId}/votes` | public | `lambda-functions/game/get-votes.js` |
| POST | `/games/{gameId}/votes` | public | `lambda-functions/game/submit-vote.js` |
| GET | `/games/{gameId}/report/download` | public | `lambda-functions/game/download-report.js` |
| GET | `/games/{gameId}/state/{playerId}` | public | `lambda-functions/game/get-game-state.js` |
| POST | `/games/{gameId}/comments/{commentId}/feature` | **Cognito** | `lambda-functions/game/comments.js` |
| POST | `/games/{gameId}/players/{playerName}/handover` | **Cognito** | `lambda-functions/game/grant-handover.js` |
| POST | `/games/{gameId}/players/{playerName}/handover-request` | public | `lambda-functions/game/request-handover.js` |
| POST | `/games/{gameId}/players/{playerName}/remove` | **Cognito** | `lambda-functions/game/remove-player.js` |

## /invites

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/invites` | **Cognito** | `lambda-functions/admin/orgs/list-my-invites.js` |
| POST | `/invites/{token}/accept` | **Cognito** | `lambda-functions/admin/orgs/accept-invite.js` |

## /orgs

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/orgs` | **Cognito** | `lambda-functions/admin/orgs/list-my-orgs.js` |
| POST | `/orgs` | **Cognito** | `lambda-functions/admin/orgs/create-org.js` |
| GET | `/orgs/{orgId}` | **Cognito** | `lambda-functions/admin/orgs/get-org.js` |
| GET | `/orgs/{orgId}/adjustments` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
| POST | `/orgs/{orgId}/invites` | **Cognito** | `lambda-functions/admin/orgs/invite-member.js` |
| GET | `/orgs/{orgId}/invoices` | **Cognito** | `lambda-functions/admin/get-usage.js` |
| GET | `/orgs/{orgId}/members` | **Cognito** | `lambda-functions/admin/orgs/list-members.js` |
| GET | `/orgs/{orgId}/plan-requests` | **Cognito** | `lambda-functions/admin/orgs/plan-requests.js` |
| POST | `/orgs/{orgId}/plan-requests` | **Cognito** | `lambda-functions/admin/orgs/plan-requests.js` |
| GET | `/orgs/{orgId}/usage` | **Cognito** | `lambda-functions/admin/get-usage.js` |
| DELETE | `/orgs/{orgId}/invites/{token}` | **Cognito** | `lambda-functions/admin/orgs/revoke-invite.js` |
| GET | `/orgs/{orgId}/invoices/{period}` | **Cognito** | `lambda-functions/admin/get-usage.js` |
| DELETE | `/orgs/{orgId}/members/{sub}` | **Cognito** | `lambda-functions/admin/orgs/remove-member.js` |
| DELETE | `/orgs/{orgId}/plan-requests/{reqId}` | **Cognito** | `lambda-functions/admin/orgs/plan-requests.js` |
| PUT | `/orgs/{orgId}/members/{sub}/role` | **Cognito** | `lambda-functions/admin/orgs/change-member-role.js` |

## /question-sets

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/question-sets` | **Cognito** | `lambda-functions/game/get-question-sets.js` |
| POST | `/question-sets/{setId}/appeal` | **Cognito** | `lambda-functions/admin/appeal-question-set.js` |
| GET | `/question-sets/{setId}/categories` | **Cognito** | `lambda-functions/game/get-categories.js` |
| POST | `/question-sets/{setId}/check` | **Cognito** | `lambda-functions/admin/check-question-set.js` |
| POST | `/question-sets/{setId}/copy` | **Cognito** | `lambda-functions/admin/copy-question-set.js` |
| DELETE | `/question-sets/{setId}/publish` | **Cognito** | `lambda-functions/admin/publish-question-set.js` |
| POST | `/question-sets/{setId}/publish` | **Cognito** | `lambda-functions/admin/publish-question-set.js` |
| GET | `/question-sets/{setId}/questions` | **Cognito** | `lambda-functions/admin/get-question-set-questions.js` |
| GET | `/question-sets/{setId}/check/{jobId}` | **Cognito** | `lambda-functions/admin/check-question-set.js` |

## /reports

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/reports` | **Cognito** | `lambda-functions/game/get-reports.js` |
| GET | `/reports/download` | **Cognito** | `lambda-functions/game/download-saved-report.js` |

## /admin

| Method | Path | Auth | Handler |
|---|---|---|---|
| POST | `/admin/ai-draft-builder-form` | **Cognito** | `lambda-functions/admin/ai-draft-builder-form.js` |
| POST | `/admin/ai-draft-set-metadata` | **Cognito** | `lambda-functions/admin/ai-draft-set-metadata.js` |
| POST | `/admin/ai-generate-polls` | **Cognito** | `lambda-functions/admin/ai-generate-polls.js` |
| POST | `/admin/ai-generate-prompt` | **Cognito** | `lambda-functions/admin/ai-generate-prompt.js` |
| POST | `/admin/ai-generate-questions` | **Cognito** | `lambda-functions/admin/ai-generate-questions.js` |
| POST | `/admin/ai-generate-scenarios` | **Cognito** | `lambda-functions/admin/ai-generate-scenarios.js` |
| POST | `/admin/ai-generate-survey` | **Cognito** | `lambda-functions/admin/ai-generate-survey.js` |
| POST | `/admin/ai-generate-trivia` | **Cognito** | `lambda-functions/admin/ai-generate-trivia.js` |
| POST | `/admin/ai-prompt-advisor` | **Cognito** | `lambda-functions/admin/ai-prompt-advisor.js` |
| GET | `/admin/ai-prompts` | **Cognito** | `lambda-functions/admin/get-ai-prompts.js` |
| POST | `/admin/ai-prompts` | **Cognito** | `lambda-functions/admin/create-ai-prompt.js` |
| POST | `/admin/clear-all-games` | **Cognito** | `lambda-functions/admin/clear-all-games.js` |
| POST | `/admin/create-github-issue` | public | `lambda-functions/admin/create-github-issue.js` |
| GET | `/admin/download-template` | **Cognito** | `lambda-functions/admin/download-template.js` |
| POST | `/admin/export-to-archive` | **Cognito** | `lambda-functions/admin/export-to-archive.js` |
| POST | `/admin/import-from-archive` | **Cognito** | `lambda-functions/admin/import-from-archive.js` |
| GET | `/admin/moderation` | **Cognito** | `lambda-functions/admin/moderation-list.js` |
| POST | `/admin/parse-document` | **Cognito** | `lambda-functions/admin/parse-document.js` |
| GET | `/admin/personas` | **Cognito** | `lambda-functions/admin/get-personas.js` |
| POST | `/admin/populate-defaults` | **Cognito** | `lambda-functions/admin/populate-defaults.js` |
| GET | `/admin/question-sets` | **Cognito** | `lambda-functions/admin/get-question-sets.js` |
| POST | `/admin/upload-questions` | **Cognito** | `lambda-functions/admin/upload-questions.js` |
| GET | `/admin/ai-draft-builder-form/{jobId}` | **Cognito** | `lambda-functions/admin/ai-draft-builder-form.js` |
| GET | `/admin/ai-draft-set-metadata/{jobId}` | **Cognito** | `lambda-functions/admin/ai-draft-set-metadata.js` |
| GET | `/admin/ai-generate-polls/{jobId}` | **Cognito** | `lambda-functions/admin/ai-generate-polls.js` |
| GET | `/admin/ai-generate-questions/{jobId}` | **Cognito** | `lambda-functions/admin/ai-generate-questions.js` |
| GET | `/admin/ai-generate-scenarios/{jobId}` | **Cognito** | `lambda-functions/admin/ai-generate-scenarios.js` |
| GET | `/admin/ai-generate-survey/{jobId}` | **Cognito** | `lambda-functions/admin/ai-generate-survey.js` |
| GET | `/admin/ai-generate-trivia/{jobId}` | **Cognito** | `lambda-functions/admin/ai-generate-trivia.js` |
| DELETE | `/admin/ai-prompts/{promptId}` | **Cognito** | `lambda-functions/admin/delete-ai-prompt.js` |
| PUT | `/admin/ai-prompts/{promptId}` | **Cognito** | `lambda-functions/admin/update-ai-prompt.js` |
| POST | `/admin/ai-prompts/save` | **Cognito** | `lambda-functions/admin/create-ai-prompt.js` |
| GET | `/admin/archive/items` | **Cognito** | `lambda-functions/admin/archive-items.js` |
| POST | `/admin/archive/search` | **Cognito** | `lambda-functions/admin/archive-items.js` |
| POST | `/admin/clear-game/{gameId}` | **Cognito** | `lambda-functions/admin/delete-game.js` |
| GET | `/admin/download-question-set/{setId}` | **Cognito** | `lambda-functions/admin/download-question-set.js` |
| PUT | `/admin/edit-question-set/{setId}` | **Cognito** | `lambda-functions/admin/edit-question-set.js` |
| GET | `/admin/moderation/{sk}` | **Cognito** | `lambda-functions/admin/moderation-get.js` |
| POST | `/admin/moderation/decide` | **Cognito** | `lambda-functions/admin/moderation-decide.js` |
| DELETE | `/admin/public-library/{publicSetId}` | **Cognito** | `lambda-functions/admin/public-library-item.js` |
| GET | `/admin/public-library/{publicSetId}` | **Cognito** | `lambda-functions/admin/public-library-item.js` |
| DELETE | `/admin/question-sets/{setId}` | **Cognito** | `lambda-functions/admin/delete-question-set.js` |
| POST | `/admin/toggle-question-set/{setId}` | **Cognito** | `lambda-functions/admin/toggle-question-set.js` |
| POST | `/admin/toggle-quickstart/{setId}` | **Cognito** | `lambda-functions/admin/toggle-quickstart.js` |
| POST | `/admin/users/list` | **Cognito** | `lambda-functions/admin/manage-users.js` |
| DELETE | `/admin/archive/items/{archiveId}` | **Cognito** | `lambda-functions/admin/archive-items.js` |
| GET | `/admin/archive/items/{archiveId}` | **Cognito** | `lambda-functions/admin/archive-items.js` |
| PUT | `/admin/games/{gameId}/categories` | **Cognito** | `lambda-functions/admin/update-game-categories.js` |
| GET | `/admin/question-sets/{setId}/media` | **Cognito** | `lambda-functions/admin/media-status.js` |
| GET | `/admin/question-sets/{setId}/versions` | **Cognito** | `lambda-functions/admin/get-set-versions.js` |
| PUT | `/admin/users/{username}/state` | **Cognito** | `lambda-functions/admin/manage-users.js` |
| POST | `/admin/question-sets/{setId}/media/uploads` | **Cognito** | `lambda-functions/admin/media-upload-urls.js` |
| DELETE | `/admin/question-sets/{setId}/versions/{version}` | **Cognito** | `lambda-functions/admin/delete-set-version.js` |
| POST | `/admin/question-sets/{setId}/versions/{version}/promote` | **Cognito** | `lambda-functions/admin/promote-set-version.js` |

## /platform

| Method | Path | Auth | Handler |
|---|---|---|---|
| GET | `/platform/codes` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
| POST | `/platform/codes` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
| GET | `/platform/orgs` | **Cognito** | `lambda-functions/admin/orgs/platform-orgs.js` |
| GET | `/platform/plan-requests` | **Cognito** | `lambda-functions/admin/orgs/plan-requests.js` |
| POST | `/platform/codes/{code}/retire` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
| GET | `/platform/orgs/{orgId}/adjustments` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
| POST | `/platform/orgs/{orgId}/adjustments` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
| POST | `/platform/orgs/{orgId}/status` | **Cognito** | `lambda-functions/admin/orgs/platform-orgs.js` |
| POST | `/platform/plan-requests/{orgId}/{reqId}/decide` | **Cognito** | `lambda-functions/admin/orgs/plan-requests.js` |
| POST | `/platform/orgs/{orgId}/adjustments/{adjId}/revoke` | **Cognito** | `lambda-functions/admin/orgs/adjustments.js` |
