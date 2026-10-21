#!/usr/bin/env node
/**
 * Regression tests for the web-data drift gate (`scripts/sync-web-data.mjs`).
 *
 * The gate hashes a source file and compares the committed snapshot against a freshly generated
 * one. Both steps used to read the file's raw bytes, so the result depended on the line endings
 * of the checkout that produced it: Git rewrites LF to CRLF in the working tree on Windows
 * (core.autocrlf=true) and leaves LF alone on a Linux runner. The same repository therefore
 * produced two different digests, and a snapshot refreshed on a laptop was reported as stale by
 * the runner — even though nothing about the data had changed.
 *
 * The fix normalises line endings before hashing and before comparing, so the digest names the
 * content rather than the machine that copied it. These tests pin that behaviour, and pin the
 * failure path too: the gate must still fail when the data really has drifted.
 *
 * The tests run the real script against a synthetic tree. The script resolves its root from its
 * own location, so copying it into a fixture directory is what makes the fixture the subject.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'sync-web-data.mjs')

const TAXONOMY_SOURCE = 'taxonomies/asi-control-baseline.json'
const CERTIFICATE_SOURCE = 'certificates/4191b5b1-b8-s20261005.json'

const TAXONOMY = { version: '1.0.0', name: 'fixture', facets: [{ id: 'a' }], cases: [{ id: 'c' }] }
const CERTIFICATE = { plan_id: 'fixture', certificate_digest: 'deadbeefdeadbeef' }

/** LF or CRLF, as a checkout would have it. */
function withEol(text, eol) {
  const lf = text.replace(/\r\n/g, '\n')
  return eol === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf
}

/** A throwaway repository containing the real script and a pair of sources. */
function fixture({ sourceEol = 'lf' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-forge-web-data-'))
  for (const dir of ['scripts', 'taxonomies', 'certificates', join('apps', 'web', 'data')]) {
    mkdirSync(join(root, dir), { recursive: true })
  }
  copyFileSync(SCRIPT, join(root, 'scripts', 'sync-web-data.mjs'))
  writeSource(root, TAXONOMY_SOURCE, JSON.stringify(TAXONOMY, null, 2) + '\n', sourceEol)
  writeSource(root, CERTIFICATE_SOURCE, JSON.stringify(CERTIFICATE, null, 2) + '\n', sourceEol)
  return root
}

function writeSource(root, relative, content, eol = 'lf') {
  writeFileSync(join(root, relative), withEol(content, eol), 'utf8')
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'sync-web-data.mjs'), ...args], {
    encoding: 'utf8',
  })
  return { code: result.status, output: `${result.stdout}${result.stderr}` }
}

/** Generate the snapshot from the current state of the fixture. */
function generate(root) {
  const result = run(root)
  assert.equal(result.code, 0, `generating the snapshot failed: ${result.output}`)
}

function snapshot(root, name) {
  return JSON.parse(readFileSync(join(root, 'apps', 'web', 'data', `${name}.json`), 'utf8'))
}

test('the gate passes when the snapshot matches its source', (t) => {
  const root = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  generate(root)
  const result = run(root, '--check')
  assert.equal(result.code, 0, result.output)
})

test('the gate passes when the checkout uses CRLF and the snapshot was generated with LF', (t) => {
  // The regression: a Windows checkout of a snapshot generated on a Linux runner (or the other
  // way round) is the same data, and the gate has to say so.
  const root = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  generate(root)
  writeSource(root, TAXONOMY_SOURCE, JSON.stringify(TAXONOMY, null, 2) + '\n', 'crlf')
  writeSource(root, CERTIFICATE_SOURCE, JSON.stringify(CERTIFICATE, null, 2) + '\n', 'crlf')
  const result = run(root, '--check')
  assert.equal(result.code, 0, result.output)
})

test('the provenance digest names the content, not the line endings', (t) => {
  const root = fixture({ sourceEol: 'crlf' })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  generate(root)
  const provenance = snapshot(root, 'taxonomy').__provenance
  assert.equal(provenance.source, TAXONOMY_SOURCE)
  assert.match(provenance.sha256_16, /^[0-9a-f]{16}$/)
  // The digest of the content is the same whether the checkout used LF or CRLF, so the value
  // recorded here is the one a Linux runner computes from its own checkout.
  const lf = JSON.stringify(TAXONOMY, null, 2) + '\n'
  const expected = digestOf(lf)
  assert.equal(provenance.sha256_16, expected)
})

test('the gate fails when the source has really drifted', (t) => {
  const root = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  generate(root)
  writeSource(root, TAXONOMY_SOURCE, JSON.stringify({ ...TAXONOMY, name: 'changed' }, null, 2) + '\n')
  const result = run(root, '--check')
  assert.notEqual(result.code, 0, 'a drifted source must fail the gate')
  assert.match(result.output, /is stale/)
})

test('the gate fails when the snapshot is missing', (t) => {
  const root = fixture()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  generate(root)
  unlinkSync(join(root, 'apps', 'web', 'data', 'taxonomy.json'))
  const result = run(root, '--check')
  assert.notEqual(result.code, 0, 'a missing snapshot must fail the gate')
  assert.match(result.output, /is stale/)
})

/** The digest the script records: the first 16 hex characters of the content's sha256. */
function digestOf(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}
