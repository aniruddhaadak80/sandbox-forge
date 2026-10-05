# Third-party notices

This file is committed so a licence change is visible in a diff rather than discovered during an
audit. It lists every direct runtime dependency and why it is here.

| Component                 | License | Why it is here             |
| ------------------------- | ------- | -------------------------- |
| next                      | MIT     | web framework              |
| react / react-dom         | MIT     | UI runtime                 |
| @modelcontextprotocol/sdk | MIT     | MCP server and client      |
| commander                 | MIT     | CLI parser                 |
| yaml                      | ISC     | skill frontmatter parsing  |
| zod                       | MIT     | plugin manifest validation |

## Notable absences

Two dependencies the usual advice would suggest are deliberately **not** here.

| Would-be dependency | Instead                         | Why                                                                                                                                                                                                        |
| ------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `better-sqlite3`    | Node's built-in `node:sqlite`   | The store needs plain SQL. A native addon would make `npm install` depend on a C++ toolchain or a matching prebuild for every contributor's platform — see `docs/adr/0004-storage-node-sqlite.md`.         |
| `electron`          | nothing — no desktop shell      | No surface of this product needs a native process. See `/surfaces` in the web app for the argument.                                                                                                        |
| `scipy`             | continued-fraction beta in-tree | The engine is called as a subprocess on every plan. Every transitive dependency is startup latency, and the confidence bound is 60 lines of arithmetic (see `services/engine/src/sandbox_forge/stats.py`). |

The Python engine's only runtime dependency is `pydantic`, declared in
`services/engine/pyproject.toml`; the modules themselves use the standard library `TypedDict`s.

## Fonts

No web fonts are bundled. The type stack is a system monospace stack declared in
`apps/web/styles/tokens.css`, so the app renders identically offline and ships no font licences.

Copyright 2026 aniruddhaadak80. Licensed under the Apache License 2.0.
