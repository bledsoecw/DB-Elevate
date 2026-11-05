# Decisions

Choices that are not obvious from reading the code, and the reasoning behind
them. Written so that a later change is a decision rather than an accident.

---

## 1. Drafts are private with no exception

**Nobody reads an unsubmitted review.** Not the manager, not HR, not leadership,
not a system administrator.

The alternative — "HR may view in exceptional circumstances" — looks harmless
and destroys the feature. A reviewer who suspects a draft might be read writes
the submitted version from the first keystroke, and the save-as-you-go editor
becomes a liability rather than a convenience. Administrators get progress and
lateness, which is what they actually need to run a cycle.

Same reasoning for private one-on-one notes, which have no role override either.

---

## 2. Historical access resolves against a snapshot, not today's org chart

Launching a cycle copies the manager, job title and department onto
`CycleParticipant`. Access to that review is then decided against the copy.

Without this, promoting someone would hand their new manager every review their
previous manager wrote, and moving someone between departments would silently
revoke access from the person who conducted the assessment. Neither is a
decision anybody made; both would just happen.

`ManagerAssignment` being append-only is the other half: it means "who managed
this person in March 2025" has an answer, rather than being inferred from the
current state.

**Goals deliberately work the other way** and use the owner's *current* chain. A
goal is a live object — if someone's manager changes, the new manager should see
the goal they are now accountable for. A review is a record of a past
assessment; a goal is a commitment in progress.

---

## 3. A missing answer is excluded, never zeroed

A question nobody answered is removed from the numerator *and* the denominator,
and the excluded share is reported as coverage.

The worked example in [SCORING.md](SCORING.md): a section scoring 83.33 with one
question marked not-applicable would score 62.5 if that question counted as the
scale's lowest value. A 21-point penalty for a question the reviewer explicitly
said did not apply. Counting blanks as zeros is the most common way a
performance score lies, and it lies worst about the people whose managers were
least thorough.

The cost is that a score built from three of twenty questions still returns a
number. That is why coverage is reported next to it rather than left implicit.

---

## 4. Confidential and anonymous are different concepts

`CONFIDENTIAL` stores the author and reveals them to HR. `ANONYMOUS` does not
store the author at all.

Most tools use "anonymous" for both, which is a lie in the first case —
someone *can* find out, and the person who wrote it was told otherwise. The two
are labelled distinctly wherever feedback is given, before submission.

`ANONYMOUS` is further restricted to the `HR_ONLY` audience. An unattributable
comment delivered to somebody's manager about a named person is a weapon, not
feedback, and the restriction removes the use case rather than relying on
goodwill.

---

## 5. Anonymous survey responses store no identifier at all

Not encrypted, not hashed, not held in a side table — absent. There is no key to
compromise and no administrator who can be asked nicely.

The consequence accepted in exchange: an anonymous response cannot be withdrawn,
corrected, or excluded after the fact, because there is no way to find it. The
survey interface says so before you answer.

Participation lives on a different row (`SurveyInvitation.completedAt`), which is
what lets reminders stop without linking anyone to an answer.

The audit log records that *a* response was submitted, with no actor. This is the
one place the audit trail is deliberately incomplete, and it is the right trade:
an audit trail that identifies anonymous respondents is a deanonymization tool.

---

## 6. Suppression is withholding, not caveating

Below the threshold, survey results are hidden. They are not shown with a
warning.

A caveat does not un-identify anybody. "Results from 3 respondents — interpret
with caution" still tells a manager of a team of four what their team said.

The complement rule follows from the same logic: hiding exactly one segment
leaves it recoverable by subtraction, so a second is hidden too. And if hiding
leaves a single visible segment, it carries the whole remainder, so the
breakdown goes entirely.

---

## 7. Publishing a template version freezes it

Editing a published version forks a new one by copy. A cycle references a
*version*, never a template.

So a review completed in 2024 shows exactly the questions, scales and weights it
was answered against. Without this, rewording a question would retroactively
change what every past answer was a response to — and the answers would still
look like answers to the new wording.

The weights that compute a score live on the version too, so adjusting weights
for next year cannot move last year's numbers.

A rating scale used by a published version is frozen for the same reason: the
words beside a number are part of what the reviewer answered. Such a scale can
still be renamed or archived; changing the levels is refused with an explanation
and an offer to create a new scale.

---

## 8. System administrator gets no review content

The role that manages accounts, roles, branding and the audit log has no access
to review content, private notes or HR-restricted records. `reportScope()`
returns `SELF` for a system administrator who manages nobody.

Most tools collapse these into one "admin". Splitting them is the most
load-bearing decision in the permission model: the person who can reset
passwords is not thereby entitled to read what their colleagues wrote about each
other. Where one person genuinely needs both, both roles are granted explicitly
and the grant is audited — which is the point of making it deliberate.

The audit log is the one thing both roles can read, and that is intentional: it
holds no review text, no private note and no respondent identity, and HR needs
to be able to answer "who released this review, and when".

---

## 9. Calibration keeps both numbers

