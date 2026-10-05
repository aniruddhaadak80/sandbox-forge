#!/usr/bin/env node
/**
 * Snapshots the repository's capability taxonomy and committed certificate into apps/web.
 *
 * Why this exists: the web app must not import files from outside its own directory (ADR 0003).
 * The alternative — reaching up into ../../../taxonomies — works in a monorepo checkout and
 * breaks the moment the app is deployed with apps/web as the project root, which is exactly how
 * it is deployed.
 *
 * So the data is copied rather than imported, and `check:web-data` fails if the copy has drifted
 * from its source. There is still exactly one source of truth; the copy is a build artefact that
 * a gate keeps honest, not a second file someone has to remember to update.
 *
 * Usage:
 *   node scripts/sync-web-data.mjs           # write the snapshot
 *   node scripts/sync-web-data.mjs --check   # fail if the snapshot is stale
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'apps', 'web', 'data')

/**
 * The snapshot the web app renders. Changing the featured certificate means changing this list and
 * re-running the sync — deliberately, because the page's title is a published claim about which
 * certificate is on show.
 */
const SOURCES = {
  taxonomy: 'taxonomies/asi-control-baseline.json',
  certificate: 'certificates/4191b5b1-b8-s20261005.json',
}

const check = process.argv.includes('--check')

const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

const results = []
for (const [name, relative] of Object.entries(SOURCES)) {
  const sourcePath = join(ROOT, relative)
  const targetPath = join(OUT_DIR, `${name}.json`)

  let raw
  try {
    raw = readFileSync(sourcePath, 'utf8')
  } catch (cause) {
    console.error(`sync-web-data — cannot read ${relative}: ${String(cause)}`)
    process.exit(1)
  }

  // Re-serialise through JSON.parse/stringify so the snapshot is canonical regardless of how the
  // source file happens to be indented. The provenance stamp travels with the data, so a stale
  // copy can always be traced back to the exact bytes it came from.
  const provenance = {
    source: relative,
    sha256_16: digest(raw),
    generatedBy: 'scripts/sync-web-data.mjs',
  }
  const payload = `${JSON.stringify({ ...JSON.parse(raw), __provenance: provenance }, null, 2)}\n`

  results.push({ name, targetPath, payload, provenance })

  if (check) {
    let current = null
    try {
      current = readFileSync(targetPath, 'utf8')
    } catch {
      /* treated as stale below */
    }
    if (current !== payload) {
      console.error(
        `sync-web-data — ${targetPath.replace(`${ROOT}\\`, '')} is stale.\n` +
          `  source: ${relative} (sha256:${provenance.sha256_16})\n` +
          '  fix: run `node scripts/sync-web-data.mjs`',
      )
      process.exitCode = 1
    }
  } else {
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, payload, 'utf8')
  }
}

if (!check) {
  for (const result of results) {
    console.log(
      `sync-web-data — wrote ${result.targetPath.replace(`${ROOT}\\`, '')} ` +
        `(from ${result.provenance.source}, sha256:${result.provenance.sha256_16})`,
    )
  }
}
