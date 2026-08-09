# Open questions

Genuine forks I could not resolve from the code or the brief. Each one changes
a mockup, not just a sentence.

---

**1. Is there an email that fires when an admin approves an account?**
`RegisterForm` promises *"You'll receive an email once your account is
approved"* and I could not find the pipeline that sends it. I removed the
promise from `13-pending.html` rather than repeat a claim I could not verify.
If it exists, the line goes back and the pending screen becomes *"we will
email you"* instead of *"check back"* — a materially calmer screen. If it does
not, adding it is probably the highest-value backend change in this whole
area, because it converts an indefinite wait into a notification.

**2. What is the real approval turnaround?** The current screen says 24–48
hours. If that is a commitment someone actually makes, say it and I will put a
by-when on `13-pending.html`. If it is aspirational — one admin, checked when
they remember — then the design is right to omit it, and the "nudge your
admin" block is doing the work instead.

**3. Should a device that has signed in before get a sign-in-dominant root
page?** It serves both audiences perfectly on personal laptops and fails
badly on a shared conference-room machine, which is exactly where this product
lives. I left it out. If host laptops are personal in practice, it is worth
maybe fifteen seconds per session for the frequent user.

**4. Which field marks a session as ended?** `05-join-ended.html` needs a
distinct response from `join-game.js` (§7.2 of the rationale). I could not
tell from `join-game.js` whether the end-of-game handler writes `Ended`,
`Status`, `EndedAt`, or only stops broadcasting. Whoever owns `get-results.js`
will know in ten seconds, and the answer decides the shape of the check.

**5. Is there, or can there be, a name-availability check that returns a
boolean?** `07-join-name-collision.html` needs to know "is anyone in this
session already called Chris" without exposing the roster — anyone with a
four-digit code could otherwise enumerate who is in the room. If that endpoint
is not worth building, the fallback is to handle the collision *after* the
join attempt, which is a worse screen but not a bad one.

**6. Four-digit codes are enumerable. Is that accepted?** Ten thousand
possibilities and no rate limit on `POST /games/{id}/players` means a
concurrent session can be found by brute force in seconds, and joining is
public by design. I deliberately did not put a CAPTCHA or a challenge in front
of the join field — taxing forty participants to inconvenience one attacker is
the wrong trade, and the mitigation belongs server-side. But it is a decision
someone should make on purpose: rate-limit by IP, longer codes, or accept it
because sessions are short and the content is not sensitive.

**7. Which password policy is the real one?** Three client validators disagree
(§8.7), and none of them is necessarily the Cognito user pool's actual policy.
The checklist in these mockups uses the permissive rule. Whichever is right,
it needs to be one shared component — the current arrangement lets a password
be valid at reset and rejected at signup.

**8. Are Facebook, Amazon and Apple actually configured?** The brief says yes;
the app has one Google button. If they are live in Cognito, the four-provider
panel in `10-signin.html` is the design and it is a small change. If they are
not, the brief is describing an intention and the panel should be deleted
rather than left as a hostage to fortune.

**9. Does a signed-in host ever need to join a session as a participant?**
Hosts attend each other's sessions. Today `/` sends them to their host page and
`/play` still works, so the path exists but is unsigned. If it is common, the
host page needs a "join someone else's session" affordance; if it is rare, the
URL is enough.

**10. Should the root page carry any product explanation at all?** Right now a
first-time visitor with no code learns nothing about what Engagements is.
That is deliberate — the page is a door, not a brochure — but if `/` is ever a
link someone shares cold, it is the wrong page for that visitor, and the answer
is probably a separate marketing surface rather than diluting this one.
