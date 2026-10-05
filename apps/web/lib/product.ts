/**
 * The product's identity, in one typed place. The web UI, the health endpoint and the CLI all
 * read their copy from here so a claim is never stated twice in two slightly different ways.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'omitted'
  /** Required for an omitted surface: the surfaces contract says a stated reason, not a shrug. */
  readonly reason?: string
}

export const PRODUCT = {
  name: 'sandbox-forge',
  slug: 'sandbox-forge',
  version: '0.1.0',
  tagline:
    'Declare a capability taxonomy and a probe budget; get the smallest probe suite that provably touches every dangerous capability, and an explicit list of the ones your budget could not reach.',
} as const

export const SURFACES: readonly Surface[] = [
  {
    id: 'cli',
    title: 'CLI',
    summary:
      'taxonomy check / taxonomy list / plan / assess / certificates / tools / doctor / mcp. The load-bearing entry point — every capability is reachable without a browser.',
    status: 'shipped',
  },
  {
    id: 'engine',
    title: 'Deterministic engine (Python)',
    summary:
      'Risk-weighted greedy set cover, exact Clopper–Pearson bounds, taxonomy linting and merge. Pure functions, mypy --strict, 183 tests including property tests and a golden certificate.',
    status: 'shipped',
  },
  {
    id: 'web',
    title: 'Web (this app)',
    summary:
      'Server-rendered. Reads the committed certificate and renders the coverage lattice. Recomputation is not duplicated here on purpose.',
    status: 'shipped',
  },
  {
    id: 'mcp',
    title: 'MCP server + client',
    summary:
      'Seven tools over stdio, every one backed by the same core registry — so the product is a tool provider for other agents, not a private helper.',
    status: 'shipped',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary:
      'Markdown skills loaded from disk with frontmatter validation and a version gate that fails CI on an unbumped body change.',
    status: 'shipped',
  },
  {
    id: 'plugins',
    title: 'Plugin registry',
    summary:
      'Manifest-driven capability packs with priority-based conflict resolution and a registry that reports why each one was accepted or rejected.',
    status: 'shipped',
  },
  {
    id: 'memory',
    title: 'Memory',
    summary:
      'SQLite through the runtime’s own node:sqlite binding — WAL, numbered idempotent migrations, FTS5 search, and a nesting-safe transaction helper. No native addon to build.',
    status: 'shipped',
  },
  {
    id: 'desktop',
    title: 'Desktop shell',
    summary: 'Deliberately not built.',
    status: 'omitted',
    reason:
      'Nothing in this product needs a native process or a local file association. A desktop shell would be a second host for a UI that is fundamentally a report, and a second place for it to be subtly wrong.',
  },
  {
    id: 'tui',
    title: 'Terminal UI',
    summary: 'Deliberately not built.',
    status: 'omitted',
    reason:
      'The lattice is a two-dimensional readout. A TUI would be a strictly worse rendering of it than either the web app or plain `sandbox-forge plan`.',
  },
]

function packageVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), '..', '..', 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return parsed.version ?? PRODUCT.version
  } catch {
    return PRODUCT.version
  }
}

export function resolveVersion(): string {
  return packageVersion()
}
