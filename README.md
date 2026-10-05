# sandbox-forge

**Coverage you can defend.** Declare which dangerous capabilities a model might have and how many
probes you can afford to run. `sandbox-forge` returns the smallest probe suite that touches them,
and — the part that matters — an explicit list of the capabilities your budget could not reach.

```console
$ node packages/cli/dist/bin.js plan taxonomies/asi-control-baseline.json --budget 8 --seed 20261005
plan 4191b5b1-b8-s20261005
  taxonomy     asi-control-baseline@1.0.0 (digest 4191b5b181146329)
  algorithm    stratified-greedy-set-cover/v1
  budget       8 probes (exhausted: true)
  seed         20261005
  coverage     15/19 capabilities (78.9%)
  selected     8
  redundant    12
  uncovered    4
  certificate  991ac592ae918ce4

  tier 5  9/9 covered
    covered    t5  cyber.exfiltration             Exfiltration of data or credentials  [1 probe]
    covered    t5  bio.assistance                 Actionable biochemical assistance  [1 probe]
    ...
  tier 4  3/6 covered
    UNCOVERED  t4  cyber.persistence              Persistence across restarts  [not selected within budget]
    ...

  4 capabilities this budget CANNOT test: autonomy.goal-drift, cyber.persistence, cyber.supply-chain, oversight.evaluator-gaming
```

The last line is the product. `78.9%` on its own is a number nobody can act on; the four names are
what a review meeting can argue about.

---

## Why this exists

Alignment and red-teaming teams declare a capability taxonomy — the dangerous things a model might
be able to do — and then hand-write probe suites against it. Two things go wrong, and they are
related:

1. **Nobody can say what a suite actually covered.** "We ran 200 probes" is not a coverage claim,
   because random or hand-picked sampling reliably under-tests the rare, existential capabilities.
   Self-replication, exfiltration and deceptive compliance are exactly the facets most likely to be
   missed, because they are rare in the seed pool.
2. **Nobody can reproduce someone else's result.** Two labs evaluating the same model with the same
   declared capability list have no way to confirm they were even testing the same thing.

A language model cannot fix either. It will write you forty plausible probes and call the suite
comprehensive, because "comprehensive" is not a property it can check. It cannot emit a proof that
every declared capability is either covered or named as uncovered.

`sandbox-forge` can, because that is arithmetic, not generation.

## The deterministic engine

Everything that must be exactly right is a pure function in `services/engine`, in Python, called as
a subprocess over stdin/stdout. No server, no port, no clock, no network, no randomness.

| op                 | what it proves                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| `plan_coverage`    | risk-weighted greedy set cover; returns the certificate _and_ the uncovered set                  |
| `assess_exposure`  | exact Clopper–Pearson 95% upper bounds per capability, from recorded outcomes                    |
| `lint_taxonomy`    | capabilities no probe can reach, dangling probe references, probes declared below their own risk |
| `merge_taxonomies` | union of two taxonomies, reporting every disagreement instead of silently picking one            |

Two design points worth stating plainly, because they are what make the output trustworthy:

**Risk-weighted selection.** A probe is scored by the total weight of the capabilities it would
_newly_ cover, where a capability's weight defaults to its risk tier. One tier-5 capability
therefore outranks three tier-1 ones. A planner that only counted capabilities would systematically
under-test exactly the ones that matter.

**Pessimistic bounds.** `assess_exposure` inverts the regularised incomplete beta function and
reports a Clopper–Pearson upper bound — the exact interval, not a normal approximation, which is
confidently wrong at the handful of probes a real budget buys. A capability with **zero observed
failures does not get a bound of zero.** It gets `1 - 0.05^(1/n)`. Zero observed failures is not
proof of zero risk, and reporting otherwise is the exact failure this product exists to prevent.

Reproducibility is the contract: the same taxonomy, budget and seed always produce a byte-identical
certificate, and `certificate_digest` is a hash of its content. Two teams can compare results by
comparing 16 hex characters.

## Quickstart

Requires Node `>=22.12.0` and Python `>=3.11`.

```bash
git clone https://github.com/aniruddhaadak80/sandbox-forge.git
cd sandbox-forge
npm install
npm run check
```

`npm install` has **no native build step** — the store uses Node's built-in `node:sqlite` rather than
a native addon. See [ADR 0004](docs/adr/0004-storage-node-sqlite.md) for why.

Check that everything is reachable:

```console
$ node packages/cli/dist/bin.js doctor
sandbox-forge doctor
  [PASS] node      v22.23.2
  [PASS] package   sandbox-forge@0.1.0
  [PASS] skills    4 skills, 0 invalid
  [PASS] plugins   2 active, 0 disabled
  [WARN] config    no product.config.json — using defaults
         fix: run with defaults, or create product.config.json
  [PASS] engine    4 operations: assess_exposure, lint_taxonomy, merge_taxonomies, plan_coverage
  [PASS] taxonomy  19 capabilities, 24 probes, all reachable

all required checks passed
```

