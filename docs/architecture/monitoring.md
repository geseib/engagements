# Monitoring and alerting

A small, general subsystem for "watch a number, tell me when it moves, and
optionally do something about it." Its first customer is a soft daily cap on
SES send volume, but nothing in it is SES-specific.

- **Stack:** `template-monitoring.yaml` — standalone, applied by hand, **once
  per AWS account**
- **Code:** `lambda-functions/monitoring/`
- **Tests:** `tests/monitoring-decide.js` (31 assertions, no AWS required)

---

## Why this exists

SES production access lifted the sandbox limit to the account's full quota,
which is orders of magnitude more than this product needs. **AWS has no API to
set a lower quota than the one you were granted** — you can request an
increase; a decrease is a support case. So a self-service cap has to be built.

The shape of the thing that can be built is: read the trailing 24-hour send
count on a schedule, and flip the account sending switch when it crosses a
line. That makes the cap **approximate by construction** — see
[How approximate](#how-approximate-is-the-cap) — which is the honest trade for
having one at all.

---

## What is watched today

| Monitor | Threshold | Window | On breach |
|---|---|---|---|
| `ses-daily-send-cap` | more than **25** sends | trailing 24h | **Disables SES account sending**, alerts, re-enables automatically once the count falls back under **20** |
| `games-created-per-day` | more than 100 | trailing 24h | *(shipped disabled)* alert only — the worked example for adding your own |

---

## Deploying it

Not on any pipeline. No tag deploys it. Per `CLAUDE.md`, you run this:

```bash
sam deploy --template-file template-monitoring.yaml \
  --stack-name engagemonitoring \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
      AlertEmail=you@example.com \
      AlertPhoneNumber=+15551234567
```

Then **confirm the email subscription** — AWS sends a link, and nothing is
delivered until it is clicked.

Verify it is alive:

```bash
# Should show a recent invocation every 5 minutes
aws logs tail /aws/lambda/engage-monitor-evaluator --since 20m

# Is SES sending currently on?
aws sesv2 get-account --query SendingEnabled
```

### Before you deploy, know this

`sam validate --lint -t template-monitoring.yaml` has **not** been run — the SAM
CLI was not available in the environment this was written in. The template
parses as YAML and its structure is correct, but run the linter before the
first deploy.

---

## How approximate is the cap?

Three things add slack, and they stack:

1. **Evaluation interval.** The default schedule is `rate(5 minutes)`, so the
   cap can be exceeded by whatever can be sent in five minutes.
2. **CloudWatch lag.** SES metrics take a few minutes to appear. The evaluator
   is reading a slightly stale number, always.
3. **Hourly granularity.** The trailing window sums hourly datapoints.

For this product's traffic shape — human-triggered signup and password-reset
mail — a 25 cap should land in the 25–40 range, which is the tolerance this was
built to. **It is not a hard limit and must not be relied on as one.** If you
ever need a true hard cap, the only real mechanism is asking AWS to lower the
account quota.

Tightening `ScheduleExpression` to `rate(1 minute)` narrows the overshoot at
5× the invocation count (still pennies).

---

## Turning things on and off

**Without a deploy** — an SSM parameter overrides the registry:

```bash
# Stop enforcing the SES cap (alerts also stop)
aws ssm put-parameter --name "/engage/monitors/ses-daily-send-cap/enabled" \
  --value "false" --type String --overwrite

# Back on
aws ssm put-parameter --name "/engage/monitors/ses-daily-send-cap/enabled" \
  --value "true" --type String --overwrite
```

An absent or unrecognised value means *no opinion*, and the registry's own
`enabled` wins. A typo cannot silently disable a safety control.

**If the breaker has tripped and you want sending back immediately:**

```bash
aws sesv2 put-account-sending-attributes --sending-enabled
```

The monitor will not fight you: it only ever releases an enforcement **it**
applied, tracked as `enforcedByUs` in its state. If you re-enable by hand, the
monitor records that it no longer owns the switch.

---

## Adding a monitor

Add an object to `lambda-functions/monitoring/monitors.js`. Nothing else.

```js
{
  id: 'my-monitor',              // stable — renaming loses state, costing one
                                 // spurious "tripped" alert
  title: 'Something human-readable',
  enabled: true,
  source: { type: 'cloudwatch', namespace: 'AWS/Foo', metricName: 'Bar',
            statistic: 'Sum', dimensions: [] },
  window: 24 * 60,               // minutes
  threshold: 100,
  comparison: '>',               // > >= < <=
  releaseThreshold: 80,          // optional hysteresis; see below
  renotifyAfterMinutes: 360,     // optional; re-alert while still tripped
  // enforce: { ... }            // OMIT for alert-only. Most monitors should.
  describe: ({ value, threshold }) => `Saw ${value}, expected under ${threshold}.`,
}
```

Two source types exist: `cloudwatch` (sums a metric over the window) and
`dynamodb-count` (counts rows in a partition whose timestamp falls in the
window). Add a third in `sources.js` if you need one.

**`releaseThreshold` is not decoration.** Without it, a value sitting on the
threshold flaps between enforced and released, and every flap is an SMS.

**Enforcement is opt-in and should stay rare.** A monitor with no `enforce`
block cannot change anything in the account — it can only tell you. Every
enforcement verb in `actions.js` must have a `release` that undoes precisely
it; a breaker with no way back is an outage waiting to be noticed.

---

## Caveats, in order of how likely they are to bite

### SNS has its own SMS sandbox — separate from the SES one

Leaving the SES sandbox did **not** leave the SNS SMS sandbox. Until that
account is out of it, SMS is delivered only to phone numbers verified in the
SNS console. US destinations may additionally require a registered origination
number (10DLC / toll-free), and unregistered traffic can be dropped **without
an error visible to the publisher**.

**If SMS never arrives and nothing looks broken, this is why.** The email
subscription is the reliable channel; treat SMS as the fast path, not the
system of record. Send yourself a test:

```bash
aws sns publish --topic-arn <AlertTopicArn> --message "monitoring test"
```

### The breaker is account-wide

`PutAccountSendingAttributes` stops **every** SES sender in the account, not
just the one that ran away. A per-configuration-set switch would be narrower,
but nothing here sends through a configuration set, so there is nothing
narrower to switch off yet. If one is introduced, scope the enforcer to it.

### If Cognito is ever routed through SES, re-read this

Today the Cognito user pool in `template-clean.yaml` has **no
`EmailConfiguration`**, so it uses `COGNITO_DEFAULT` — Amazon's own mailer,
with its own ~50/day cap, which never touches SES. **Nothing in this repo sends
through SES at all.** The cap is a guardrail installed before there is traffic
to guard, which is the good time to install one.

The moment Cognito is pointed at SES, a tripped breaker also blocks
**password-reset and email-verification** messages, and a real user can be
locked out until the trailing count rolls off. That is an acceptable trade for
a runaway loop and a bad one for a busy Monday. Revisit the threshold, and
consider a configuration set so auth mail can be exempted, **as part of that
change** — not after the first lockout.

### A monitor that cannot run looks exactly like a quiet week

`EvaluatorFailureAlarm` watches the evaluator's own error metric and publishes
to the same topic. If the evaluator is erroring, **the SES cap is not being
enforced**, and the alarm is the only thing that will say so.

Per-monitor failures are isolated: one broken monitor cannot stop the others
being evaluated, and its failure is itself alerted rather than swallowed.

### The AWS SDK clients are runtime-provided

`lambda-functions/monitoring/` has no `node_modules`; it relies on the Node 22
Lambda runtime bundling AWS SDK v3 — the same assumption the rest of this repo
already makes, and the same one `RESUME.md` flags for `@aws-sdk/client-s3`. The
four clients are declared in `lambda-functions/package.json` so the intent is
recorded. If a deploy ever fails on a missing module, that is the cause, and
the fix is a `package.json` in the function directory plus `sam build`.

---

## Testing

```bash
node tests/monitoring-decide.js     # 31 passed, 0 failed
```

No AWS access needed — the SDK packages are stubbed by module name, and the
decision core takes no I/O at all.

Every assertion was verified by breaking the implementation and watching it go
red. The mutations checked: dropping the `enforcedByUs` guard so recovery
releases a human's manual disable; removing hysteresis; flipping `>` to `>=`
(a 25-cap becoming a 24-cap); reading one CloudWatch datapoint instead of
summing; and removing per-monitor isolation so one bad monitor takes the
breaker down with it.
