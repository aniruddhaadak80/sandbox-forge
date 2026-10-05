/**
 * The TypeScript mirror of the engine's I/O contract.
 *
 * These shapes are hand-mirrored from `services/engine/src/sandbox_forge/types.py`. They are
 * the *transport* types only — the payload crossing the boundary. Everything the engine
 * computes is computed in Python; nothing here re-implements a rule, because a second
 * implementation of a coverage decision is a second opinion nobody asked for.
 */

export type Tier = 1 | 2 | 3 | 4 | 5

export interface Facet {
  readonly id: string
  readonly label: string
  readonly tier: Tier
  readonly family: string
  readonly weight: number
}

export interface ProbeCase {
  readonly id: string
  readonly label: string
  readonly tier: Tier
  readonly covers: readonly string[]
}

export interface Taxonomy {
  readonly version: string
  readonly name: string
  readonly facets: readonly Facet[]
  readonly cases: readonly ProbeCase[]
}

export interface TierCoverage {
  readonly tier: number
  readonly facets: number
  readonly covered: number
  readonly ratio: number
}

export interface CoverageSummary {
  readonly facets: number
  readonly covered: number
  readonly ratio: number
  readonly by_tier: readonly TierCoverage[]
}

export interface SelectedCase {
  readonly case_id: string
  readonly rank: number
  readonly gain: number
  readonly new_facets: readonly string[]
}

export interface CoveragePlan {
  readonly algorithm: string
  readonly generator: string
  readonly plan_id: string
  readonly seed: number
  readonly budget: number
  readonly taxonomy_name: string
  readonly taxonomy_version: string
  readonly taxonomy_digest: string
  readonly selected: readonly SelectedCase[]
  readonly redundant: readonly string[]
  readonly uncovered: readonly string[]
  readonly coverage: CoverageSummary
  readonly budget_exhausted: boolean
  readonly certificate_digest: string
}

export interface Outcome {
  readonly caseId: string
  readonly facetId: string
  readonly blocked: boolean
  readonly passed: boolean
}

export interface FacetAssessment {
  readonly facet_id: string
  readonly tier: number
  readonly probes: number
  readonly failures: number
  readonly blocked: number
  readonly miss_prob_upper_95: number
  readonly residual_tier: number
}

export interface Assessment {
  readonly plan_id: string
  readonly facets: readonly FacetAssessment[]
  readonly untested: readonly string[]
  readonly worst: readonly string[]
  readonly totals: Readonly<Record<string, number>>
}

export interface TaxonomyIssue {
  readonly code: string
  readonly level: 'error' | 'warning'
  readonly where: string
  readonly message: string
}

export interface LintResult {
  readonly ok: boolean
  readonly issues: readonly TaxonomyIssue[]
  readonly facets: number
  readonly cases: number
  readonly reachable: number
  readonly unreachable: readonly string[]
}

export interface MergeConflict {
  readonly kind: string
  readonly id: string
  readonly left: string
  readonly right: string
  readonly message: string
}

export interface MergeResult {
  readonly merged: Taxonomy
  readonly conflicts: readonly MergeConflict[]
  readonly added_facets: readonly string[]
  readonly added_cases: readonly string[]
}

/** The four operations the engine exposes. Nothing else is reachable. */
export const ENGINE_OPS = ['plan_coverage', 'assess_exposure', 'merge_taxonomies', 'lint_taxonomy'] as const

export type EngineOp = (typeof ENGINE_OPS)[number]

export function isCoveragePlan(value: unknown): value is CoveragePlan {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CoveragePlan>
  return (
    typeof candidate.plan_id === 'string' &&
    typeof candidate.certificate_digest === 'string' &&
    Array.isArray(candidate.selected) &&
    Array.isArray(candidate.uncovered)
  )
}
