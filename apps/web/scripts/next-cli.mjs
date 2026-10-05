/**
 * A portable wrapper around the `next` binary.
 *
 * Why this exists: Next's build step inspects the lockfile in `process.cwd()`. Inside an npm
 * workspace the app directory has no lockfile of its own, so Next falls through to probing for
 * a package manager on PATH. On a machine that also has yarn installed it picks yarn, and then
 * `yarn config get registry` fails — which Next reports as "Failed to patch lockfile" even though
 * the build succeeded.
 *
 * That patch routine is a no-op for a correct install: the only entries it looks for are the
 * `@next/swc-*` optional binaries for *other* platforms, which npm never writes into a lockfile
 * produced on this one. So the check is a false positive here, and Next ships an explicit
 * opt-out for exactly this case.
 *
 * A wrapper script is used rather than `NEXT_IGNORE_INCORRECT_LOCKFILE=1 next build` because
 * inline environment assignment is not valid in cmd.exe, and this repo is developed on Windows.
 *
 * Usage: node scripts/next-cli.mjs build|dev|start|lint
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const command = process.argv[2] ?? 'dev'
const passthrough = process.argv.slice(3)

// npm workspaces hoist dependencies to the repository root, so the path to `next` cannot be
// assumed to sit under apps/web. Resolving through Node's own resolver keeps this working
// whether or not the tree ends up hoisted.
const require = createRequire(join(here, '..', 'package.json'))
const nextBin = join(dirname(require.resolve('next/package.json')), 'dist', 'bin', 'next')

const child = spawn(process.execPath, [nextBin, command, ...passthrough], {
  stdio: 'inherit',
  cwd: join(here, '..'),
  env: { ...process.env, NEXT_IGNORE_INCORRECT_LOCKFILE: '1' },
  shell: false,
})

child.on('close', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
