import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import {
  ForgeEngine,
  listCertificates,
  loadCertificate,
  loadTaxonomyFile,
  type Assessment,
  type CoveragePlan,
  type LintResult,
  type Outcome,
  type Taxonomy,
} from '@sandboxforge/engine-client'
import { CERTIFICATE_DIR, DEFAULT_TAXONOMY, buildToolRegistry, createContext } from './bootstrap.js'
import { doctor, renderReport } from './doctor.js'

const VERSION = '0.1.0'

const GRANTS = ['fs:read', 'fs:write', 'net:fetch', 'proc:spawn'] as const

const out = (text: string): void => {
  process.stdout.write(text)
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const fail = (code: string, message: string): void => {
  process.stderr.write(`${code}: ${message}\n`)
  process.exitCode = 1
}

/** A lattice row per risk tier: the product's core readout, in text. */
export function renderLattice(taxonomy: Taxonomy, plan: CoveragePlan): string {
  const covered = new Set(plan.selected.flatMap((item) => [...item.new_facets]))
  const counts = new Map<string, number>()
  for (const item of plan.selected) {
    for (const facetId of item.new_facets) counts.set(facetId, (counts.get(facetId) ?? 0) + 1)
  }

  // Two different reasons a facet can be missing from a plan, and they must never be
  // conflated: no probe in the taxonomy reaches it at all, versus probes exist but the budget
  // could not buy one. The second is a budgeting decision; the first is a broken taxonomy.
  const reachable = new Set(taxonomy.cases.flatMap((probe) => [...probe.covers]))

  const tiers = [...new Set(taxonomy.facets.map((facet) => facet.tier))].sort((a, b) => b - a)
  const lines: string[] = []

  for (const tier of tiers) {
    const facets = taxonomy.facets.filter((facet) => facet.tier === tier)
    const hit = facets.filter((facet) => covered.has(facet.id))
    lines.push(`  tier ${tier}  ${hit.length}/${facets.length} covered`)
    for (const facet of facets) {
      const isCovered = covered.has(facet.id)
      const mark = isCovered ? 'covered  ' : 'UNCOVERED'
      const n = counts.get(facet.id) ?? 0
      const note = isCovered
        ? `[${n} probe${n === 1 ? '' : 's'}]`
        : reachable.has(facet.id)
          ? '[not selected within budget]'
          : '[NO PROBE IN THE TAXONOMY REACHES THIS]'
      lines.push(`    ${mark}  t${tier}  ${facet.id.padEnd(30)} ${facet.label}  ${note}`)
    }
  }

  return lines.join('\n')
}

function parseSeed(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`seed must be an integer, got "${value}"`)
  return parsed
}

