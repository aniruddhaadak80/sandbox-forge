import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NotFoundError, ValidationError } from '@sandboxforge/core'
import type { CoveragePlan, Facet, ProbeCase, Taxonomy } from './types.js'
import { isCoveragePlan } from './types.js'

/**
 * Certificates on disk.
 *
 * A certificate is a plan a human has actually committed, so it can be reviewed in a pull
 * request and compared between labs. Reading them is deliberately dumb: a file either parses as
 * a plan or it does not, and nothing is recomputed on read. Recomputing on read would make the
 * stored artefact a cache rather than evidence.
 */
export function listCertificates(dir: string): readonly string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
}

export function loadCertificate(dir: string, id: string): CoveragePlan {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new ValidationError('certificate id must be a bare filename stem', { id })
  }
  const path = join(dir, `${id}.json`)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new NotFoundError(`no certificate named "${id}"`, { id, reason: String(cause) })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new ValidationError(`certificate "${id}" is not valid JSON`, {
      id,
      reason: cause instanceof Error ? cause.message : String(cause),
    })
  }
  if (!isCoveragePlan(parsed)) {
    throw new ValidationError(`certificate "${id}" is not a coverage plan`, { id })
  }
  return parsed
}

/** Loads a taxonomy from a repository-relative path. */
export function loadTaxonomyFile(root: string, relative: string): Taxonomy {
  const path = join(root, relative)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (cause) {
    throw new ValidationError(`cannot read taxonomy at ${relative}`, {
      path: relative,
      reason: String(cause),
    })
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('a taxonomy must be a JSON object with facets and cases')
    }
    return parsed as Taxonomy
  } catch (cause) {
    throw new ValidationError(`${relative} is not a valid taxonomy document`, {
      path: relative,
      reason: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

export interface TaxonomyFragment {
  readonly facets: readonly Facet[]
  readonly cases: readonly ProbeCase[]
}

/**
 * Appends plugin-contributed capabilities to a base taxonomy.
 *
 * A fragment that redeclares an existing id is refused rather than merged: silently overriding a
 * capability would change what "covered" means without changing the taxonomy digest anyone is
 * comparing against. Appending changes the digest, which is the point — the assembled taxonomy
 * hashes differently from the file on disk, so a certificate can prove which packs were in play.
 */
export function assembleTaxonomy(base: Taxonomy, fragment: TaxonomyFragment): Taxonomy {
  const facets = new Map(base.facets.map((facet) => [facet.id, facet]))
  for (const facet of fragment.facets) {
    if (facets.has(facet.id)) {
      throw new ValidationError(
        `a capability pack redeclares facet "${facet.id}", which is already in the taxonomy`,
        { facetId: facet.id },
      )
    }
    facets.set(facet.id, facet)
  }

  const cases = new Map(base.cases.map((probe) => [probe.id, probe]))
  for (const probe of fragment.cases) {
    if (cases.has(probe.id)) {
      throw new ValidationError(
        `a capability pack redeclares probe "${probe.id}", which is already in the taxonomy`,
        { caseId: probe.id },
      )
    }
    cases.set(probe.id, probe)
  }

  return {
    version: `${base.version}+packs`,
    name: `${base.name}+packs`,
    facets: [...facets.values()],
    cases: [...cases.values()],
  }
}
