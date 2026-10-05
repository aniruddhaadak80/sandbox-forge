import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { doctor, renderReport } from './doctor.js'

const dirs: string[] = []

/**
 * The real repository root. Several doctor rows (the Python engine, the committed taxonomy) only
 * mean anything against a real tree, so the "everything is fine" cases assert against this rather
 * than against a hand-built fixture that would pass by being empty.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'))
  dirs.push(root)
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: A valid skill for the doctor test suite.\nmetadata:\n  version: 1.0.0\n---\nBody.\n',
    'utf8',
  )
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const statusOf = (report: { checks: readonly { name: string; status: string }[] }, name: string) =>
  report.checks.find((check) => check.name === name)?.status

describe('doctor', () => {
  it('passes on this repository', async () => {
    const report = await doctor(REPO)
    expect(report.ok).toBe(true)
    expect(statusOf(report, 'skills')).toBe('ok')
    expect(statusOf(report, 'plugins')).toBe('ok')
  })

  it('actually reaches the Python engine and the committed taxonomy', async () => {
    const report = await doctor(REPO)
    expect(statusOf(report, 'engine')).toBe('ok')
    expect(statusOf(report, 'taxonomy')).toBe('ok')

    const engine = report.checks.find((check) => check.name === 'engine')
    expect(engine?.detail).toContain('plan_coverage')
    expect(engine?.detail).toContain('assess_exposure')
  })

  it('fails and names a fix when a skill is invalid', async () => {
    const root = scratch()
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true })
    writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'no frontmatter', 'utf8')
    const report = await doctor(root)
    expect(report.ok).toBe(false)
    const skills = report.checks.find((c) => c.name === 'skills')
    expect(skills?.status).toBe('fail')
    expect(skills?.fix).toBeTruthy()
  })

  it('fails with a fix hint when the engine cannot be reached', async () => {
    // A tree with no Python engine at all is genuinely broken for this product, and the flagship
    // diagnostic must say so rather than degrade into a warning.
    const report = await doctor(scratch())
    const engine = report.checks.find((c) => c.name === 'engine')
    expect(engine?.status).toBe('fail')
    expect(engine?.fix).toContain('sandbox_forge')
  })

  it('warns rather than fails when config is absent', async () => {
    const report = await doctor(REPO)
    expect(statusOf(report, 'config')).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('renders every check with a status token', async () => {
    const rendered = renderReport(await doctor(REPO))
    expect(rendered).toMatch(/doctor/)
    expect(rendered).toMatch(/PASS/)
    expect(rendered).toMatch(/WARN/)
    expect(rendered).toMatch(/fix:/)
  })
})
