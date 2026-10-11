# AI model picker (dev only, staff only), 2026-10-11

Staff can write a round's AI read again with a different model and compare the reads side by side. The room keeps seeing its own read. This is on **dev only**. Test and prod behave exactly as before.

## What staff see

In the Session panel, under **Workie**, on the What We Heard beat:

- **Redo with…** opens a menu of models. Choosing one writes that model's read of the round. The room's read does not change.
- **Compare** opens a dialog with each model's latest read of this round. The reads sit side by side and stack on a narrow window. Under each read is one line: the model, the provider, the seconds it took, tokens in and out, a rough cost, and a note if it fell back to Haiku 4.5.

These two buttons appear only when the server says the picker is on, which means dev and a signed-in member of the Cognito `admins` group. The page never checks the hostname.

## Models

| Catalogue id | Model | Provider | Prefill | Rough $/MTok in / out |
|---|---|---|---|---|
| `bedrock-haiku-4-5` (default) | Claude Haiku 4.5 | Bedrock `us.anthropic.claude-haiku-4-5-20251001-v1:0` | yes | 1 / 5 |
| `bedrock-sonnet-4-6` | Claude Sonnet 4.6 | Bedrock `us.anthropic.claude-sonnet-4-6` | no | 3 / 15 |
| `bedrock-opus-4-6` | Claude Opus 4.6 | Bedrock `us.anthropic.claude-opus-4-6-v1` | no | 5 / 25 |
| `claude-haiku-5-5` | Claude Haiku 5.5 | Anthropic API | no | 0.10 / 0.50 |
| `claude-sonnet-5-5` | Claude Sonnet 5.5 | Anthropic API | no | 2 / 10 |
| `claude-opus-5-5` | Claude Opus 5.5 | Anthropic API | no | 4 / 20 |
| `claude-fable-5-1` | Claude Fable 5.1 | Anthropic API | no | 10 / 50 |

The list lives in `lambda-functions/game/summary-models.js`. Bedrock prices are the Anthropic list prices. Check AWS pricing before you quote one.

Every model gets the same prompt. Haiku 4.5 keeps the prefilled first heading. The other models reject a prefill, so for them one line is added to the end of the prompt asking for that heading, and the reply is checked afterwards: any text before the heading is dropped, and a missing heading is put back. The Bedrock models keep `temperature` 0.7 and `max_tokens` 2048. The Anthropic API models get no `temperature`, because these models reject a non-default value, and they run at effort `low`. Haiku 5.5 and Sonnet 5.5 run with thinking off. Opus 5.5 and Fable 5.1 cannot turn thinking off, so they get `max_tokens` 8192 so that their thinking does not cut the reply short.

## Switching it on and off

- `template-clean.yaml` has the parameter `AiModelPicker` (default `'false'`). The get-ai-summary function reads it as the env var `AI_MODEL_PICKER`.
- `buildspec-dev.yml` passes `AiModelPicker=true`. The test and prod buildspecs never pass it.
- To turn it off on dev, delete that line from `buildspec-dev.yml` and deploy dev.
- With the switch off, the read is written exactly as before: the same Bedrock request, no STS call, no variant rows, and no new attributes. The server ignores `model` and `variants`. `tests/ai-model-picker.js` checks all of this.

## The Anthropic API: Workload Identity Federation, no stored key

No API key is stored anywhere. The function signs in as its own IAM role:

1. It calls AWS STS `GetWebIdentityToken` (audience `https://api.anthropic.com`, RS256, 900 s) at `sts.us-east-1.amazonaws.com`. The request is signed with SigV4 by hand on `node:crypto`, because the game functions have no package.json and the bundler accepts only `@aws-sdk/*` imports there. A test checks the signature against the value `@smithy/signature-v4` computes for the same request.
2. It exchanges that JWT at `POST https://api.anthropic.com/v1/oauth/token` (grant `urn:ietf:params:oauth:grant-type:jwt-bearer`, plus the four ids below) for an access token.
3. It calls Messages with `authorization: Bearer <token>`. The warm container reuses the token until one minute before it expires, then gets a new one. After a 401 it gets a new token once.

No log line, error or stored row contains the JWT, the access token or the role's credentials.

**The federation rule pins this role:** `engagedev-GetAISummaryFunctionRole-bPDTe2cED687`. If the role is renamed or replaced (for example by changing its logical id or by recreating the function), the rule stops matching and every Anthropic API model falls back to Haiku 4.5. Policy edits do not replace the role.