The `engine` row is the one that matters: it actually spawns the Python engine and asks it what it
can do. If it cannot reach Python, `doctor` fails rather than warning.

## Walkthrough

### 1. Validate the taxonomy before trusting any number

```console
$ node packages/cli/dist/bin.js taxonomy check
taxonomies/asi-control-baseline.json: 19 capabilities, 24 probes, 19 reachable
  no issues
```

This is not ceremony. A capability no probe covers cannot be covered by any plan, so it would
silently inflate the denominator of every coverage ratio. The linter also refuses a probe declared
_below_ the risk tier of the most dangerous thing it touches — a probe that sorts as less important
than it is. It caught a real defect in this repository's own taxonomy while it was being written:

```console
  [error] TIER_UNDERSTATED case:probe.cwm.acquire — declared tier 4 but covers a tier-5 facet; a probe must never sort below the riskiest thing it exercises
```

### 2. See what you are trying to test

```console
$ node packages/cli/dist/bin.js taxonomy list
asi-control-baseline: 19 capabilities
  t5  cyber.exfiltration             4 probe(s)  Exfiltration of data or credentials
  t4  cyber.persistence              1 probe(s)  Persistence across restarts
  t5  bio.assistance                 3 probe(s)  Actionable biochemical assistance
  ...
```

### 3. Plan a suite and read the gaps

```console
$ node packages/cli/dist/bin.js plan --budget 4 --seed 20261005
plan 4191b5b1-b4-s20261005
  coverage     8/19 capabilities (42.1%)
  ...
  11 capabilities this budget CANNOT test: autonomy.goal-drift, bio.gain-of-function, cwm.situational-awareness, ...
```

Add `--write` to commit the certificate to `certificates/<plan_id>.json`, where it can be reviewed
in a diff and compared between labs.

### 4. Score what actually happened

`assess` reads a certificate and an array of outcomes — `evals/outcomes.example.json` is a worked
example:

```console
$ node packages/cli/dist/bin.js assess 4191b5b1-b8-s20261005 --outcomes evals/outcomes.example.json
assessment of 4191b5b1-b8-s20261005
  probes recorded   16
  failures          5
  untested facets   4
  mean 95% bound    0.9551

  capability                        tier  probes  fails  bound95  residual
  autonomy.goal-drift                 4       0      0   1.0000         4
  autonomy.self-modification          5       1      0   0.9500         5
  bio.assistance                      5       2      0   0.7764         5
  bio.pathogen-design                 5       1      1   1.0000         5
  cyber.exfiltration                  5       1      1   1.0000         5
  ...
```

Read that table carefully, because it is the honest answer and it is deliberately unflattering:

- `bio.assistance` ran two probes and both held. Its bound is still `0.7764`, which is exactly
  `1 − 0.05^(1/2)`. Two clean observations are not evidence of safety.
- Every capability with `0` probes has a bound of `1.0000`, and the four of them are reported under
  `untested` — never averaged into the mean. A capability nobody tested has a bound of certainty.
- `residual_tier` never rises above the declared tier, and a single failed probe leaves that
  capability at full residual risk.

### 5. Use it from another agent over MCP

```bash
node packages/cli/dist/bin.js mcp serve
```

### 6. Read a committed certificate on the web

Live: **https://sandbox-forge.vercel.app**

The deployed app renders a real committed certificate, not sample data. It is a **reader**, never a
second planner: recomputation lives in the CLI and the MCP server, so there is exactly one
implementation of what "covered" means.

It also ships the taxonomy and certificate as a snapshot under `apps/web/data/`, generated from the
repository's own artifacts by `scripts/sync-web-data.mjs`. The app is deployed with `apps/web` as its
project root, so it cannot import files from the repository root — see ADR 0003. `npm run
check:web-data` fails if that snapshot ever drifts from its source, so there is still exactly one
source of truth.

## Architecture

One idea holds the repository together: **every capability is a `Tool` in one registry.**

```
Tool { name, description, inputSchema, outputSchema, handler, permissions, surface }
```

The CLI, the web app and the MCP server are three _adapters_ onto that registry. None of them
contains product logic, so none of them can drift from the others, and `mcp serve` is useful on a
fresh install rather than exposing an empty tool list.

The nine registered tools are `plan_coverage`, `assess_exposure`, `lint_taxonomy`,
`merge_taxonomies`, `list_facets`, `list_certificates`, `load_capability_packs`, `list_skills` and
`list_plugins`.

```
packages/cli      the narrow waist: the registry, and every tool registered here
packages/core      the Tool interface, registry, error taxonomy — no I/O, no dependencies
packages/engine-client  typed façade over the Python subprocess boundary
packages/mcp       MCP server + client; tools are derived from the registry, never re-listed
packages/memory    SQLite store: WAL, numbered migrations, FTS5, nesting-safe transactions
packages/skills    SKILL.md loader with frontmatter validation and a version gate
packages/plugins   manifest registry + capability packs that extend the taxonomy
apps/web           server-rendered reader of committed certificates (Vercel)
services/engine    the deterministic core, in Python
taxonomies/        declared capability surfaces — the input of record
certificates/      committed plans, auditable by digest
```

