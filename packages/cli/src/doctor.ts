import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '@sandboxforge/skills'
import { buildRegistry as buildPluginRegistry } from '@sandboxforge/plugins'
import { ForgeEngine, loadTaxonomyFile } from '@sandboxforge/engine-client'
import { DEFAULT_TAXONOMY } from './bootstrap.js'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly name: string
  readonly status: Status
  readonly detail: string
  readonly fix?: string
}

export interface DoctorReport {
  readonly ok: boolean
  readonly checks: readonly Check[]
}

const pkg = { name: 'sandbox-forge', version: '0.1.0' }

/**
 * The flagship command. An agent that mutates its own configuration must be able to
 * diagnose itself, and every failing row carries a fix hint rather than only a status.
 */
export async function doctor(cwd = process.cwd()): Promise<DoctorReport> {
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0])
  checks.push(
    nodeMajor >= 22
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : {
          name: 'node',
          status: 'fail',
          detail: `v${process.versions.node} is below the required v22.12.0`,
          fix: 'install Node 22.12 or newer (see .nvmrc)',
        },
  )

  checks.push({
    name: 'package',
    status: 'ok',
    detail: `${pkg.name}@${pkg.version}`,
  })

  const skills = loadCatalog(join(cwd, 'skills'))
  checks.push(
    skills.issues.length === 0
      ? { name: 'skills', status: 'ok', detail: `${skills.skills.length} skills, 0 invalid` }
      : {
          name: 'skills',
          status: 'fail',
          detail: `${skills.skills.length} valid, ${skills.issues.length} invalid`,
          fix: skills.issues[0] ?? 'see npm run check:skill-version',
        },
  )

  const plugins = buildPluginRegistry(join(cwd, 'plugins'))
  checks.push(
    plugins.rejected.length === 0
      ? {
          name: 'plugins',
          status: 'ok',
          detail: `${plugins.active.length} active, ${plugins.disabled.length} disabled`,
        }
      : {
          name: 'plugins',
          status: 'warn',
          detail: `${plugins.rejected.length} rejected`,
          fix: plugins.rejected[0]?.issues[0] ?? 'inspect plugins/*/plugin.json',
        },
  )

  const configPath = join(cwd, 'product.config.json')
  checks.push(
    existsSync(configPath)
      ? { name: 'config', status: 'ok', detail: 'product.config.json found' }
      : {
          name: 'config',
          status: 'warn',
          detail: 'no product.config.json — using defaults',
          fix: 'run with defaults, or create product.config.json',
        },
  )

  // The engine is the product. If it cannot be reached, nothing can be planned, so this is a
  // hard failure with an actionable fix rather than a warning.
  const engine = new ForgeEngine({ cwd })
  try {
    const ops = await engine.ops()
    checks.push(
      ops.length > 0
        ? {
            name: 'engine',
            status: 'ok',
            detail: `${ops.length} operations: ${[...ops].sort().join(', ')}`,
          }
        : {
            name: 'engine',
            status: 'fail',
            detail: 'the engine answered but advertised no operations',
            fix: 'run: python -m sandbox_forge  (from services/engine/src)',
          },
    )
  } catch (cause) {
    checks.push({
      name: 'engine',
      status: 'fail',
      detail: `cannot reach the Python engine — ${cause instanceof Error ? cause.message : String(cause)}`,
      fix: 'install Python 3.11+ and check `python -m sandbox_forge` from services/engine/src',
    })
  }

  const taxonomyPath = join(cwd, DEFAULT_TAXONOMY)
  if (!existsSync(taxonomyPath)) {
    checks.push({
      name: 'taxonomy',
      status: 'warn',
      detail: `no default taxonomy at ${DEFAULT_TAXONOMY}`,
      fix: `create ${DEFAULT_TAXONOMY}, or pass --taxonomy to the plan command`,
    })
  } else {
    try {
      const taxonomy = loadTaxonomyFile(cwd, DEFAULT_TAXONOMY)
      const lint = await engine.lint(taxonomy)
      checks.push(
        lint.ok
          ? {
              name: 'taxonomy',
              status: 'ok',
              detail: `${lint.facets} capabilities, ${lint.cases} probes, all reachable`,
            }
          : {
              name: 'taxonomy',
              status: 'fail',
              detail: `${lint.issues.filter((i) => i.level === 'error').length} blocking issue(s) in ${DEFAULT_TAXONOMY}`,
              fix:
                lint.issues.find((i) => i.level === 'error')?.message ?? 'run: sandbox-forge taxonomy check',
            },
      )
    } catch (cause) {
      checks.push({
        name: 'taxonomy',
        status: 'fail',
        detail: cause instanceof Error ? cause.message : String(cause),
        fix: `repair ${DEFAULT_TAXONOMY}`,
      })
    }
  }

  return { ok: checks.every((c) => c.status !== 'fail'), checks }
}

export function renderReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.name.length), 5)
  const icon = (status: Status): string => (status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL')
  const lines = report.checks.map((c) => {
    const head = `  [${icon(c.status)}] ${c.name.padEnd(width)}  ${c.detail}`
    return c.fix === undefined ? head : `${head}\n         fix: ${c.fix}`
  })
  return [
    `${pkg.name} doctor`,
    ...lines,
    '',
    report.ok ? 'all required checks passed' : 'one or more checks failed',
  ].join('\n')
}