The only new IAM permission is `sts:GetWebIdentityToken` on `*`, on this function's role only. It is `Allow` when `AiModelPicker` is `'true'` and an explicit `Deny` otherwise.

### The owner's setup steps

1. **AWS:** IAM → Account settings → turn on **Outbound web identity federation**. Copy the account's **Get Token Issuer URL** (`https://<uuid>.tokens.sts.global.api.aws`).
2. **Claude Console:** Settings → Workload identity → Connect workload → **AWS**.
   - Issuer: the URL from step 1, with JWKS discovery.
   - Service account: one with the developer role.
   - Rule match: `subject_prefix` = `arn:aws:iam::239601476690:role/engagedev-GetAISummaryFunctionRole-bPDTe2cED687` (the exact ARN, with no `*`). `audience` = `https://api.anthropic.com`. You can also add the claim `aws_account` = `239601476690`.
   - `oauth_scope` = `workspace:inference` if the Console offers it, otherwise `workspace:developer`.
   - `token_lifetime_seconds` = 600, and one workspace.
3. **Give us the four ids.** None of them is secret. Fill them into `buildspec-dev.yml`, which already has empty slots: `ANTHROPIC_FEDERATION_RULE_ID` (`fdrl_…`), `ANTHROPIC_ORGANIZATION_ID` (uuid), `ANTHROPIC_SERVICE_ACCOUNT_ID` (`svac_…`), `ANTHROPIC_WORKSPACE_ID` (`wrkspc_…`). The buildspec passes them to the template parameters `AnthropicFederationRuleId`, `AnthropicOrganizationId`, `AnthropicServiceAccountId` and `AnthropicWorkspaceId`. Each defaults to empty, and an empty one is not passed.
4. **Set a spend limit** on that workspace.

Until all four ids are set, the menu greys out the Anthropic models and shows "Anthropic API not connected". If one is requested anyway, it falls back to Haiku 4.5 with the reason `not-connected`.

## What leaves AWS on the API path

The whole prompt goes to Anthropic. That is every answer in the round, word for word, with names unless the round is anonymous, plus the question, the set's notes and the host's brief. This is why the picker is on dev only and for staff only. The Bedrock models keep everything inside the account.

## Fallback

If the chosen model fails, the read is written by Bedrock Haiku 4.5 exactly as normal, and the row records why in `ModelFallbackReason`:

`not-connected`, `sts-error`, `token-exchange`, `timeout` (100 s per request, inside the function's 300 s), `rate-limit`, `credit`, `overloaded`, `auth` (a second 401), `refusal`, `empty-reply`, `api-error`, `network`, and for Bedrock `access-denied`, `bedrock-validation`, `model-error`.

The existing template fallback (`Fallback` / `FallbackReason`, used when Haiku itself fails or no prompt resolves) is unchanged. It is a separate thing.

## Data

- **The room's read** stays at `QUESTION#<nnn>#AISummary`. A staff request for a model never writes it. While the picker is on, a normal generation also writes these attributes on it: `ModelRequested`, `Provider`, `LatencyMs`, `InputTokens`, `OutputTokens`, `ModelFallbackReason` (when set). `Model` is the model that actually wrote the read.
- **Variants** are stored at `QUESTION#<nnn>#AIVARIANT#<catalogue id>`, one per model, holding that model's latest read. The name deliberately does not contain `#AISummary`, because `create-report.js` collects summaries by that substring. A variant has the same attributes as the read, is encrypted the same way for an org session, has the same 30-day `ttl` as the summary row, and has no `DebugInfo`. While the picker is on, a normal generation also files a copy under `bedrock-haiku-4-5`, so Compare always shows the default read.
- **Routes:** `GET /games/{id}/ai-summary/host?questionId=<nnn>&variants=true` lists the variants (staff only, dev only). `…&generateNew=true&model=<id>` writes one. On the host route, an unknown id returns a 400. The public route still returns a 403 for any generation.
- When a variant finishes, the broadcast is `aiSummaryVariantReady`. When it fails, the broadcast is `aiSummaryVariantError`. The room's `aiSummaryReady` and `aiSummaryError` are not sent for variants. The staff UI polls every 4 s for up to 5 minutes.

## Resources

No new resources. The changes are one template condition, five parameters, env vars, one new policy statement on the existing role (STS), the Opus 4.6 inference profile and foundation-model ARNs added to the existing Bedrock statement, and two new modules in `lambda-functions/game/`.
