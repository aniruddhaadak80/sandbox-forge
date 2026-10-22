import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { NotFoundError, ValidationError } from '@sandboxforge/core'
import { assembleTaxonomy, listCertificates, loadCertificate, loadTaxonomyFile } from './certificates.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'certificates-'))
  dirs.push(root)
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, name), contents, 'utf8')
  }
  return root
}

const plan = {
  algorithm: 'greedy',
  generator: 'test',
  plan_id: 'plan-1',
  seed: 7,
  budget: 10,
  taxonomy_name: 'base',
  taxonomy_version: '1.0.0',
  taxonomy_digest: 'abc123',
  selected: [],
  redundant: [],
  uncovered: [],
  coverage: { facets: 3, covered: 1, ratio: 0.33, by_tier: [] },
  budget_exhausted: false,
  certificate_digest: 'def456',
}

const taxonomy = {
  version: '1.0.0',
  name: 'base',
  facets: [{ id: 'f1', label: 'Facet one', tier: 1, family: 'core', weight: 1 }],
  cases: [{ id: 'c1', label: 'Case one', tier: 1, covers: ['f1'] }],
}

describe('listCertificates', () => {
  it('lists the certificates in a directory, sorted, without the extension', () => {
    const dir = fixture({
      'beta.json': JSON.stringify(plan),
      'alpha.json': JSON.stringify(plan),
    })
    expect(listCertificates(dir)).toEqual(['alpha', 'beta'])
  })

  it('ignores anything that is not a certificate', () => {
    const dir = fixture({
      'alpha.json': JSON.stringify(plan),
      'notes.md': '# not a certificate',
      README: 'not a certificate either',
    })
    expect(listCertificates(dir)).toEqual(['alpha'])
  })

  it('returns nothing for a directory that is not there', () => {
    expect(listCertificates(join(tmpdir(), 'no-such-certificate-dir'))).toEqual([])
  })
})

describe('loadCertificate', () => {
  it('loads a certificate', () => {
    const dir = fixture({ 'alpha.json': JSON.stringify(plan) })
    const loaded = loadCertificate(dir, 'alpha')
    expect(loaded.plan_id).toBe('plan-1')
    expect(loaded.certificate_digest).toBe('def456')
  })

  it('refuses an id that is not a bare filename stem', () => {
    const dir = fixture({ 'alpha.json': JSON.stringify(plan) })
    for (const id of ['../escape', 'sub/alpha', '/etc/passwd', '.hidden']) {
      expect(() => loadCertificate(dir, id), id).toThrowError(ValidationError)
    }
  })

  it('reports a certificate that is not there', () => {
    const dir = fixture({})
    expect(() => loadCertificate(dir, 'missing')).toThrowError(NotFoundError)
  })

  it('reports a certificate that is not valid JSON', () => {
    const dir = fixture({ 'alpha.json': '{ not json' })
    expect(() => loadCertificate(dir, 'alpha')).toThrowError(ValidationError)
  })

  it('reports a document that is not a coverage plan', () => {
    const dir = fixture({ 'alpha.json': JSON.stringify({ plan_id: 'plan-1' }) })
    expect(() => loadCertificate(dir, 'alpha')).toThrowError(ValidationError)
  })
})

describe('loadTaxonomyFile', () => {
  it('loads a taxonomy', () => {
    const dir = fixture({ 'taxonomy.json': JSON.stringify(taxonomy) })
    const loaded = loadTaxonomyFile(dir, 'taxonomy.json')
    expect(loaded.name).toBe('base')
    expect(loaded.facets).toHaveLength(1)
  })

  it('reports a file that is not there', () => {
    const dir = fixture({})
    expect(() => loadTaxonomyFile(dir, 'taxonomy.json')).toThrowError(ValidationError)
  })

  it('reports a file that is not valid JSON', () => {
    const dir = fixture({ 'taxonomy.json': '{ not json' })
    expect(() => loadTaxonomyFile(dir, 'taxonomy.json')).toThrowError(ValidationError)
  })

  it('reports a document that is not an object', () => {
    const dir = fixture({ 'taxonomy.json': JSON.stringify(['not', 'a', 'taxonomy']) })
    expect(() => loadTaxonomyFile(dir, 'taxonomy.json')).toThrowError(ValidationError)
  })
})

describe('assembleTaxonomy', () => {
  it('appends a capability pack to the base taxonomy', () => {
    const assembled = assembleTaxonomy(taxonomy, {
      facets: [{ id: 'f2', label: 'Facet two', tier: 2, family: 'extra', weight: 2 }],
      cases: [{ id: 'c2', label: 'Case two', tier: 2, covers: ['f2'] }],
    })
    expect(assembled.facets.map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(assembled.cases.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('marks the assembled taxonomy so its digest differs from the file on disk', () => {
    const assembled = assembleTaxonomy(taxonomy, { facets: [], cases: [] })
    expect(assembled.version).toBe('1.0.0+packs')
    expect(assembled.name).toBe('base+packs')
  })

  it('refuses a pack that redeclares a facet', () => {
    expect(() =>
      assembleTaxonomy(taxonomy, {
        facets: [{ id: 'f1', label: 'Different label', tier: 3, family: 'other', weight: 9 }],
        cases: [],
      }),
    ).toThrowError(ValidationError)
  })

  it('refuses a pack that redeclares a probe case', () => {
    expect(() =>
      assembleTaxonomy(taxonomy, {
        facets: [],
        cases: [{ id: 'c1', label: 'Different label', tier: 3, covers: ['f9'] }],
      }),
    ).toThrowError(ValidationError)
  })

  it('does not change the base taxonomy', () => {
    const before = JSON.stringify(taxonomy)
    assembleTaxonomy(taxonomy, {
      facets: [{ id: 'f2', label: 'Facet two', tier: 2, family: 'extra', weight: 2 }],
      cases: [],
    })
    expect(JSON.stringify(taxonomy)).toBe(before)
  })
})
