import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateAudit } from './check-dev-dependency-report.mjs'

const root = 'node_modules/example'
const nested = 'node_modules/tool/node_modules/example'
const advisoryId = 'GHSA-5xrq-8626-4rwp'
const nextAdvisoryId = 'GHSA-587h-7wmj-h5pm'
const today = new Date('2026-11-04T16:00:00Z')
const approval = {
  advisoryId, packageName: 'example', lockPath: root, version: '1.1.0',
  severity: 'high', expiresOn: '2026-11-04', owner: 'Tooling', reason: 'Fixture review',
}

/** @param {string} [version] @param {boolean} [dev] */
function lock(version = '1.1.0', dev = true) {
  return Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: {
    [root]: { version, dev },
    [nested]: { version: '2.1.0', dev: true },
    'node_modules/tool': { version: '1.0.0', dev: true },
  } }))
}

/** @param {string} range @param {string} [severity] @param {string} [id] */
function advisory(range, severity = 'high', id = advisoryId) {
  return { name: 'example', range, severity, url: 'https://github.com/advisories/' + id }
}

/** @param {{ severity?: 'high'|'critical', sources?: unknown[], transitive?: boolean, paths?: string[] }} [options] */
function report({ severity = 'high', sources = [advisory('<2', severity), advisory('>=2 <3', severity)],
  transitive = false, paths = [root, nested] } = {}) {
  const count = transitive ? 2 : 1
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      example: { name: 'example', severity, nodes: paths, via: sources },
      ...(transitive && { tool: { name: 'tool', severity, nodes: ['node_modules/tool'], via: ['example'] } }),
    },
    metadata: { vulnerabilities: {
      info: 0, low: 0, moderate: 0, high: severity === 'high' ? count : 0, critical: severity === 'critical' ? count : 0, total: count,
    } },
  }
}

/** @param {unknown} data @param {unknown[]} [approvals] @param {Buffer} [snapshot] @param {number} [status] */
function evaluate(data, approvals = [], snapshot = lock(), status = 1) {
  return evaluateAudit({ status, signal: null, stdout: JSON.stringify(data) }, snapshot, snapshot, { version: 1, approvals }, today)
}

/** @param {ReturnType<typeof evaluateAudit>} result */
function summary(result) {
  assert.ok('risks' in result.report, JSON.stringify(result))
  return result.report
}

test('one GHSA on two versions produces two findings; an approval covers only its exact path', () => {
  const data = report()
  const unapproved = evaluate(data)
  assert.equal(unapproved.exitCode, 1)
  assert.equal(unapproved.report.status, 'unapproved-risk')
  assert.equal(summary(unapproved).distinctHighAdvisories, 1)
  assert.deepEqual(summary(unapproved).risks.map(({ lockPath, version, severity }) => [lockPath, version, severity]), [
    [root, '1.1.0', 'high'], [nested, '2.1.0', 'high'],
  ])
  const partial = evaluate(data, [approval])
  assert.equal(partial.exitCode, 1)
  assert.deepEqual(summary(partial).risks.map(({ review }) => review), ['approved', 'unapproved'])
  const reviewed = evaluate(data, [approval, { ...approval, lockPath: nested, version: '2.1.0' }])
  assert.equal(reviewed.exitCode, 0)
  assert.equal(reviewed.report.status, 'reviewed-existing-risk')
  assert.equal(reviewed.report.npmExit, 1)
})

test('range matches actual paths; an uncovered new GHSA is actionable on only its affected version', () => {
  const result = evaluate(report({ sources: [advisory('<2'), advisory('>=2 <3', 'high', nextAdvisoryId)] }), [approval])
  assert.equal(result.exitCode, 1)
  assert.deepEqual(summary(result).risks.map(({ advisoryId, lockPath, review }) => [advisoryId, lockPath, review]), [
    [nextAdvisoryId, nested, 'unapproved'], [advisoryId, root, 'approved'],
  ])
})

