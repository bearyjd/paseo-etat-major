# Fixtures

Test data for the planning schema and sanitizer. None of it ships in the package.

## workspace/ (synthetic, written for this repo)
A small invented project, `harbor`, in the exporter's workspace layout (Markdown with YAML frontmatter:
`visions/`, `milestones/`, `features/`, `tasks/`, `research/`, `decisions/`). All text here is original to this repo.
`inputs/prs.json` is a hand-written recorded-pull-request input that gives two tasks open pull requests.

## exports/ (recorded)
Real output of the exporter, not edited by hand. Recorded with etat-major 0.1.0 (commit 1f8125f, which includes the
`etat-major/planning@1` schema marker). Replace the placeholders with absolute paths on your machine.

    PYTHONPATH=<etat-major>/src python3 -m etat_major.cli export planning --json \
      --workspace=<repo>/fixtures/workspace --project=harbor > fixtures/exports/harbor.json

    PYTHONPATH=<etat-major>/src python3 -m etat_major.cli export planning --json \
      --workspace=<repo>/fixtures/workspace --project=harbor \
      --prs=<repo>/fixtures/inputs/prs.json > fixtures/exports/harbor-prs.json

- `harbor.json`: tasks in `done`, `ready`, `draft`, `blocked`.
- `harbor-prs.json`: the same plus `in-progress` (draft PR) and `review` (ready PR), so all six derived states appear.
- The exporter output contains no absolute paths (checked). Neither recording has the optional `meute`,
  `manual_review` or `execution_links` keys; tests add those inline.

## exports/hostile.handcrafted.json (HAND-CRAFTED, not recorded)
Same payload shape, but written by hand to attack the renderer: bidi and C0/C1 control characters, `<script>`,
`[x](javascript:alert(1))`, invisible, tag and variation-selector characters, long combining runs, newline runs, Markdown and HTML, a 10,000-character title, oversized refs. It carries a `_note` key
(stripped by the schema) saying so. It is never produced by the exporter.
