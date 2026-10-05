# ADR 0004 — Storage uses Node's built-in `node:sqlite`, not a native addon

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The generated architecture calls for SQLite with WAL, numbered idempotent migrations, FTS5 search
and a single `transaction()` helper. The conventional way to get that from Node is
`better-sqlite3`, a native addon.

This repository is built and verified on several machines, including Windows hosts where a C++
toolchain may be absent. A native module adds three failure modes that have nothing to do with the
product: a missing prebuild for the exact Node ABI, a required compiler toolchain, and an install
step whose duration and failure mode are outside the project's control.

That risk was not hypothetical. During this build, `npm install` ran past 15 minutes twice and
produced no lockfile, because `better-sqlite3`'s install script stalled while trying to obtain a
prebuilt binary. Installing with `--ignore-scripts` completed in 17 minutes — long enough to look
like a network problem — and the workaround left the lockfile incomplete.

## Decision

Use `node:sqlite` (`DatabaseSync`), which ships inside the Node runtime. It is unflagged from Node
22.23, which is above this project's `>=22.12.0` floor.

The store keeps every property the architecture asks for:

- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`
- numbered, idempotent, versioned migrations tracked in `PRAGMA user_version`
- FTS5 virtual table for text search
- one `transaction()` helper, with SAVEPOINT-based nesting so a `put()` inside a caller's
  transaction is atomic with it

## Consequences

**Good**

- `npm install` has no native step. It completes in 11 seconds on the machine where it previously
  took over 17 minutes.
- A contributor needs Node and nothing else. No compiler, no prebuild matrix.
- The dependency surface shrinks by one package with a binary payload.

**Bad**

- `node:sqlite` prints an `ExperimentalWarning` on Node 22. It is stable in Node 24, and the
  warning is noisy rather than dangerous. Anyone who finds it intolerable can set
  `NODE_OPTIONS=--no-warnings`; we chose not to hide it globally, because a suppressed warning in
  CI is worse than a visible one.
- `node:sqlite` exposes fewer conveniences than `better-sqlite3`. The lost sugar was `pragma()` and
  an automatic transaction wrapper; both are now explicit in `packages/memory/src/store.ts`, which
  is arguably clearer.
- Rows come back typed as `Record<string, SQLOutputValue>`, so the store casts to its own row
  interface. `better-sqlite3` was more permissive. The cast is contained in one file.

## Alternatives rejected

**`better-sqlite3`, with a documented toolchain prerequisite.** Rejected because the failure mode
is an install that hangs, not an install that explains itself. A product whose first command can
stall for a quarter of an hour on an unrelated machine has a real support cost.

**A pure-TypeScript store (JSONL or a columnar file format).** Seriously considered, since the
novelty axis for this build is `columnar`. Rejected because FTS5, WAL and transactional writes are
load-bearing for the query surface, and re-implementing them would be more code than the addon
ever was. If `node:sqlite` is ever removed from the runtime, this ADR is the place to revisit.

**`sql.js` (SQLite compiled to WebAssembly).** Rejected: the whole database lives in memory, which
silently breaks the durability guarantee a certificate store needs.