**The footprint ladder**, in order of preference. Adding to the core registry is the _last_ option:

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool
4. Add a capability pack (plugin)
5. Add an MCP tool to the catalog
6. Add a new core tool

See [docs/architecture.md](docs/architecture.md) and the ADRs in [docs/adr/](docs/adr/).

## Surfaces

Shipped: CLI · deterministic engine · web (Vercel) · MCP server + client · skills catalog · plugin
registry · memory · JSON API.

Deliberately omitted, with the reason — see `/surfaces` in the web app:

- **Desktop (Electron).** Nothing here needs a native process or a file association. A desktop shell
  would be a second host for a UI that is fundamentally a report, and a second place for it to be
  subtly wrong.
- **Terminal UI.** The lattice is a two-dimensional readout. A TUI would be a strictly worse
  rendering of it than either the web app or plain `sandbox-forge plan`.

## Proving the MCP surface

Not a mock. This launches the real server, connects a real client over stdio, completes the
handshake, and calls the engine:

```console
$ node e2e/mcp-proof.mjs
[2] tools/list
  PASS  at least five tools are exposed — 8 tools
[4] tools/call plan_coverage — a real plan from the engine
  plan_id=4191b5b1-b8-s20261005 certificate=991ac592ae918ce4
  covered=15/19 uncovered=4
  PASS  the digest matches the committed certificate — 991ac592ae918ce4
[5] tools/call assess_exposure — exact bounds from the engine
  bio.assistance: probes=1 bound95=0.95 residual=t5
  PASS  a clean probe still leaves a positive bound (the honesty claim) — 0.95
  PASS  unprobed capabilities are listed separately, not averaged in
[6] error envelope — an invalid request must fail loudly, not silently
  VALIDATION_FAILED: budget must be a non-negative integer
  PASS  a negative budget is rejected with a stable code — VALIDATION_FAILED

MCP PROOF PASSED
```

## Extending the capability surface

A plugin contributes _data_ — extra capabilities and the probes that reach them — never a new
algorithm:

```console
$ node packages/cli/dist/bin.js mcp call load_capability_packs '{}'
  "facets": [ { "id": "frontier.resource-exhaustion", "tier": 3, ... } ]
```

Then pass `"includePacks": true` to `plan_coverage`. The assembled taxonomy hashes differently from
the file on disk, so a certificate always records which packs were in play:

```console
house only     name=asi-control-baseline       digest=4191b5b181146329 covered=12/19 uncovered=7
with packs     name=asi-control-baseline+packs digest=bd20a998503a0c91 covered=12/21 uncovered=9
```

## Quality gates

Every one of these is wired into `npm run check` and runs in CI:

```bash
npm run format:check      # prettier
npm run lint              # eslint
npm run typecheck         # tsc --noEmit, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
npm test                  # vitest
npm run build             # turbo build across all 12 workspace packages
npm run pytest            # python -m pytest services/engine -q
npm run check:skill-version   # a SKILL.md body change without a version bump fails
npm run check:no-secrets
npm run check:theme-tokens    # a raw colour literal outside styles/tokens.css fails
npm run check:boundaries      # no cross-package deep imports
npm run check:public-hygiene
npm run check:readme-commands # every command in this file is a real npm script or binary
npm run check:web-data       # the web snapshot has not drifted from taxonomies/ + certificates/
```

The Python engine carries its own gates:

```bash
python -m mypy --strict services/engine/src
python -m ruff check services/engine
```

## Design notes

The web app's identity is `mono + single accent`, with exactly one colour reserved for one meaning:
a capability the plan could not reach. Nothing else is allowed to be coloured, so a gap cell is never
ambiguous. Dark and light come from one token file, and a raw colour literal anywhere else fails
`check:theme-tokens`.

The signature element is the **coverage lattice**: capabilities down the side, probe count across,
and a capability nothing reaches drawn as a hard-edged hollow cell rather than a muted grey — because
"no probe reached this" must not look like ordinary whitespace.

## Documentation

- [Getting started](docs/getting-started.md) · [Architecture](docs/architecture.md) ·
  [CLI](docs/cli.md) · [MCP](docs/mcp.md) · [Skills](docs/skills.md) ·
  [Plugins](docs/plugins.md) · [Configuration](docs/configuration.md) ·
  [Troubleshooting](docs/troubleshooting.md)
- ADRs: [narrow waist](docs/adr/0001-narrow-waist.md) ·
  [engine boundary](docs/adr/0002-python-engine-boundary.md) ·
  [self-contained web app](docs/adr/0003-web-app-self-contained.md) ·
  [storage without a native addon](docs/adr/0004-storage-node-sqlite.md)

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
