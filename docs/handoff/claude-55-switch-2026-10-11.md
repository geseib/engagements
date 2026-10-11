# Claude models switch: Anthropic 5.5 by default, Bedrock 4.x as the fallback (2026-10-11)

The owner, 2026-10-11: "I want 5.5 to be the default API call in the session. I want the
option to set these in the admin pages. A direct switch: if Sonnet 4.6 go to Sonnet 5.5, if
Haiku 4.5 go to Haiku 5.5. For now set this at the Engage level for everyone."

Branch `working/build-room-host-redesign`. Nothing has been pushed or deployed.

## What the switch does

One platform setting, for every team and for Engage's own calls. When it is on and the tier
is connected to the Anthropic API:

| Bedrock model (today) | Goes to (Anthropic API) |
|---|---|
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | `claude-haiku-5-5` |
| `us.anthropic.claude-sonnet-4-6` | `claude-sonnet-5-5` |
| anything else (Opus 4.6 in the staff picker, the Bedrock guardrail) | unchanged, Bedrock |

When it is off, or the tier is not connected, every call goes to Bedrock with the request
it always sent.

- **Code:** `lambda-functions/game/claude-route.js`, copied byte for byte into
  `lambda-functions/admin/shared/claude-route.js`. The sign-in client is
  `anthropic-messages.js`, copied the same way. `tests/claude-55-switch.js` fails the
  build if either pair drifts.
- **Storage:** one row, `PK PLATFORM#SETTINGS`, `SK CLAUDE_MODELS`, field `Anthropic55`
  (boolean), plus `UpdatedAt` and `UpdatedBy`. **No row means on.** Each warm function reads
  the row at most once a minute. If the read fails, the function keeps the last value it
  knew, or on if it never had one. A tier with no federation ids never reads the row.
- **Route:** `GET` and `POST /platform/settings/claude-models` on the existing
  PlatformOrgsFunction (`lambda-functions/admin/orgs/platform-settings.js`). The route is
  staff only twice over: `authorizer.js` requires `['admins']`, and the handler checks
  `isPlatformAdmin` again. A change writes `recordAudit` first (action
  `platform.claude-models`, staff-only `PLATFORM#AUDIT`). If that write fails, the handler
  returns 503 and changes nothing. If the tier is not connected, `POST` returns 409.
- **Admin page:** Engage mode, a new last item in the Engage group called **Engage
  settings** (`src/src/components/ClaudeModelsPanel.jsx`). It holds one switch. If the
  tier is not connected, the switch is disabled and the page says: "Anthropic API not
  connected on this tier." The design is in `docs/design/claude-55-switch/index.html`. I
  measured it at 660px and 375px with no sideways scroll.
- **Model recorded:** the round's read writes `Model` as the model that actually wrote it
  (`claude-haiku-5-5`, or the Bedrock id after a fallback). The prompt advisor's
  `modelUsed` does the same.

## Call sites, and how the request changes on the API path

