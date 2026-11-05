# Privacy

What is protected, how, and — importantly — what these protections do *not*
cover. A privacy promise that overstates itself is worse than one that is
modest and accurate, because people answer honestly on the strength of it.

Implementation: `src/server/surveys/privacy.ts` (pure, 24 unit tests),
`src/server/services/surveys.ts`, `src/server/authz/policy.ts`.

Rule version: **`survey-privacy-v1`**, recorded with every suppression outcome.

## Anonymous surveys

### The promise, stated precisely

> For an anonymous survey, the application does not record who gave which
> answer. Whether you responded is recorded, so reminders can stop and
> participation can be reported. What you said is not linked to you anywhere —
> not in the database, not in the audit log, not in an export.

That is the whole promise. It does not say your manager cannot infer anything
from a small team's results; see *Limits* below.

### Four mechanisms

**1. No identity on the answer.** `SurveyResponse.respondentEmployeeId` is
written as `null` when the survey's mode is `ANONYMOUS`. Not encrypted, not
hashed, not held elsewhere — absent. There is no key to compromise and no
administrator who can be asked nicely.

Participation lives on `SurveyInvitation.completedAt` instead, which is a
different row with no link to any answer. Reminders and participation reporting
work off that.

The audit log records that a response was submitted, against the *survey*, with
no actor id. This is the one place in the application where an audit event is
deliberately incomplete, and it is the right trade: an audit trail that
identifies anonymous respondents is not an audit trail, it is a deanonymization
tool.

**2. A minimum response count.** Nothing is shown until the survey has at least
`threshold` responses. The threshold is `Organization.surveyMinResponses`
(default 5); an individual survey may set a *higher* one for itself but never a
lower one, and an anonymous survey cannot be created with a threshold below 3.

Below threshold, results are **withheld, not shown with a caveat**. A caveat
does not un-identify anybody.

**3. Small-group suppression.** Any segment of a breakdown with fewer than
`threshold` responses is withheld. The suppressed segment's count is returned as
`null`, not as a number the caller might render by accident.

**4. Complement protection.** If exactly one segment were hidden, its count
could be recovered by subtracting the visible ones from the total. So when only
one segment is suppressed, the smallest remaining segment is suppressed too,
leaving at least two unknowns. Controlled by
`Organization.surveySuppressComplement` (default on, and it should stay on).

A further guard: if suppression leaves exactly one visible segment, that segment
carries the entire remainder, which is itself a near-identification — so the
whole breakdown is withheld.

### Filters and cross-tabulation

Cross-tabulating narrows a group much faster than any single filter. For an
anonymous survey:

- **One filter dimension at a time.** Department *or* tenure, never both.
  Combining them is refused with an explanation.
- The filtered group must still meet the threshold.

### Written answers

Verbatim comments are the easiest thing to deanonymize, because wording
identifies people more reliably than demographics. They are shown only when:

- the survey as a whole meets the threshold, **and**
- no filter is applied at all, **and**
- in a shuffled order.

The shuffle is deterministic (`stableShuffle`, seeded on the survey id) so that
reloading the page does not reveal the underlying order by giving a second
sample. Without that, two page loads of a "random" order would narrow things
considerably.

### Exports obey the same rules

The CSV export route calls the same `getResults` function the screen calls, and
suppressed segments export as the suppression label rather than as numbers. This
is a structural property, not a second implementation that has to be kept in
step: there is no code path that produces unsuppressed survey figures.

### Limits — what this does not promise

Honesty about the edges, because these are real:

- **A small team is inherently identifying.** If a crew of four is invited and
  three respond, suppression hides the breakdown — but their manager knows who
  was invited. The application cannot fix the arithmetic of small groups; it can
  only refuse to publish the figures, which it does.
- **Participation is visible.** HR can see that you responded. That is stated in
  the survey interface before you answer, and it is what makes reminders
  possible without nagging people who already took part.
- **Writing identifies you.** If you describe an incident only you were present
  for, the words give you away whatever the database stores. The survey
  interface says so above the free-text box rather than implying that anonymity
  is absolute.
- **A determined administrator with database access** can read the response
  table — but there is nothing in it that links a row to a person, so what they
  learn is the same aggregate everyone else sees.
