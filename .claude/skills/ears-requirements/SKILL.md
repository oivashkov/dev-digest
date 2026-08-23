---
name: ears-requirements
description: >-
  Writes testable requirements in EARS (Easy Approach to Requirements
  Syntax) form, in this project's bilingual English/Ukrainian trigger
  convention. Covers the five EARS patterns (Ubiquitous, Event-driven,
  State-driven, Unwanted behavior, Optional feature), the
  `WHEN (КОЛИ) ... shall (shall) ...` bilingual format, and the
  independently-testable-bullet rule. Triggers: "EARS", "acceptance
  criteria", "write a requirement", "testable requirement", "shall
  statement", or authoring the "Acceptance criteria (EARS)" section of a
  `specs/` spec.
---

# ears-requirements

EARS (Easy Approach to Requirements Syntax) is a lightweight grammar for
requirements that separates a trigger/condition from the system's mandatory
response, so a requirement reads unambiguously and is directly testable.
Originated by Alistair Mavin, Philip Wilkinson, Adrian Harwood, and Mark
Novak (Rolls-Royce), presented at IEEE RE'09.

This project layers one local convention on top of standard EARS: every
trigger keyword is written **bilingually** (English + Ukrainian in
parentheses), and `shall` stays bracketed as a fixed mandatory-requirement
marker regardless of the surrounding sentence's language. This is a course
convention, not an EARS requirement itself — the rest of a spec stays plain
English prose; only "Acceptance criteria (EARS)" bullets use this bilingual
form.

## The five patterns

| Pattern | When to use it | Form |
|---|---|---|
| **Ubiquitous** | A requirement that holds always, with no trigger or state | The system **shall (shall)** \<response\>. |
| **Event-driven** | A reaction to something happening | **WHEN (КОЛИ)** \<trigger event\>, the system **shall (shall)** \<response\>. |
| **State-driven** | Behavior that only applies during a state | **WHILE (ПОКИ)** \<state holds\>, the system **shall (shall)** \<response\>. |
| **Unwanted behavior** | A reaction to an undesired condition | **IF (ЯКЩО)** \<unwanted condition\>, **THEN** the system **shall (shall)** \<response\>. |
| **Optional feature** | A requirement that only applies when a feature/flag is on | **WHERE (ДЕ)** \<feature is enabled\>, the system **shall (shall)** \<response\>. |

### Examples

- Ubiquitous: `The system shall (shall) log every authentication attempt.`
- Event-driven: `WHEN (КОЛИ) a user submits the login form, the system
  shall (shall) verify credentials.`
- State-driven: `WHILE (ПОКИ) a sync is in progress, the system shall
  (shall) show progress.`
- Unwanted behavior: `IF (ЯКЩО) credential verification fails three times
  within 60 seconds, THEN the system shall (shall) temporarily lock the
  account.`
- Optional feature: `WHERE (ДЕ) MFA is enabled, the system shall (shall)
  require a TOTP code after the password.`

## Writing rules

- **One bullet, one requirement.** Never chain two behaviors into one
  bullet with "and" — split into two bullets instead. A bullet that can't be
  falsified by a single concrete test case is not done yet.
- **Pick the narrowest pattern that fits.** A requirement phrased as
  Ubiquitous when it actually only applies during a state is untestable in
  isolation — use State-driven instead.
- **The trigger/condition is concrete**, not a restatement of the goal —
  "WHEN (КОЛИ) a user submits the login form" is concrete; "WHEN (КОЛИ) the
  user wants to log in" is not.
- **The response is observable**, from outside the system under spec — a UI
  state, an API response, a stored record, a log entry. Never an internal
  implementation step ("the service shall call the repository") — that
  belongs in a Development Plan, not a spec's Acceptance Criteria.
- **`shall (shall)` is a literal, fixed marker** — do not translate,
  reorder, or drop either half. It exists so any Acceptance Criteria bullet
  is greppable (`grep 'shall (shall)'`) regardless of which trigger pattern
  it uses or what language the rest of the spec is in.

## Anti-patterns

| ✗ | Why it fails | ✓ |
|---|---|---|
| "The system should handle login well." | Not testable — no trigger, no observable response, no `shall`. | `WHEN (КОЛИ) a user submits the login form, the system shall (shall) verify credentials.` |
| "WHEN (КОЛИ) a user logs in, the system shall (shall) verify credentials and create a session and redirect to the dashboard." | Three requirements chained with "and" — one failing case doesn't tell you which behavior broke. | Three separate bullets. |
| "WHEN (КОЛИ) something goes wrong, the system shall (shall) handle it." | Trigger and response are both too vague to test. | Name the actual unwanted condition (Unwanted-behavior pattern) and the actual response. |
| "The service shall (shall) call `UserRepository.findById()`." | Implementation detail, not an observable outcome — belongs in a Development Plan. | State the observable result instead: "the system shall (shall) return the user's profile." |
