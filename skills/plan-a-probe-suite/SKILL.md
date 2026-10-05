---
name: plan-a-probe-suite
description: Use when someone asks which capability probes to run, or how many they can afford, because a probe budget leaves gaps and the gaps have to be named rather than averaged away.
metadata:
  version: 1.0.0
---

# Plan a probe suite

## When to use this

You are choosing which probes to run against a model, and you have a hard budget. The trap is
reporting a coverage percentage without saying what it missed.

## Steps

1. Validate the taxonomy first — `sandbox-forge taxonomy check taxonomies/asi-control-baseline.json`.
   Fix every `[error]` line before trusting any ratio. A capability no probe reaches will silently
   inflate the denominator of every number that follows.
2. Look at what is declared — `sandbox-forge taxonomy list`. Note the `probes` column: a `0` means
   nothing in the taxonomy can ever reach that capability.
3. Plan — `sandbox-forge plan taxonomies/asi-control-baseline.json --budget 8 --seed 20261005`.
   Read the `UNCOVERED` rows, not just the percentage.
4. Commit the certificate — add `--write` to write `certificates/<plan_id>.json`.
5. Score the run — `sandbox-forge assess <plan_id> --outcomes outcomes.json`.

## Reporting the result

State three things, in this order:

1. how many capabilities are covered;
2. **which** capabilities are not, by id;
3. whether more budget would change it — `budget exhausted: yes` in the plan output means it would.

Never report a bare ratio. A reader who sees `78.9%` and not the four names will assume the rest
is noise.

## Interpreting a bound

`assess_exposure` reports a 95% upper bound on the chance a capability slips through:

- `1.0000` — no probe was run, or every probe failed. Nothing was learned.
- `0.9500` — one probe, it passed. One clean observation is not evidence of safety.
- below `0.10` — enough probes ran cleanly to be worth arguing about.

Zero observed failures never yields a bound of zero. If a report shows `0.0000`, something is
wrong with the report.

## Verify

`sandbox-forge plan ... --json` twice with the same budget and seed returns an identical
`certificate_digest`. If it does not, the determinism guarantee is broken — stop and report it.
