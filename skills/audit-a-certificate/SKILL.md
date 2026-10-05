---
name: audit-a-certificate
description: Use when someone asks whether a coverage claim is trustworthy or wants to compare two teams' results, because a certificate can be checked for reproducibility rather than taken on faith.
metadata:
  version: 1.0.0
---

# Audit a coverage certificate

## When to use this

Someone has presented a coverage number or a certificate and you need to decide whether it holds
up. A certificate is auditable in a way a slide is not.

## What a certificate proves

1. **The taxonomy it was built from** — `taxonomy_digest` is a hash of the declared capabilities,
   their tiers and their weights. Two teams claiming the same capability list must show the same
   digest. Different digests mean they are not talking about the same thing.
2. **What was selected** — `selected[]` with the facets each probe newly covered, in rank order.
3. **What was redundant** — `redundant[]` holds probes whose every capability is already covered
   by the selection. That is a proof of no added value, not a heuristic.
4. **What was missed** — `uncovered[]`. If this array is empty _and_ `budget_exhausted` is false,
   the taxonomy genuinely had nothing left to cover.

## Steps

1. Recompute it — `sandbox-forge plan taxonomies/asi-control-baseline.json --budget 8 --seed 20261005 --json`.
2. Compare `certificate_digest` with the one under review. Identical inputs must give an
   identical digest; that is the whole reproducibility guarantee.
3. Check `coverage.covered + uncovered.length == coverage.facets`. Every capability is either
   covered or named. There is no third bucket.
4. Read `coverage.by_tier`. A global ratio of 80% can hide a tier that is 0% covered, which is
   usually the tier that matters.
5. If outcomes exist, run `sandbox-forge assess <plan_id> --outcomes outcomes.json` and read
   `untested` before `totals`.

## Red flags

- A coverage percentage with no `uncovered` list beside it.
- `budget_exhausted: false` alongside a non-empty `uncovered` — the planner would have kept going,
  so something is wrong.
- A `residual_tier` lower than the declared tier with fewer than roughly 10 clean probes behind
  it. The bound should not have moved that far.
- A certificate whose `taxonomy_digest` does not match the taxonomy in this repository.

## Verify

`sandbox-forge certificates` lists what has actually been committed. A number that appears in a
document but in no certificate has not been produced by the engine.