| Site | Bedrock model | Prefill | temperature | Tools | Time on the API before falling back |
|---|---|---|---|---|---|
| `game/get-ai-summary.js` (round's read, default only) | Haiku 4.5 | `## <heading>` → asked for in words, checked, cut off | 0.7 dropped | none | 100s (of 300s) |
| `game/get-results.js` (wavelength merges) | Haiku 4.5 | none | 0 dropped | none | 60s |
| `game/draft-briefing.js` | Haiku 4.5 | `{` → asked for in words, checked, cut off | 0.2 dropped | none | 12s (of 29s) |
| `admin/ai-generate-prompt.js` | Haiku 4.5, then Sonnet 4.6 | none | 0.7 dropped | none | 15s per ask (of 60s) |
| `admin/ai-prompt-advisor.js` | Sonnet 4.6, then Haiku 4.5 | none | 0.2 / 0.7 dropped | none | 300s (of 900s), effort medium |
| `admin/shared/structured-generation.js` (questions, trivia, polls, survey, scenarios, set metadata, builder form) | Sonnet 4.6, then Haiku 4.5 | none | 0.7 dropped | forced `tool` → `auto` plus a sentence naming the tool; a reply without that tool call falls back | 240s |
| `admin/shared/finding-explanations.js` (set check) | Haiku 4.5 | none | 0.2 dropped | none | 20s |
| `admin/shared/topic-suggestion.js` (set check) | Haiku 4.5 | none | 0 dropped | none | 20s |

Every API request also:

- drops `anthropic_version`;
- turns thinking off the way each model accepts it: `{type:"disabled"}` on Haiku 5.5 and
  `{type:"between_tools"}` on Sonnet 5.5, which rejects `disabled`;
- sets `output_config.effort` to `low` (`medium` for the advisor);
- raises `max_tokens` to 1.5 times the original plus 256, capped at 32,000, because the 5.5
  tokenizer counts the same text as about 30% more tokens.

Thinking blocks are never passed back to the caller.

`admin/shared/content-guardrail.js` sends no model call. It calls Bedrock Guardrails
(`ApplyGuardrailCommand`) and is unchanged.

The staff model picker on the round's read is never switched. A model that staff pick
explicitly, including Bedrock Haiku 4.5, is called as picked. The picker is now on for
test as well as dev.

## Failure and fallback rules

The request goes to the original Bedrock model, using the original command, when any of
these happens:

- the tier is not connected;
- STS fails;
- the token exchange fails;
- the API returns an HTTP error (including 429, 529, out of credit, or any 400);
- the call overruns its time budget (sign-in included);
- the reply is a refusal (`stop_reason: refusal`);
- the reply is cut off (`stop_reason: max_tokens`);
- the reply is empty;
- the reply is missing the required tool call;
- the reply does not begin with the prefill.

Each fallback logs one warning in this form:
`{"event":"claude-route-fallback","site","model","fallback","reason","status","ms"}`.
The warning never contains a token, the prompt or the reply. A successful call logs
`{"event":"claude-route","site","model","ms","stopReason","outputTokens"}`.

## Template and tiers

- The new condition `AnthropicApiConfigured` is true only when all four federation ids
  are set. It replaces `AiModelPickerOn`.
- `sts:GetWebIdentityToken` (Allow if `AnthropicApiConfigured`, Deny otherwise) and the
  four `ANTHROPIC_*` environment variables go to the thirteen functions whose code calls a
  model. The test derives that list from the require graph:
  - CheckQuestionSet
  - GetResults
  - GetAISummary
  - DraftBriefing
  - AdminAIGenerateQuestions
  - AdminAIDraftSetMetadata
  - AdminAIDraftBuilderForm
  - AdminAIGenerateScenarios
  - AdminAIGenerateTrivia
  - AdminAIGeneratePolls
  - AdminAIGenerateSurvey
  - AdminAIPromptAdvisor
  - AdminAIGeneratePrompt
- DraftBriefing and AdminAIGeneratePrompt had no table policy. Each now has `dynamodb:GetItem`
  limited to the `PLATFORM#SETTINGS` leading key.
- PlatformOrgsFunction gets the four ids so it can report whether the tier is connected.
  It has no STS grant. It also gets two HttpApi events, GET and POST.
- The template has the same top-level resources as before. After the SAM transform, the
  two new events add two `AWS::Lambda::Permission` resources.
- **dev:** unchanged ids. The switch is on there as soon as this is deployed.
- **test:** `AiModelPicker=true`, organization `19cbae90-…`, service account
  `svac_012zQiYAvkDEUJBXDX7uA5TS`, workspace `wrkspc_01Fxxn28qBVFs6uYyoccyngL`. The
  federation rule id is **empty** until the owner creates the test rule, so test stays on
  Bedrock until then.
- **prod:** untouched, and stays on Bedrock.

The role names were checked read-only on 2026-10-11:

- All thirteen roles on both tiers are `engagedev-<Function>Role-…` and
  `engagetest-<Function>Role-…`.
- Each stack has 119 roles, and every one is a function role.
- The retired twin's roles are `engdev-…`, and prod's are `engageprod-…`. Neither matches
  `engagedev-*` or `engagetest-*`.

## What the owner must do (Claude Console)

1. **Dev rule:** open the existing federation rule `fdrl_01Fgi2W7zco8f1k4HAPabtzn`. Change
   its subject from the single GetAISummaryFunction role ARN to
   `arn:aws:iam::239601476690:role/engagedev-*`. Until you do, only the round's read can
   sign in on dev. Every other call fails at the token exchange and falls back to Bedrock,
   which is safe.
2. **Test rule:** create a federation rule with subject
   `arn:aws:iam::239601476690:role/engagetest-*`. Use the same audience
   (`https://api.anthropic.com`), scope, token lifetime and workspace
   (`wrkspc_01Fxxn28qBVFs6uYyoccyngL`), and the same service account
   (`svac_012zQiYAvkDEUJBXDX7uA5TS`). Put its id in `buildspec-test.yml`
   (`ANTHROPIC_FEDERATION_RULE_ID=""`), then deploy test.
3. **Prod:** nothing to do. Prod stays on Bedrock.

To turn the switch off on a tier, sign in as staff and go to Engage mode → Engage settings.
