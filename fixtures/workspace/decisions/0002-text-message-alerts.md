---
id: 0002
question: >
  Should Harbor send a text message
  for every silent sensor?
status: rejected
decided_on: 2026-10-22
decided_by: human
alternatives:
  - option: One text message per silent sensor
    why_not: |
      Operators would mute the number within days.
      Muted numbers miss real outages.
  - option: One daily summary message
    why_not: It needs a sender service that Harbor does not run.
rationale: >
  Repeated single alerts get ignored,
  and the summary needs new infrastructure.
evidence: [research:0002#f1, research:0002#f2]
---
