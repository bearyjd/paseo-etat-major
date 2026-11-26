---
id: 0001
project: harbor
title: Flag silent sensors
problem: A dead sensor looks the same as a quiet one.
outcome: Sensors with no reading for a day are marked as silent in the list.
status: planned
priority: 1
research: [research:0001]
decisions: [decision:0001]
milestones: [milestone:harbor/m1]
tasks: [task:harbor/0001, task:harbor/0002, task:harbor/0003, task:harbor/0004, task:harbor/0005, task:harbor/0006, task:harbor/0007]
acceptance:
  - id: a1
    text: A sensor without a reading for 24 hours shows as silent.
architecture:
  - ref: fp:n:ui.sensorlist
    relation: modifies
  - ref: fp:f:src/sensors/last_seen.py
    relation: new
---
