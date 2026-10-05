#!/usr/bin/env node
/**
 * End-to-end proof that the MCP surface genuinely speaks MCP.
 *
 * This is not a unit test with a mock transport. It launches the real server as a child process,
 * connects a real client over stdio, and completes the handshake — so a protocol regression, a
 * bad tool name, or a tool that only works when called in-process all fail here.
 *
 * Run it from the repository root, after `npm run build`:
 *
 *   node e2e/mcp-proof.mjs
 *
 * Exits non-zero on the first failure.
 */
import { McpClient } from '@sandboxforge/mcp'
import { join } from 'node:path'

const root = process.cwd()
const cli = join(root, 'packages', 'cli', 'dist', 'bin.js')

let step = 0
const heading = (text) => console.log(`\n${'='.repeat(72)}\n[${++step}] ${text}\n${'='.repeat(72)}`)
const check = (label, condition, detail = '') => {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) process.exitCode = 1
  return condition
}

const client = new McpClient()

try {
  heading('launch the server over stdio and complete the handshake')
  await client.connect({
    id: 'sandbox-forge',
    command: process.execPath,
    args: [cli, 'mcp', 'serve'],
    enabled: true,
  })
  console.log('  connected: the initialize handshake completed')

  heading('tools/list')
  const tools = await client.listTools()
  for (const tool of tools) console.log(`  ${tool.name.padEnd(20)} ${tool.description.slice(0, 78)}`)
  check('at least five tools are exposed', tools.length >= 5, `${tools.length} tools`)
  check(
    'every tool carries a JSON Schema',
    tools.every((t) => t.inputSchema?.type === 'object'),
  )
  check(
    'the product tools are present',
    ['plan_coverage', 'assess_exposure', 'lint_taxonomy', 'list_facets'].every((name) =>
      tools.some((tool) => tool.name === name),
    ),
  )

  heading('tools/call lint_taxonomy — reaches the Python engine')
  const lint = await client.callTool('lint_taxonomy', {
    taxonomyPath: 'taxonomies/asi-control-baseline.json',
  })
  console.log(`  ok=${lint.ok} facets=${lint.facets} cases=${lint.cases} reachable=${lint.reachable}`)
  check('the engine answered through MCP', lint.ok === true)
  check('the committed taxonomy is valid', lint.unreachable.length === 0)

  heading('tools/call plan_coverage — a real plan from the engine')
  const plan = await client.callTool('plan_coverage', {
    taxonomyPath: 'taxonomies/asi-control-baseline.json',
    budget: 8,
    seed: 20261005,
  })
  console.log(`  plan_id=${plan.plan_id} certificate=${plan.certificate_digest}`)
  console.log(`  covered=${plan.coverage.covered}/${plan.coverage.facets} uncovered=${plan.uncovered.length}`)
  console.log(`  selected=${plan.selected.map((s) => s.case_id).join(', ')}`)
  check(
    'a certificate came back',
    typeof plan.certificate_digest === 'string' && plan.certificate_digest.length > 0,
  )
  check(
    'the digest matches the committed certificate',
    plan.certificate_digest === '991ac592ae918ce4',
    plan.certificate_digest,
  )
  check(
    'every declared capability is covered or explicitly named as uncovered',
    plan.coverage.covered + plan.uncovered.length === plan.coverage.facets,
  )

  heading('tools/call assess_exposure — exact bounds from the engine')
  const assessment = await client.callTool('assess_exposure', {
    taxonomyPath: 'taxonomies/asi-control-baseline.json',
    plan,
    outcomes: [
      {
        caseId: plan.selected[0].case_id,
        facetId: plan.selected[0].new_facets[0],
        blocked: true,
        passed: true,
      },
    ],
  })
  const first = assessment.facets.find((f) => f.facet_id === plan.selected[0].new_facets[0])
  console.log(`  probes recorded=${assessment.totals.probes_recorded} untested=${assessment.totals.untested}`)
  console.log(
    `  ${first.facet_id}: probes=${first.probes} bound95=${first.miss_prob_upper_95} residual=t${first.residual_tier}`,
  )
  check('one probe was scored', assessment.totals.probes_recorded === 1)
  check(
    'a clean probe still leaves a positive bound (the honesty claim)',
    first.miss_prob_upper_95 > 0,
    String(first.miss_prob_upper_95),
  )
  check(
    'unprobed capabilities are listed separately, not averaged in',
    assessment.totals.untested === assessment.facets.length - 1,
  )

  heading('error envelope — an invalid request must fail loudly, not silently')
  let message = ''
  try {
    await client.callTool('plan_coverage', {
      taxonomyPath: 'taxonomies/asi-control-baseline.json',
      budget: -5,
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  console.log(`  ${message}`)
  // The budget is validated in TypeScript before the engine is ever spawned, so the code that
  // surfaces is the boundary's own. The engine's BAD_BUDGET is still exercised directly in the
  // engine's test suite; here what matters is that a bad request produces a stable, named error.
  check(
    'a negative budget is rejected with a stable code',
    /VALIDATION_FAILED|BAD_BUDGET/.test(message),
    message.split(':')[0],
  )

  let missing = ''
  try {
    await client.callTool('no_such_tool', {})
  } catch (error) {
    missing = error instanceof Error ? error.message : String(error)
  }
  check('an unknown tool is rejected', missing.length > 0, missing.split(':')[0])
} finally {
  await client.close()
  console.log(`\n${process.exitCode === 1 ? 'MCP PROOF FAILED' : 'MCP PROOF PASSED'}\n`)
}
