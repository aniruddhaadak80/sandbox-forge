import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadCapabilityPacks } from './packs.js'

/**
 * The packs loader is the one place a plugin can inject data into a plan, so the failure modes
 * that matter are: a missing entry point, a malformed capability, and a duplicate id. Each one
 * must be reported rather than silently skipped.
 */

let root: string

const manifest = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: 'pack',
    version: '0.1.0',
    description: 'a capability pack used by the test suite',
    enabled: true,
    priority: 50,
    capabilities: ['pack.one'],
    engines: {},
    ...over,
  })

function writePack(dir: string, name: string, files: { manifest?: string; index?: string }): void {
  const packDir = join(dir, name)
  mkdirSync(packDir, { recursive: true })
  writeFileSync(join(packDir, 'plugin.json'), files.manifest ?? manifest({ name }), 'utf8')
  if (files.index !== undefined) writeFileSync(join(packDir, 'index.js'), files.index, 'utf8')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sf-packs-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadCapabilityPacks', () => {
  it('loads a well-formed pack', async () => {
    const dir = mkdtempSync(join(root, 'ok-'))
    writePack(dir, 'good', {
      manifest: manifest({ name: 'good' }),
      index: `export const facets = [
        { id: 'frontier.one', label: 'Frontier one', tier: 4, family: 'frontier' },
      ]
      export const cases = [
        { id: 'probe.frontier.one', label: 'Probe', tier: 4, covers: ['frontier.one'] },
      ]`,
    })
    const report = await loadCapabilityPacks(dir)
    expect(report.issues).toEqual([])
    expect(report.packs).toHaveLength(1)
    expect(report.facets.map((f) => f.id)).toEqual(['frontier.one'])
    expect(report.cases.map((c) => c.id)).toEqual(['probe.frontier.one'])
  })

  it('defaults a facet weight to its tier', async () => {
    const dir = mkdtempSync(join(root, 'weight-'))
    writePack(dir, 'weighted', {
      manifest: manifest({ name: 'weighted' }),
      index: `export const facets = [{ id: 'w.one', label: 'W', tier: 3, family: 'x' }]
      export const cases = []`,
    })
    const report = await loadCapabilityPacks(dir)
    expect(report.facets[0]?.weight).toBe(3)
  })

  it('reports a pack whose entry point is missing instead of skipping it', async () => {
    const dir = mkdtempSync(join(root, 'missing-'))
    writePack(dir, 'headless', { manifest: manifest({ name: 'headless' }) })
    const report = await loadCapabilityPacks(dir)
    expect(report.packs).toHaveLength(0)
    expect(report.issues.join(' ')).toContain('index.js')
  })

  it('reports a malformed capability', async () => {
    const dir = mkdtempSync(join(root, 'bad-'))
    writePack(dir, 'broken', {
      manifest: manifest({ name: 'broken' }),
      index: `export const facets = [
        { id: 'Bad Id', label: 'x', tier: 4, family: 'y' },
        { id: 'ok.one', label: 'x', tier: 9, family: 'y' },
        { id: 'ok.two', label: '', tier: 2, family: 'y' },
      ]
      export const cases = []`,
    })
    const report = await loadCapabilityPacks(dir)
    expect(report.facets).toHaveLength(0)
    expect(report.issues).toHaveLength(3)
  })

  it('reports a duplicate capability id across packs', async () => {
    const dir = mkdtempSync(join(root, 'dupe-'))
    // Distinct manifest capabilities, so the registry keeps BOTH active and the collision has to
    // be caught on the facet id instead. If both claimed the same capability, the second would
    // simply be shadowed and there would be nothing to detect.
    const source = (facet: string): string => `export const facets = [
      { id: '${facet}', label: 'D', tier: 2, family: 'x' },
    ]
    export const cases = []`
    writePack(dir, 'first', {
      manifest: manifest({ name: 'first', capabilities: ['pack.one'] }),
      index: source('dupe.one'),
    })
    writePack(dir, 'second', {
      manifest: manifest({ name: 'second', capabilities: ['pack.two'] }),
      index: source('dupe.one'),
    })
    const report = await loadCapabilityPacks(dir)
    expect(report.packs).toHaveLength(2)
    expect(report.issues.join(' ')).toContain('already contributed')
  })

  it('ignores a disabled pack entirely', async () => {
    const dir = mkdtempSync(join(root, 'off-'))
    writePack(dir, 'off', {
      manifest: manifest({ name: 'off', enabled: false }),
      index: `export const facets = [{ id: 'off.one', label: 'O', tier: 2, family: 'x' }]
      export const cases = []`,
    })
    const report = await loadCapabilityPacks(dir)
    expect(report.packs).toHaveLength(0)
    expect(report.facets).toHaveLength(0)
  })

  it('reports an entry point that throws on import', async () => {
    const dir = mkdtempSync(join(root, 'throws-'))
    writePack(dir, 'explosive', {
      manifest: manifest({ name: 'explosive' }),
      index: `throw new Error('nope')`,
    })
    const report = await loadCapabilityPacks(dir)
    expect(report.issues.join(' ')).toContain('failed to import')
  })

  it('returns an empty report for a directory that does not exist', async () => {
    const report = await loadCapabilityPacks(join(root, 'absent'))
    expect(report.packs).toEqual([])
    expect(report.issues).toEqual([])
  })
})
