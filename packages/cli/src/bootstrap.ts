import { join } from 'node:path'
import { ToolRegistry, ValidationError, type Tool, type ToolContext } from '@sandboxforge/core'
import { buildRegistry, loadCapabilityPacks } from '@sandboxforge/plugins'
import { loadCatalog } from '@sandboxforge/skills'
import {
  ForgeEngine,
  assembleTaxonomy,
  listCertificates,
  loadCertificate,
  loadTaxonomyFile,
  type CoveragePlan,
  type Outcome,
  type Taxonomy,
} from '@sandboxforge/engine-client'

export const ENGINE_MODULE = 'sandbox_forge'

/** Repository-relative locations the product reads. Declared once so no surface guesses. */
export const TAXONOMY_DIR = join('taxonomies')
export const CERTIFICATE_DIR = join('certificates')
export const DEFAULT_TAXONOMY = 'taxonomies/asi-control-baseline.json'

export interface ToolDeps {
  readonly cwd: string
}

/**
 * Builds the one registry every surface shares.
 *
 * Seven tools, and every one of them answers a question an alignment team actually asks:
 * what dangerous capabilities are on the list, which probes do I run, what did running them
 * prove, is my taxonomy even well-formed, what happens when I merge two of them, and can
 * anyone see the certificate I committed.
 *
 * Every name matches ^[a-z][a-z0-9_]*$ so it is directly exposable over MCP, and every tool is
 * stateless — state lives in `certificates/` and in the caller's own storage.
 */
