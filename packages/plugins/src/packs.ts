import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildRegistry } from './registry.js'

/**
 * Capability packs.
 *
 * A plugin in this product contributes *data* — extra capabilities and the probes that reach them
 * — rather than new algorithms. The set-cover planner and the confidence statistics stay in the
 * engine, because a second implementation of what "covered" means is precisely the failure this
 * product exists to make impossible.
 *
 * The manifest alone is not enough: a pack must also ship an `index.js` exporting `facets` and
 * `cases`. Both halves are checked here, and a pack that fails to load is reported rather than
 * skipped, so a capability that silently fails to appear is never mistaken for one that does not
 * exist.
 */

export interface PackFacet {
  readonly id: string
  readonly label: string
  readonly tier: PackTier
  readonly family: string
  readonly weight: number
}

export interface PackCase {
  readonly id: string
  readonly label: string
  readonly tier: PackTier
  readonly covers: readonly string[]
}

export interface CapabilityPack {
  readonly name: string
  readonly version: string
  readonly capabilities: readonly string[]
  readonly facets: readonly PackFacet[]
  readonly cases: readonly PackCase[]
}

export interface PackReport {
  readonly packs: readonly CapabilityPack[]
  readonly facets: readonly PackFacet[]
  readonly cases: readonly PackCase[]
  readonly issues: readonly string[]
}

const ID = /^[a-z0-9]+([._-][a-z0-9]+)*$/

/**
 * Mirrors the engine's risk tier. Declared here rather than imported so `packages/plugins` keeps
 * no dependency on the engine client — the two stay independently loadable, and a five-value
 * literal union is cheap to state twice because the loader validates the same 1..5 range at
 * runtime before anything is returned.
 */
export type PackTier = 1 | 2 | 3 | 4 | 5

function facetsFrom(value: unknown, where: string, issues: string[]): PackFacet[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push(`${where}: "facets" must be an array`)
    return []
  }
  const out: PackFacet[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null) {
      issues.push(`${where}: facets[${index}] must be an object`)
      continue
    }
    const record = item as Record<string, unknown>
    const id = record['id']
    const label = record['label']
    const tier = record['tier']
    const family = record['family']
    if (typeof id !== 'string' || !ID.test(id)) {
      issues.push(`${where}: facets[${index}].id must be a dotted kebab-case id`)
      continue
    }
    if (typeof label !== 'string' || label.length === 0) {
      issues.push(`${where}: facets[${index}].label must be a non-empty string`)
      continue
    }
    if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1 || tier > 5) {
      issues.push(`${where}: facets[${index}].tier must be an integer in 1..5`)
      continue
    }
    // The range check above is what makes this cast sound.
    const packTier = tier as PackTier
    out.push({
      id,
      label,
      tier: packTier,
      family: typeof family === 'string' && family.length > 0 ? family : 'unclassified',
      weight: typeof record['weight'] === 'number' ? (record['weight'] as number) : packTier,
    })
  }
  return out
}

function casesFrom(value: unknown, where: string, issues: string[]): PackCase[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    issues.push(`${where}: "cases" must be an array`)
    return []
  }
  const out: PackCase[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== 'object' || item === null) {
      issues.push(`${where}: cases[${index}] must be an object`)
      continue
    }
    const record = item as Record<string, unknown>
    const id = record['id']
    const covers = record['covers']
    const tier = record['tier']
    if (typeof id !== 'string' || !ID.test(id)) {
      issues.push(`${where}: cases[${index}].id must be a dotted kebab-case id`)
      continue
    }
    if (!Array.isArray(covers) || covers.length === 0 || !covers.every((c) => typeof c === 'string')) {
      issues.push(`${where}: cases[${index}].covers must be a non-empty array of facet ids`)
      continue
    }
    if (typeof tier !== 'number' || !Number.isInteger(tier) || tier < 1 || tier > 5) {
      issues.push(`${where}: cases[${index}].tier must be an integer in 1..5`)
      continue
    }
    out.push({
      id,
      label: typeof record['label'] === 'string' ? (record['label'] as string) : id,
      tier: tier as PackTier,
      covers: covers as string[],
    })
  }
  return out
}

/**
 * Loads every active plugin's capability pack.
 *
 * Only plugins the registry already accepted are read, so conflict resolution and engine-range
 * checks apply here too — a shadowed or rejected plugin contributes nothing, which is what makes
 * the priority rules meaningful.
 */
export async function loadCapabilityPacks(root = 'plugins'): Promise<PackReport> {
  const issues: string[] = []
  const packs: CapabilityPack[] = []
  const allFacets: PackFacet[] = []
  const allCases: PackCase[] = []

  for (const plugin of buildRegistry(root).active) {
    const dir = dirname(plugin.path)
    const entry = join(dir, 'index.js')
    if (!existsSync(entry)) {
      issues.push(`${plugin.manifest.name}: manifest accepted but ${entry} is missing`)
      continue
    }

    let module: Record<string, unknown>
    try {
      module = (await import(pathToFileURL(entry).href)) as Record<string, unknown>
    } catch (cause) {
      issues.push(`${plugin.manifest.name}: failed to import index.js — ${String(cause)}`)
      continue
    }

    const where = plugin.manifest.name
    const facets = facetsFrom(module['facets'], where, issues)
    const cases = casesFrom(module['cases'], where, issues)

    for (const facet of facets) {
      if (allFacets.some((existing) => existing.id === facet.id)) {
        issues.push(`${where}: facet ${facet.id} is already contributed by another pack`)
      }
    }
    for (const probe of cases) {
      if (allCases.some((existing) => existing.id === probe.id)) {
        issues.push(`${where}: probe ${probe.id} is already contributed by another pack`)
      }
    }

    allFacets.push(...facets)
    allCases.push(...cases)
    packs.push({
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      capabilities: plugin.manifest.capabilities,
      facets,
      cases,
    })
  }

  return { packs, facets: allFacets, cases: allCases, issues }
}
