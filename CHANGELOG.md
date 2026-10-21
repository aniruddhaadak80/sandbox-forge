# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The web-data drift gate (`npm run check:web-data`) now runs in CI, so the web app's copy of
  the taxonomy and the certificate cannot drift from their source unnoticed.

### Fixed

- The web-data drift gate compares content instead of line endings, and `.gitattributes` pins
  the taxonomy, the certificate, and the web snapshot to LF. A snapshot refreshed on a Windows
  clone was reported as stale on CI because Git checked the source out with CRLF there and LF on
  the runner; the provenance digest now names the content, not the machine that produced it.

## [0.1.0] - 2026-01-01

### Added

- The narrow waist: one `Tool` interface and one `ToolRegistry`, reachable from the CLI,
  the web app, the MCP server, and every channel.
- `sandbox-forge doctor` — subsystem probes with a fix hint per failing row.
- The deterministic Python engine, called as a pure function over stdin/stdout.
- The skills catalog with frontmatter validation and a CI version gate.
- The plugin registry with schema validation and priority-based conflict resolution.
- SQLite storage with WAL, numbered migrations, and FTS5 search.
- An MCP server exposing the registry over stdio, plus an MCP client.
- The web workspace, deployed to Vercel, with a real `/api/health` endpoint.

[Unreleased]: https://github.com/aniruddhaadak80/sandbox-forge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aniruddhaadak80/sandbox-forge/releases/tag/v0.1.0
