---
id: 0001
question: Should Harbor flag sensors that stop reporting?
status: approved
decided_on: 2026-10-20
decided_by: human
chosen: Flag any sensor with no reading for 24 hours.
alternatives:
  - option: Show raw timestamps only
    why_not: Operators would have to scan every row by eye.
rationale: Silent sensors were the most common first concern.
evidence: [research:0001#f1]
features: [feature:harbor/0001]
---
