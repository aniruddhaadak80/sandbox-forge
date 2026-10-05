import { NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import taxonomyDocument from '../../../data/taxonomy.json'

/**
 * Plan over HTTP, against the real Python engine.
 *
 * The engine is a subprocess, so this route is honest about the possibility that the host has no
 * Python — on a serverless Node runtime there usually is not one. When the engine is missing the
 * route answers 503 with the reason rather than serving a plan computed some other way. A
 * coverage claim that cannot be reproduced is worse than no coverage claim.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface EngineResponse {
  ok: boolean
  value?: unknown
  error?: { code: string; message: string }
  durationMs: number
}

const TIMEOUT_MS = 8000

function callEngine(op: string, input: unknown): Promise<EngineResponse> {
  // The engine ships outside apps/web and therefore outside this deployment (see
  // .vercelignore in the repository root and ADR 0003). The path is resolved rather than assumed
  // so that running the app locally from the full checkout still reaches the real engine.
  const engineRoot = join(process.cwd(), '..', '..', 'services', 'engine', 'src')
  const python = process.env.SANDBOX_FORGE_PYTHON ?? 'python'

  return new Promise<EngineResponse>((resolve) => {
    const child = spawn(python, ['-m', 'sandbox_forge'], {
      cwd: engineRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (value: EngineResponse): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({
        ok: false,
        error: { code: 'TIMEOUT', message: 'engine timed out' },
        durationMs: TIMEOUT_MS,
      })
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', (cause) =>
      finish({
        ok: false,
        error: { code: 'SPAWN_FAILED', message: `cannot run "${python}": ${String(cause)}` },
        durationMs: 0,
      }),
    )
    child.on('close', () => {
      try {
        finish(JSON.parse(stdout.trim()) as EngineResponse)
      } catch (cause) {
        finish({
          ok: false,
          error: {
            code: 'BAD_OUTPUT',
            message: stderr.trim().slice(0, 400) || `engine produced invalid JSON: ${String(cause)}`,
          },
          durationMs: 0,
        })
      }
    })

    child.stdin.end(JSON.stringify({ op, input }))
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawBudget = url.searchParams.get('budget')
  const budget = rawBudget === null ? 8 : Number(rawBudget)
  const seed = Number(url.searchParams.get('seed') ?? '0')

  if (!Number.isInteger(budget) || budget < 0 || budget > 64) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 'BAD_BUDGET', message: 'budget must be an integer in 0..64' },
      },
      { status: 400 },
    )
  }
  if (!Number.isInteger(seed)) {
    return NextResponse.json(
      { ok: false, error: { code: 'BAD_SEED', message: 'seed must be an integer' } },
      { status: 400 },
    )
  }

  const response = await callEngine('plan_coverage', { taxonomy: taxonomyDocument, budget, seed })

  if (!response.ok) {
    const unavailable = response.error?.code === 'SPAWN_FAILED'
    return NextResponse.json(
      {
        ok: false,
        engine: 'unavailable',
        error: response.error,
        hint: unavailable
          ? 'This deployment has no Python runtime. Run `sandbox-forge plan` locally, or read the committed certificate at /coverage.'
          : 'The engine rejected the request.',
      },
      { status: unavailable ? 503 : 502, headers: { 'cache-control': 'no-store' } },
    )
  }

  return NextResponse.json(
    { ok: true, engine: 'reachable', durationMs: response.durationMs, plan: response.value },
    { headers: { 'cache-control': 'no-store' } },
  )
}