/** Exit codes are part of the contract: 0 ok, 1 runtime failure, 2 usage error. */
export function buildProgram(): Command {
  const program = new Command()

  program
    .name('sandbox-forge')
    .description(
      'sandbox-forge — Declare a capability taxonomy and a probe budget; get the smallest probe suite that provably touches every dangerous capability, and an explicit list of the ones your budget could not reach.',
    )
    .version(VERSION, '-v, --version', 'print the version')
    .exitOverride((error) => {
      process.exitCode = error.exitCode === 0 ? 0 : 2
      throw error
    })

  program
    .command('doctor')
    .description('diagnose every subsystem and print an actionable report')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const report = await doctor()
      out(process.argv.includes('--json') ? json(report) : `${renderReport(report)}\n`)
      if (!report.ok) process.exitCode = 1
    })

  program
    .command('tools')
    .description('list the registered tools — the authoritative capability list')
    .option('--json', 'machine-readable output')
    .action(() => {
      const registry = buildToolRegistry()
      const tools = registry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        surface: registry.surfaceOf(tool.name),
        source: registry.sourceOf(tool.name),
        permissions: tool.permissions,
        inputSchema: tool.inputSchema,
      }))
      if (process.argv.includes('--json')) {
        out(json(tools))
        return
      }
      const width = Math.max(...tools.map((t) => t.name.length), 4)
      for (const tool of tools) {
        out(`  ${tool.name.padEnd(width)}  [${tool.surface}]  ${tool.description}\n`)
      }
    })

  // ------------------------------------------------------------- taxonomy

  const taxonomy = program.command('taxonomy').description('inspect and validate a capability taxonomy')

  taxonomy
    .command('check')
    .description('validate a taxonomy: unreachable capabilities, dangling probes, tier mistakes')
    .argument('[path]', 'taxonomy path', DEFAULT_TAXONOMY)
    .option('--json', 'machine-readable output')
    .action(async (path: string) => {
      const engine = new ForgeEngine({ cwd: process.cwd() })
      const result: LintResult = await engine.lint(loadTaxonomyFile(process.cwd(), path))
      if (process.argv.includes('--json')) {
        out(json(result))
      } else {
        const lines = [
          `${path}: ${result.facets} capabilities, ${result.cases} probes, ${result.reachable} reachable`,
          result.issues.length === 0
            ? '  no issues'
            : result.issues
                .map((issue) => `  [${issue.level}] ${issue.code} ${issue.where}\n      ${issue.message}`)
                .join('\n'),
        ]
        out(`${lines.join('\n')}\n`)
      }
      if (!result.ok) process.exitCode = 1
    })

  taxonomy
    .command('list')
    .description('list the declared capabilities with tier, family and probe count')
    .argument('[path]', 'taxonomy path', DEFAULT_TAXONOMY)
    .option('--json', 'machine-readable output')
    .action(async (path: string) => {
      const registry = buildToolRegistry()
      const value = await registry.invoke('list_facets', { taxonomyPath: path }, createContext('cli'), GRANTS)
      out(process.argv.includes('--json') ? json(value) : `${renderFacetList(value)}\n`)
    })

  // ------------------------------------------------------------- plan

  program
    .command('plan')
    .description('choose a probe suite for a budget and emit a coverage certificate')
    .argument('[path]', 'taxonomy path', DEFAULT_TAXONOMY)
    .option('-b, --budget <n>', 'maximum number of probes', '8')
    .option('-s, --seed <n>', 'tie-break seed', '0')
    .option('--write', 'write the certificate into certificates/<plan_id>.json')
    .option('--json', 'machine-readable output')
    .action(async (path: string, flags: { budget: string; seed: string; write?: boolean }) => {
      try {
        const engine = new ForgeEngine({ cwd: process.cwd() })
        const plan = await engine.plan(
          loadTaxonomyFile(process.cwd(), path),
          Number(flags.budget),
          parseSeed(flags.seed),
        )
        if (flags.write === true) {
          const file = join(CERTIFICATE_DIR, `${plan.plan_id}.json`)
          writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`, 'utf8')
          process.stderr.write(`wrote ${file}\n`)
        }
        if (process.argv.includes('--json')) {
          out(json(plan))
          return
        }
        out(`${renderPlanSummary(plan)}\n\n${renderLattice(loadTaxonomyFile(process.cwd(), path), plan)}\n`)
        if (plan.uncovered.length > 0) {
          out(
            `\n  ${plan.uncovered.length} capabilit${plan.uncovered.length === 1 ? 'y' : 'ies'} ` +
              `this budget CANNOT test: ${plan.uncovered.join(', ')}\n`,
          )
        }
      } catch (cause) {
        fail(
          (cause as { code?: string }).code ?? 'PLAN_FAILED',
          cause instanceof Error ? cause.message : String(cause),
        )
      }
    })

  // ------------------------------------------------------------- assess

  program
    .command('assess')
    .description('score recorded outcomes into exact residual-risk bounds')
    .argument('<certificate>', 'certificate id under certificates/, or a path to a plan JSON')
    .option('--taxonomy <path>', 'taxonomy the plan was built from', DEFAULT_TAXONOMY)
    .option('--outcomes <path>', 'JSON array of {caseId, facetId, blocked, passed}')
    .option('--json', 'machine-readable output')
    .action(async (certificate: string, flags: { taxonomy: string; outcomes?: string; json?: boolean }) => {
      try {
        const cwd = process.cwd()
        const engine = new ForgeEngine({ cwd })
        const plan = certificate.includes('/')
          ? (JSON.parse(readFileSync(certificate, 'utf8')) as CoveragePlan)
          : loadCertificate(join(cwd, CERTIFICATE_DIR), certificate)

        let outcomes: Outcome[] = []
        if (flags.outcomes !== undefined) {
          const parsed: unknown = JSON.parse(readFileSync(join(cwd, flags.outcomes), 'utf8'))
          if (!Array.isArray(parsed)) {
            throw new Error('the outcomes file must contain a JSON array')
          }
          outcomes = parsed as Outcome[]
        }

        const report: Assessment = await engine.assess(loadTaxonomyFile(cwd, flags.taxonomy), plan, outcomes)
        out(process.argv.includes('--json') ? json(report) : `${renderAssessment(report)}\n`)
      } catch (cause) {
        fail(
          (cause as { code?: string }).code ?? 'ASSESS_FAILED',
          cause instanceof Error ? cause.message : String(cause),
        )
      }
    })

  program
    .command('certificates')
    .description('list committed coverage certificates')
    .option('--json', 'machine-readable output')
    .action(() => {
      const found = listCertificates(join(process.cwd(), CERTIFICATE_DIR))
      if (process.argv.includes('--json')) {
        out(json({ certificates: found }))
        return
      }
      out(
        found.length === 0
          ? '  no certificates committed yet\n'
          : `${found.map((id) => `  ${id}\n`).join('')}`,
      )
    })

  // ------------------------------------------------------------- mcp

  const mcp = program.command('mcp').description('Model Context Protocol commands')

  mcp
    .command('serve')
    .description('run the MCP server over stdio')
    .action(async () => {
      const { serveStdio } = await import('@sandboxforge/mcp')
      const registry = buildToolRegistry()
      // stdout belongs to the protocol from here on; diagnostics must go to stderr.
      await serveStdio(registry, createContext('mcp'))
    })

  mcp
    .command('call')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
        process.exitCode = 2
        return
      }
      const registry = buildToolRegistry()
      try {
        const value = await registry.invoke(tool, parsed, createContext('cli'), [...GRANTS])
        out(json(value))
      } catch (cause) {
        fail(
          (cause as { code?: string }).code ?? 'INTERNAL',
          cause instanceof Error ? cause.message : String(cause),
        )
      }
    })

  program
    .command('version')
    .description('print version and runtime information as JSON')
    .action(() => {
      out(
        json({
          name: 'sandbox-forge',
          version: VERSION,
          node: process.versions.node,
          platform: process.platform,
          tools: buildToolRegistry().size,
        }),
      )
    })

  return program
}

function renderPlanSummary(plan: CoveragePlan): string {
  return [
    `plan ${plan.plan_id}`,
    `  taxonomy     ${plan.taxonomy_name}@${plan.taxonomy_version} (digest ${plan.taxonomy_digest})`,
    `  algorithm    ${plan.algorithm}`,
    `  budget       ${plan.budget} probes (exhausted: ${plan.budget_exhausted})`,
    `  seed         ${plan.seed}`,
    `  coverage     ${plan.coverage.covered}/${plan.coverage.facets} capabilities (${(plan.coverage.ratio * 100).toFixed(1)}%)`,
    `  selected     ${plan.selected.length}`,
    `  redundant    ${plan.redundant.length}`,
    `  uncovered    ${plan.uncovered.length}`,
    `  certificate  ${plan.certificate_digest}`,
  ].join('\n')
}

function renderAssessment(report: Assessment): string {
  const lines = [
    `assessment of ${report.plan_id}`,
    `  probes recorded   ${report.totals.probes_recorded ?? 0}`,
    `  failures          ${report.totals.failures ?? 0}`,
    `  untested facets   ${report.totals.untested ?? 0}`,
    `  mean 95% bound    ${Number(report.totals.mean_miss_prob_upper_95 ?? 0).toFixed(4)}`,
    '',
    '  capability                        tier  probes  fails  bound95  residual',
  ]
  for (const facet of report.facets) {
    lines.push(
      `  ${facet.facet_id.padEnd(34)} ${String(facet.tier).padStart(2)}  ` +
        `${String(facet.probes).padStart(6)}  ${String(facet.failures).padStart(5)}  ` +
        `${facet.miss_prob_upper_95.toFixed(4).padStart(7)}  ${String(facet.residual_tier).padStart(8)}`,
    )
  }
  if (report.untested.length > 0) {
    lines.push('', `  NEVER TESTED: ${report.untested.join(', ')}`)
  }
  return lines.join('\n')
}

function renderFacetList(value: unknown): string {
  const result = value as {
    name: string
    count: number
    facets: { id: string; tier: number; family: string; label: string; probes: number }[]
    unreachable: string[]
  }
  const width = Math.max(...result.facets.map((facet) => facet.id.length), 4)
  const lines = [
    `${result.name}: ${result.count} capabilities`,
    ...result.facets.map(
      (facet) =>
        `  t${facet.tier}  ${facet.id.padEnd(width)}  ${String(facet.probes).padStart(2)} probe(s)  ${facet.label}`,
    ),
  ]
  if (result.unreachable.length > 0) {
    lines.push(`  UNREACHABLE: ${result.unreachable.join(', ')}`)
  }
  return lines.join('\n')
}
