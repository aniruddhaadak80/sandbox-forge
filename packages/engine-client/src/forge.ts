import { join } from 'node:path'
import { ValidationError } from '@sandboxforge/core'
import { EngineBridge } from './bridge.js'
import type {
  Assessment,
  CoveragePlan,
  EngineOp,
  LintResult,
  MergeResult,
  Outcome,
  Taxonomy,
} from './types.js'

/** Where the engine lives, relative to the repository root. */
export const ENGINE_MODULE = 'sandbox_forge'
export const ENGINE_SRC = join('services', 'engine', 'src')

/**
 * The typed façade over the Python engine.
 *
 * Every call goes through the same subprocess boundary as the untyped bridge — this class adds
 * validation and types, never behaviour. If a method here started computing something itself,
 * the CLI, the MCP server and the web app would begin disagreeing about what a plan is.
 */
export class ForgeEngine {
  readonly #bridge: EngineBridge

  constructor(options: { cwd: string; python?: string; timeoutMs?: number }) {
    this.#bridge = new EngineBridge({
      module: ENGINE_MODULE,
      cwd: join(options.cwd, ENGINE_SRC),
      ...(options.python !== undefined ? { python: options.python } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    })
  }

  async plan(taxonomy: Taxonomy, budget: number, seed: number): Promise<CoveragePlan> {
    if (!Number.isInteger(budget) || budget < 0) {
      throw new ValidationError('budget must be a non-negative integer', { field: 'budget', budget })
    }
    if (!Number.isInteger(seed)) {
      throw new ValidationError('seed must be an integer', { field: 'seed', seed })
    }
    return await this.#bridge.call<CoveragePlan>({
      op: 'plan_coverage',
      input: { taxonomy, budget, seed },
    })
  }

  async assess(taxonomy: Taxonomy, plan: CoveragePlan, outcomes: readonly Outcome[]): Promise<Assessment> {
    return await this.#bridge.call<Assessment>({
      op: 'assess_exposure',
      input: { taxonomy, plan, outcomes },
    })
  }

  async lint(taxonomy: Taxonomy): Promise<LintResult> {
    return await this.#bridge.call<LintResult>({ op: 'lint_taxonomy', input: { taxonomy } })
  }

  async merge(left: Taxonomy, right: Taxonomy): Promise<MergeResult> {
    return await this.#bridge.call<MergeResult>({
      op: 'merge_taxonomies',
      input: { left, right },
    })
  }

  /** Which operations the engine actually exposes, for `doctor` and the CLI. */
  async ops(): Promise<readonly EngineOp[]> {
    const response = await this.#bridge.invoke({ op: '__list__', input: null })
    if (response.ok && Array.isArray(response.value)) return response.value as EngineOp[]
    // The engine answers an unknown op with its own list in the message; that is the cheapest
    // reliable capability probe and it avoids adding an operation that exists only for health.
    const message = response.error?.message ?? ''
    const listed =
      message
        .split('available:')[1]
        ?.trim()
        .split(',')
        .map((s) => s.trim()) ?? []
    return listed.filter((op): op is EngineOp => op.length > 0)
  }
}
