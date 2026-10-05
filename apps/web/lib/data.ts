import taxonomyDocument from '../../../taxonomies/asi-control-baseline.json'
import certificateDocument from '../../../certificates/4191b5b1-b8-s20261005.json'

/**
 * The committed evidence.
 *
 * These are the real artifacts the CLI produced, imported statically so they are baked into the
 * bundle and cannot be missing at runtime on a serverless host. This app is a *reader* of
 * certificates, never a second planner: recomputation lives in the CLI and the MCP server, so
 * there is exactly one implementation of what "covered" means.
 *
 * Regenerating the certificate:
 *
 *   node packages/cli/dist/bin.js plan taxonomies/asi-control-baseline.json \
 *     --budget 8 --seed 20261005 --write
 *
 * then update the import above to the new plan id.
 */

export interface Facet {
  readonly id: string
  readonly label: string
  readonly tier: number
  readonly family: string
  readonly weight: number
}

export interface ProbeCase {
  readonly id: string
  readonly label: string
  readonly tier: number
  readonly covers: readonly string[]
}

export interface SelectedCase {
  readonly case_id: string
  readonly rank: number
  readonly gain: number
  readonly new_facets: readonly string[]
}

export interface TierCoverage {
  readonly tier: number
  readonly facets: number
  readonly covered: number
  readonly ratio: number
}

export interface CoveragePlan {
  readonly algorithm: string
  readonly plan_id: string
  readonly seed: number
  readonly budget: number
  readonly taxonomy_name: string
  readonly taxonomy_version: string
  readonly taxonomy_digest: string
  readonly selected: readonly SelectedCase[]
  readonly redundant: readonly string[]
  readonly uncovered: readonly string[]
  readonly coverage: {
    readonly facets: number
    readonly covered: number
    readonly ratio: number
    readonly by_tier: readonly TierCoverage[]
  }
  readonly budget_exhausted: boolean
  readonly certificate_digest: string
}

export interface FacetRow {
  readonly facet: Facet
  readonly covered: boolean
  readonly probes: number
  /** Why this capability is missing from the plan. The distinction matters. */
  readonly reason: 'covered' | 'not-selected' | 'unreachable'
}

export const taxonomy = taxonomyDocument as unknown as {
  version: string
  name: string
  facets: readonly Facet[]
  cases: readonly ProbeCase[]
}

export const certificate = certificateDocument as unknown as CoveragePlan

/** Probes that can reach each facet, computed from the taxonomy rather than trusted. */
const reachable = new Map<string, number>()
for (const probe of taxonomy.cases) {
  for (const facetId of probe.covers) {
    reachable.set(facetId, (reachable.get(facetId) ?? 0) + 1)
  }
}

const coveredFacets = new Set(certificate.selected.flatMap((item) => [...item.new_facets]))

export const facetRows: readonly FacetRow[] = taxonomy.facets.map((facet) => {
  const covered = coveredFacets.has(facet.id)
  return {
    facet,
    covered,
    probes: reachable.get(facet.id) ?? 0,
    reason: covered ? 'covered' : (reachable.get(facet.id) ?? 0) > 0 ? 'not-selected' : 'unreachable',
  }
})

export const tiers: readonly number[] = [...new Set(taxonomy.facets.map((f) => f.tier))].sort((a, b) => b - a)

export const families: readonly string[] = [...new Set(taxonomy.facets.map((f) => f.family))].sort()

export const selectedProbes = certificate.selected.map((item) => ({
  ...item,
  label: taxonomy.cases.find((probe) => probe.id === item.case_id)?.label ?? item.case_id,
}))

export const coveragePercent = (certificate.coverage.ratio * 100).toFixed(1)

/** One number for the headline: how many capabilities this budget cannot test at all. */
export const gapCount = certificate.uncovered.length

export const gapFacets = taxonomy.facets.filter((facet) => certificate.uncovered.includes(facet.id))

/** The probe ids that can reach a facet — derived from the taxonomy, never assumed. */
export function probesByFacet(facetId: string): readonly string[] {
  return taxonomy.cases.filter((probe) => probe.covers.includes(facetId)).map((probe) => probe.id)
}
