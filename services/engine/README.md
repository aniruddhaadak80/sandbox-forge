# sandbox_forge

The deterministic engine for [sandbox-forge](../../README.md).

## Why Python

The parts of this product that must be exactly right are code, not generation. Keeping them in a
separate, dependency-free Python package means they can be property-tested in isolation and called
as a pure function — no server, no port, no daemon, no shared state.

A language model can produce a plausible-looking list of forty probes and call the suite
comprehensive. It cannot produce a _certificate_ that every declared capability is either covered
or explicitly named as uncovered, because that is a property of a set-cover solution rather than
a sentence. That is the entire reason this package exists.

## Protocol

One JSON object on stdin, one on stdout (`durationMs` is the only field that varies run to run):

```console
$ echo '{"op":"lint_taxonomy","input":{"taxonomy":{"version":"1.0.0","name":"t","facets":[{"id":"a.one","label":"A","tier":2,"family":"x","weight":2.0}],"cases":[{"id":"c.1","label":"C","tier":2,"covers":["a.one"]}]}}}' | python -m sandbox_forge
{"ok":true,"value":{"ok":true,"issues":[],"facets":1,"cases":1,"reachable":1,"unreachable":[]},"durationMs":7}
```

Errors never raise a traceback. They come back as
`{"ok": false, "error": {"code": "...", "message": "..."}}` so the host can map a stable
code to an exit code or an HTTP status.

## Operations

| op                 | purpose                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `plan_coverage`    | risk-weighted greedy set cover; returns the certificate and the uncovered set |
| `assess_exposure`  | exact Clopper–Pearson 95% upper bounds per capability from recorded outcomes  |
| `lint_taxonomy`    | unreachable capabilities, dangling probes, understated risk tiers             |
| `merge_taxonomies` | union two taxonomies, reporting every disagreement rather than picking one    |

### The certificate

`plan_coverage` returns more than a probe list:

- `selected[]` — the probes, in rank order, each with the capabilities it _newly_ covered;
- `redundant[]` — probes every facet of which is already covered, i.e. provably no added value;
- `uncovered[]` — capabilities this budget cannot test, named explicitly;
- `coverage.by_tier` — because an 80% global ratio can hide a tier that is 0% covered;
- `taxonomy_digest` / `certificate_digest` — sha256 over a canonical form, so two teams can prove
  they ran the same thing.

Same taxonomy + same budget + same seed ⇒ byte-identical output. That is what makes a result
auditable rather than merely plausible.

### Why exact bounds

`assess_exposure` inverts the regularised incomplete beta function and reports a Clopper–Pearson
upper bound. With the handful of probes a real budget buys, a normal approximation is confidently
wrong. A facet with zero observed failures gets `1 - 0.05^(1/n)`, never `0` — zero observed
failures is not proof of zero risk, and that distinction is the product's whole claim.

## Rules for anything added here

1. Pure. No clock, no network, no randomness, no filesystem.
2. Time and entropy are arguments, never reads.
3. Typed input and output via `TypedDict` or dataclasses.
4. One named operation per entry point, registered in `OPERATIONS`.
5. `mypy --strict` clean.
6. A new rule gets a test that would fail if the rule were removed, and a property test if it has
   an invariant.

## Development

```bash
python -m pytest services/engine -q        # tests, including property tests
python -m mypy --strict services/engine/src   # type gate
python -m ruff check services/engine      # lint gate
```

Regenerating the golden certificates is deliberate, never automatic:

```bash
python -m pytest services/engine/tests/test_golden.py --update-golden
```

Copyright 2026 aniruddhaadak80. Licensed under the Apache License 2.0.