export function buildToolRegistry(cwd = process.cwd()): ToolRegistry {
  const registry = new ToolRegistry()
  const deps: ToolDeps = { cwd }
  const engine = new ForgeEngine({ cwd })

  /** Accepts an inline taxonomy or a repository-relative path. Models prefer the path. */
  const resolveTaxonomy = (input: { taxonomy?: unknown; taxonomyPath?: unknown }): Taxonomy => {
    if (input.taxonomyPath !== undefined) {
      if (typeof input.taxonomyPath !== 'string' || input.taxonomyPath === '') {
        throw new ValidationError('taxonomyPath must be a non-empty string', {
          field: 'taxonomyPath',
        })
      }
      return loadTaxonomyFile(deps.cwd, input.taxonomyPath)
    }
    if (typeof input.taxonomy === 'object' && input.taxonomy !== null) {
      return input.taxonomy as Taxonomy
    }
    throw new ValidationError('provide either "taxonomy" (object) or "taxonomyPath" (string)', {
      field: 'taxonomy',
    })
  }

  /**
   * Optionally folds in the capabilities contributed by active plugins. Kept separate from
   * `resolveTaxonomy` because it is async and because a caller must opt in explicitly: a plan
   * computed over a different capability set must never be mistaken for one over the house list.
   */
  const resolveTaxonomyWithPacks = async (input: {
    taxonomy?: unknown
    taxonomyPath?: unknown
    includePacks?: boolean
  }): Promise<Taxonomy> => {
    const taxonomy = resolveTaxonomy(input)
    if (input.includePacks !== true) return taxonomy
    const packs = await loadCapabilityPacks(join(deps.cwd, 'plugins'))
    if (packs.facets.length === 0 && packs.cases.length === 0) return taxonomy
    return assembleTaxonomy(taxonomy, { facets: packs.facets, cases: packs.cases })
  }

  const taxonomyField = {
    taxonomy: {
      type: 'object',
      description: 'An inline taxonomy document with facets and cases.',
    },
    taxonomyPath: {
      type: 'string',
      description: 'Repository-relative path to a taxonomy, e.g. "taxonomies/asi-control-baseline.json".',
    },
  }

  // ---------------------------------------------------------------- catalogue

  registry.register(
    {
      name: 'list_skills',
      description:
        'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
      inputSchema: {
        type: 'object',
        properties: {
          includeBodies: { type: 'boolean', description: 'Include each skill body.' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'object' } },
        },
        required: ['count', 'issues', 'skills'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { includeBodies?: boolean }) => {
        const { skills, issues } = loadCatalog(join(deps.cwd, 'skills'))
        return {
          count: skills.length,
          issues: [...issues],
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
            ...(input.includeBodies === true ? { body: skill.body } : {}),
          })),
        }
      },
    } satisfies Tool<{ includeBodies?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_plugins',
      description:
        'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected capability taxonomy is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const result = buildRegistry(join(deps.cwd, 'plugins'))
        return {
          active: result.active.map((p) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            capabilities: p.manifest.capabilities,
            shadowed: p.shadowed,
          })),
          disabled: result.disabled.map((p) => p.manifest.name),
          rejected: result.rejected.map((p) => ({ path: p.path, issues: p.issues })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  // ---------------------------------------------------------------- the product

  registry.register(
    {
      name: 'list_facets',
      description:
        'List the dangerous capabilities declared in a taxonomy, with risk tier, family and weight, plus how many probes can reach each one. Use this before planning a probe suite. Returns facets the taxonomy declares and flags any that no probe covers.',
      inputSchema: {
        type: 'object',
        properties: {
          ...taxonomyField,
          family: { type: 'string', description: 'Only return facets in this family.' },
          minTier: { type: 'integer', minimum: 1, maximum: 5 },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          count: { type: 'number' },
          facets: { type: 'array', items: { type: 'object' } },
          unreachable: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'version', 'count', 'facets', 'unreachable'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: {
        taxonomy?: unknown
        taxonomyPath?: unknown
        family?: string
        minTier?: number
      }) => {
        const taxonomy = resolveTaxonomy(input)
        const lint = await engine.lint(taxonomy)
        const reachable = new Set<string>()
        for (const probe of taxonomy.cases) {
          for (const facetId of probe.covers) reachable.add(facetId)
        }

        const facets = taxonomy.facets
          .filter((facet) => input.family === undefined || facet.family === input.family)
          .filter((facet) => input.minTier === undefined || facet.tier >= input.minTier)
          .map((facet) => ({
            id: facet.id,
            label: facet.label,
            tier: facet.tier,
            family: facet.family,
            weight: facet.weight,
            probes: taxonomy.cases.filter((probe) => probe.covers.includes(facet.id)).length,
            reachable: reachable.has(facet.id),
          }))

        return {
          name: taxonomy.name,
          version: taxonomy.version,
          count: facets.length,
          facets,
          unreachable: [...lint.unreachable],
        }
      },
    } satisfies Tool<
      { taxonomy?: unknown; taxonomyPath?: unknown; family?: string; minTier?: number },
      unknown
    >,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'plan_coverage',
      description:
        'Choose the smallest set of probes that covers the most dangerous capabilities within a budget, and return a coverage certificate. The certificate names every facet the budget could NOT reach — read "uncovered" before reporting any coverage claim. Deterministic: the same taxonomy, budget and seed always produce the same certificate_digest, so two teams can compare results exactly.',
      inputSchema: {
        type: 'object',
        properties: {
          ...taxonomyField,
          budget: {
            type: 'integer',
            minimum: 0,
            description: 'Maximum number of probes to select.',
          },
          seed: { type: 'integer', description: 'Tie-break seed. Default 0.' },
          includePacks: {
            type: 'boolean',
            description:
              'Also cover the capabilities contributed by active plugins. Off by default so a plan is over a capability set you can name.',
          },
        },
        required: ['budget'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          plan_id: { type: 'string' },
          certificate_digest: { type: 'string' },
          selected: { type: 'array', items: { type: 'object' } },
          redundant: { type: 'array', items: { type: 'string' } },
          uncovered: { type: 'array', items: { type: 'string' } },
          coverage: { type: 'object' },
        },
        required: ['plan_id', 'certificate_digest', 'selected', 'redundant', 'uncovered', 'coverage'],
      },
      permissions: ['proc:spawn', 'fs:read'],
      surface: 'core',
      handler: async (input: {
        taxonomy?: unknown
        taxonomyPath?: unknown
        budget?: number
        seed?: number
        includePacks?: boolean
      }) => {
        const taxonomy = await resolveTaxonomyWithPacks(input)
        const plan = await engine.plan(taxonomy, input.budget ?? 0, input.seed ?? 0)
        return plan as unknown as Record<string, unknown>
      },
    } satisfies Tool<
      {
        taxonomy?: unknown
        taxonomyPath?: unknown
        budget?: number
        seed?: number
        includePacks?: boolean
      },
      unknown
    >,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'assess_exposure',
      description:
        'Score recorded probe outcomes against a taxonomy and report, per capability, the exact 95% upper bound on the chance it slips through, plus a residual risk tier. Pass the plan that was actually run. Capabilities with no recorded probes are reported separately as "untested" and must not be averaged into a score.',
      inputSchema: {
        type: 'object',
        properties: {
          ...taxonomyField,
          plan: { type: 'object', description: 'The plan returned by plan_coverage.' },
          outcomes: {
            type: 'array',
            description: 'One entry per probe run against one capability.',
            items: {
              type: 'object',
              properties: {
                caseId: { type: 'string' },
                facetId: { type: 'string' },
                blocked: { type: 'boolean' },
                passed: { type: 'boolean' },
              },
              required: ['caseId', 'facetId'],
              additionalProperties: false,
            },
          },
        },
        required: ['plan'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          plan_id: { type: 'string' },
          facets: { type: 'array', items: { type: 'object' } },
          untested: { type: 'array', items: { type: 'string' } },
          worst: { type: 'array', items: { type: 'string' } },
          totals: { type: 'object' },
        },
        required: ['plan_id', 'facets', 'untested', 'worst', 'totals'],
      },
      permissions: ['proc:spawn', 'fs:read'],
      surface: 'core',
      handler: async (input: {
        taxonomy?: unknown
        taxonomyPath?: unknown
        plan?: unknown
        outcomes?: Outcome[]
      }) => {
        const taxonomy = resolveTaxonomy(input)
        if (typeof input.plan !== 'object' || input.plan === null) {
          throw new ValidationError('plan must be the object returned by plan_coverage', {
            field: 'plan',
          })
        }
        const assessment = await engine.assess(taxonomy, input.plan as CoveragePlan, input.outcomes ?? [])
        return assessment as unknown as Record<string, unknown>
      },
    } satisfies Tool<
      { taxonomy?: unknown; taxonomyPath?: unknown; plan?: unknown; outcomes?: Outcome[] },
      unknown
    >,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'lint_taxonomy',
      description:
        'Validate a capability taxonomy before planning. Reports facets no probe can reach, probes that reference undeclared facets, and probes declared below the risk tier of what they exercise. Fix every "error" before trusting a coverage ratio.',
      inputSchema: {
        type: 'object',
        properties: taxonomyField,
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'object' } },
          unreachable: { type: 'array', items: { type: 'string' } },
        },
        required: ['ok', 'issues', 'unreachable'],
      },
      permissions: ['proc:spawn', 'fs:read'],
      surface: 'core',
      handler: async (input: { taxonomy?: unknown; taxonomyPath?: unknown }) => {
        const taxonomy = resolveTaxonomy(input)
        const result = await engine.lint(taxonomy)
        return result as unknown as Record<string, unknown>
      },
    } satisfies Tool<{ taxonomy?: unknown; taxonomyPath?: unknown }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'merge_taxonomies',
      description:
        'Union two capability taxonomies and report every disagreement instead of resolving one silently. Use when combining a house taxonomy with a partner or third-party one before planning.',
      inputSchema: {
        type: 'object',
        properties: {
          left: { type: 'object', description: 'First taxonomy document.' },
          right: { type: 'object', description: 'Second taxonomy document.' },
        },
        required: ['left', 'right'],
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          merged: { type: 'object' },
          conflicts: { type: 'array', items: { type: 'object' } },
        },
        required: ['merged', 'conflicts'],
      },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input: { left?: unknown; right?: unknown }) => {
        const left = resolveTaxonomy({ taxonomy: input.left })
        const right = resolveTaxonomy({ taxonomy: input.right })
        const result = await engine.merge(left, right)
        return result as unknown as Record<string, unknown>
      },
    } satisfies Tool<{ left?: unknown; right?: unknown }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'load_capability_packs',
      description:
        'List the capabilities and probes that active plugins contribute, and report any pack that failed to load. Use this to see which capability sets a plan can be extended with before passing includePacks: true to plan_coverage.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: {
        type: 'object',
        properties: {
          packs: { type: 'array', items: { type: 'object' } },
          facets: { type: 'array', items: { type: 'object' } },
          cases: { type: 'array', items: { type: 'object' } },
          issues: { type: 'array', items: { type: 'string' } },
        },
        required: ['packs', 'facets', 'cases', 'issues'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const report = await loadCapabilityPacks(join(deps.cwd, 'plugins'))
        return {
          packs: report.packs.map((pack) => ({
            name: pack.name,
            version: pack.version,
            capabilities: [...pack.capabilities],
            facetIds: pack.facets.map((facet) => facet.id),
            probeIds: pack.cases.map((probe) => probe.id),
          })),
          facets: report.facets.map((facet) => ({
            id: facet.id,
            label: facet.label,
            tier: facet.tier,
            family: facet.family,
          })),
          cases: report.cases.map((probe) => ({
            id: probe.id,
            label: probe.label,
            tier: probe.tier,
            covers: [...probe.covers],
          })),
          issues: [...report.issues],
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_certificates',
      description:
        'List committed coverage certificates and return one in full. A certificate is the record of a plan someone actually committed, so it can be diffed in review and compared between teams via its certificate_digest.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Certificate id. Omit to list what is available.' },
        },
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { id?: string }) => {
        const dir = join(deps.cwd, CERTIFICATE_DIR)
        if (input.id !== undefined) {
          return loadCertificate(dir, input.id) as unknown as Record<string, unknown>
        }
        return { certificates: listCertificates(dir), directory: 'certificates' }
      },
    } satisfies Tool<{ id?: string }, unknown>,
    { source: 'core' },
  )

  return registry
}

/** A minimal, dependency-free logger for the tool context. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: process.env.PRODUCT_DATA_DIR ?? '.data',
  }
}