test('version drift, severity escalation, expiration and runtime scope cannot inherit an approval', () => {
  const one = report({ paths: [root] })
  for (const [result, review] of /** @type {const} */ ([
    [evaluate(one, [approval], lock('1.2.0')), 'unapproved'],
    [evaluate(report({ severity: 'critical', paths: [root] }), [approval]), 'unapproved'],
    [evaluate(one, [{ ...approval, expiresOn: '2026-11-03' }]), 'expired'],
    [evaluate(one, [approval], lock('1.1.0', false)), 'outside-dev-approval'],
  ])) {
    assert.equal(result.exitCode, 1)
    assert.equal(summary(result).risks[0]?.review, review)
  }
})

test('a meta vulnerability preserves its locked path and source without inventing a GHSA', () => {
  const result = evaluate(report({ transitive: true, paths: [root] }), [approval])
  assert.equal(result.exitCode, 0)
  const data = summary(result)
  assert.equal(data.distinctHighAdvisories, 1)
  assert.equal(data.packageCounts.high, 2)
  assert.deepEqual(data.transitive, [{
    packageName: 'tool', severity: 'high',
    nodes: [{ lockPath: 'node_modules/tool', version: '1.0.0', scope: 'dev' }], through: ['example'],
  }])
})

test('an empty report clears high risk; moderate counts remain visible', () => {
  const clean = { auditReportVersion: 2, vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } }
  assert.equal(evaluate(clean, [], lock(), 0).report.status, 'clear')
  const moderate = {
    ...clean,
    vulnerabilities: { example: { name: 'example', severity: 'moderate', nodes: [root], via: [advisory('<2', 'moderate')] } },
    metadata: { vulnerabilities: { ...clean.metadata.vulnerabilities, moderate: 1, total: 1 } },
  }
  const result = evaluate(moderate, [], lock(), 0)
  assert.equal(result.exitCode, 0)
  assert.equal(summary(result).packageCounts.moderate, 1)
})

test('missing lock paths, unlocated advisory, dangling via and mismatched npm status fail closed', () => {
  for (const result of [
    evaluate(report({ paths: ['node_modules/missing'] })),
    evaluate(report({ sources: [advisory('<2'), advisory('>=3', 'high', nextAdvisoryId)] })),
    evaluate(report({ sources: ['unreported-package'] })),
    evaluate(report(), [], lock(), 0),
    evaluate({ ...report(), metadata: { vulnerabilities: {} } }),
  ]) {
    assert.equal(result.exitCode, 2)
    assert.equal(result.report.status, 'audit-data-invalid')
  }
})

test('bad approval syntax and duplicate exact rows are explicit policy failures', () => {
  for (const approvals of [
    [approval, approval],
    [{ ...approval, lockPath: 'node_modules/*' }],
    [{ ...approval, version: '^1.1.0' }],
    [{ ...approval, expiresOn: '2026-02-30' }],
  ]) {
    const result = evaluate(report(), approvals)
    assert.equal(result.exitCode, 2)
    assert.equal(result.report.status, 'approval-data-invalid')
  }
})

test('registry errors, timeout, truncated JSON and lock changes are not vulnerability results', () => {
  const snapshot = lock()
  assert.equal(evaluate({ error: { summary: 'SECRET should never appear' } }).report.status, 'audit-tool-failed')
  assert.doesNotMatch(JSON.stringify(evaluate({ error: { summary: 'SECRET' } })), /SECRET/)
  const timeout = evaluateAudit({ status: null, signal: null, stdout: '', error: { code: 'ETIMEDOUT' } }, snapshot, snapshot)
  assert.equal(timeout.exitCode, 2)
  assert.equal(timeout.report.status, 'audit-tool-failed')
  assert.ok('code' in timeout.report)
  assert.equal(timeout.report.code, 'timeout')
  assert.equal(evaluateAudit({ status: 1, signal: null, stdout: '{' }, snapshot, snapshot).report.status, 'audit-data-invalid')
  const changed = evaluateAudit({ status: 1, signal: null, stdout: JSON.stringify(report()) }, snapshot, lock('1.2.0'))
  assert.equal(changed.exitCode, 2)
  assert.equal(changed.report.status, 'audit-data-invalid')
})