A calibrated score never replaces the calculated one. Both are stored, and the
released review shows both plus the reason and the person who decided.

The employee therefore sees that a human changed the number, rather than finding
a score that silently disagrees with its own arithmetic. Every adjustment needs
a written reason; leaving a score unchanged is also recorded as a decision,
which is what makes a finalised session a record of who was discussed rather
than a guess.

There is deliberately no "fit to a curve" action. A distribution target is an
input to a human conversation, not a transformation to apply to people's
records.

---

## 10. Acknowledgement records receipt, not agreement

The interface says so where it is captured.

Conflating the two turns a receipt into a signature on an assessment somebody
may dispute, and makes the acknowledgement rate a meaningless metric because
people withhold it as a protest.

---

## 11. Nothing is e-mailed without two independent conditions

`EMAIL_TRANSPORT_CONFIGURED=true` on the server **and** a provider chosen in the
organization settings. Either alone is not enough.

The setting says what the organization wants; the environment variable says what
the server is permitted to do. A demonstration installation cannot mail a real
employee even if somebody flips the setting, which is the situation this guards
against — the brief was explicit that live employee messaging waits for
authorization.

Messages that were not sent are reported as **held**, never sent. An outbox that
marks an undelivered message as sent is worse than no outbox, because somebody
will believe an employee was told something.

---

## 12. No paid AI from a browser toggle

A paid provider needs `AI_BILLING_APPROVED=true` in the server environment, a
credential there, a non-zero budget, and the switch. Four conditions, one of
which cannot be satisfied from the interface at all.

Enabling a metered service is a spending decision. The screen explains the
requirement and the service refuses it — including against a direct API call.

The mock provider needs none of this, makes no network call, and labels its
output *inside the text* so a fixture cannot be mistaken for a real suggestion
after a copy-and-paste. An unimplemented provider refuses rather than falling
back to the mock, because somebody told "AI is on" should not be reading
placeholder text and believing it.

---

## 13. Launching a cycle is not automated

A scheduled job notifies HR administrators that a cycle is due; a person presses
the button.

Launching creates review assignments for dozens of real people with real
deadlines and sends them all a notification. Automating it means discovering a
misconfigured cycle after everyone has been told.

---

## 14. No charting library

A few hundred lines of SVG with a validated palette. The constraints that matter
— legibility in both themes, accessible colour pairing where no meaning rests on
hue alone, honest axes, stated denominators, a data-table fallback for every
chart — are easier to guarantee in code than to configure around in a library
whose defaults fight most of them.

Chart props are serializable (`valueFormat: 'percent'` rather than a formatter
function) because a function cannot cross the server/client boundary. That
constraint was discovered by the error, not predicted.

---

## 15. Enumerated values are strings, with one source of truth

SQLite has no enums. Values are string columns, defined once in
`src/lib/enums.ts` as `as const` arrays with derived unions, validated by Zod at
every write boundary.

The cost is that a wrong value is caught at the write boundary rather than by the
database. Where a constant is used in a *query filter* it must be typed as the
union — `readonly ParticipantStatus[]` — because that is the case the write
boundary never sees.

A real bug from exactly this: a calibration filter listed `SUBMITTED` and
`IN_APPROVAL`, which are *assignment* statuses, not participant ones. Nothing
errored. The query silently matched only `APPROVED` and left half the eligible
cohort out of every session. Typing the constant turned it into a compile error.

---

## 16. `server-only` is declared, not removed

The marker package throws unless resolved under the `react-server` export
condition, which broke the jobs CLI and the unit tests.

The fix was to declare the condition in both places (`--conditions=react-server`
in the script, `resolve.conditions` in the vitest config) rather than strip the
import from twenty-odd modules. The marker is what stops a server module — and
whatever credential it reads — being pulled into a client bundle. Deleting it to
make a test runner happy would trade a real protection for convenience.

---

## 17. Mutations go through REST, then the page re-renders

Client components call the same REST routes an external caller would, then call
`router.refresh()`.

Two consequences, both deliberate. The permission checks exercised by clicking a
button are exactly the ones an attacker hits, so there is no "the UI does it
differently" gap. And every on-screen count is re-read from the database after a
change, so a number on a page cannot drift from stored data.

The cost is a round trip plus a re-render instead of optimistic local state. For
an application where a wrong count is a correctness problem, that is the right
trade.

---

## 18. Tests call the API, not just the UI

Every access-control test hits the REST route as well as visiting the page.

This is the method, not a detail. `canManageOrgSettings` returned true for
`HR_ADMIN`; every screen correctly refused them, and a direct
`PATCH /api/admin/settings` succeeded — letting an HR administrator rewrite
branding, lower a survey privacy threshold, change the mail provider, or enable a
metered AI service. Only a test that called the route could see it.

Several assertions also passed for the wrong reason and had to be fixed: a URL
predicate that matched `/development/new` as well as a real plan id, and a text
match that found the textarea it had just typed into rather than the saved
record. An assertion that cannot fail is worse than no assertion, because it
reports confidence.