- **Threshold changes are not retroactive.** Lowering the organization
  threshold does not reveal results previously withheld in an export someone
  already took; it changes what new calculations show. Raising it hides more
  immediately.

## Named surveys

The mode is chosen at creation and shown to respondents before they answer.

**It cannot change afterwards**, and the reason is worth being precise about:
there is no survey edit path in the application at all — no `updateSurvey`
service function and no `PATCH /api/surveys/:id` route. A survey can be created,
launched, closed and reminded, and that is the whole surface. So the mode is
immutable because nothing can edit it, not because an edit is caught and
refused.

That is the right outcome for the mode. Either direction of change would break a
promise already made: switching to named retroactively attributes answers people
gave anonymously, and switching to anonymous implies a protection the stored rows
never had.

It is a genuine limitation for everything else about a survey, though — a typo
in a question means creating the survey again. That is recorded in the README's
limitations and in [EXTENSION-PLAN.md](EXTENSION-PLAN.md); if editing is added
it must refuse to touch `mode` on a survey that has been launched, and should
refuse to touch questions once a single response exists, for the same reason a
published template version is frozen.

## Private notes

A one-on-one note with visibility `PRIVATE`, and feedback with visibility
`PRIVATE_NOTE_SELF`, are visible **to their author and to nobody else**.

- No role overrides this. Not HR. Not a system administrator.
- They are excluded from AI context assembly by the database query, not by
  filtering a result afterwards, so there is no version of that code path that
  can start including them by accident.
- They are not included in any export.
- The audit log records that a note exists, never its content.

This is deliberately absolute. A private note with an HR exception is not a
private note, and a manager who suspects it might be read will write a less
useful note or keep a separate document the application never sees.

## Review drafts

An unsubmitted review is private to its author. Nobody — manager, HR,
leadership, system administrator — reads it. Administrators see progress and
lateness; the words are not theirs until submitted.

This is why the review form's save indicator matters: people need to trust that
saving is not publishing.

## Confidential vs anonymous feedback

Treated as genuinely different concepts, with accurately described behaviour:

| | `CONFIDENTIAL` | `ANONYMOUS` |
|---|---|---|
| Author stored? | **Yes** | **No** |
| Shown to the subject | No | No |
| Shown to the subject's manager | No | No |
| Shown to HR | **Yes** | Impossible — not recorded |
| Audience allowed | Any | `HR_ONLY` only |

*Confidential* means **we know who wrote this and we are not telling you**.
*Anonymous* means **we did not record who wrote this**. Describing the first as
anonymous would be a lie, and it is the lie most performance tools tell.

Anonymous feedback is restricted to the `HR_ONLY` audience on purpose: an
unattributable comment delivered to somebody's manager about a named person is
a weapon, not feedback.

## Improvement plans

A performance improvement plan is a restricted personnel record: the employee,
their direct manager and HR. Not the wider management chain, not leadership, not
a system administrator. `hrRestricted` is forced on at creation and cannot be
relaxed later, because the plan was written on that understanding.

## Attachments

No URL maps to the filesystem. Files sit outside `./public` under opaque
generated keys, and every read re-resolves the owning record's visibility.
Downloads are audited — who read a personnel document is often precisely the
question asked later.

## AI and context

If AI assistance is ever enabled:

- Context is assembled from records the **requesting person** can already read.
  It cannot widen anyone's access.
- **Private notes and anonymous survey responses are excluded outright**, at the
  context-assembly layer, regardless of who is asking. Their protection does not
  depend on a model following instructions.
- Survey data does not appear in any context assembler at all. Feeding verbatim
  comments from a promised-anonymous survey to a third-party service would break
  the promise in the most direct way available, so it is not wired up. If it is
  ever wanted it needs its own design and its own consent language — see
  [EXTENSION-PLAN.md](EXTENSION-PLAN.md).
- Each request stores a digest of exactly what was sent, so an audit can
  demonstrate what left the building without the log holding the content.
- No model output becomes a rating, score, compensation figure or employment
  decision.

By default none of this applies, because AI is off and no feature depends on it.

## What employees are told

`/help/privacy` is written for employees, not administrators. It covers what
their manager can see, what HR can see, what happens to a draft, how anonymous
surveys work and what their limits are, and what acknowledgement means — in
plain language, with no reassurance the code does not actually deliver.
