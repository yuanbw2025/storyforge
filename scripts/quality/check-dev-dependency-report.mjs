import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const severities = /** @type {const} */ (['info', 'low', 'moderate', 'high', 'critical'])
/** @typedef {typeof severities[number]} Severity */
/** @typedef {'high'|'critical'} RiskSeverity */
/** @typedef {{advisoryId: string, packageName: string, lockPath: string, version: string, severity: RiskSeverity}} RiskKey */
/** @typedef {RiskKey & {expiresOn: string, owner: string, reason: string}} Approval */
/** @typedef {{lockPath: string, version: string, scope: 'dev'|'runtime-or-mixed'}} LockedNode */
/** @typedef {{status: number|null, signal: string|null, stdout: string, error?: unknown}} AuditResult */

const ghsa = /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/
const packageName = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/
const lockPath = /^(?:node_modules\/(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+\/)*node_modules\/(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
/** @param {unknown} value @returns {value is Severity} */
const severity = (value) => severities.some((item) => item === value)
/** @param {unknown} value @returns {value is RiskSeverity} */
const highRisk = (value) => value === 'high' || value === 'critical'
/** @param {unknown} value @returns {value is string} */
const text = (value) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 512
/** @param {unknown} value @returns {value is string} */
const name = (value) => text(value) && packageName.test(value)
/** @param {unknown} value @returns {value is string} */
const pathKey = (value) => text(value) && lockPath.test(value) && !value.split('/').some((part) => part === '.' || part === '..')
/** @param {RiskKey} entry */
const identity = ({ advisoryId, packageName, lockPath, version, severity }) => JSON.stringify([advisoryId, packageName, lockPath, version, severity])
/** @param {Buffer} data */
const digest = (data) => createHash('sha256').update(data).digest('hex')

/** @typedef {{valid(value: string): string|null, validRange(range: string): string|null, satisfies(version: string, range: string): boolean}} Semver */
/** @returns {Semver} */
function loadSemver() {
  // Use the version already present in the installed lock graph; this tool installs nothing.
  return /** @type {Semver} */ (createRequire(import.meta.url)('semver'))
}

/** @param {unknown} value @param {Semver} semver */
function approvalsFrom(value, semver) {
  /** @type {Map<string, Approval>} */
  const approvals = new Map()
  if (!object(value) || value.version !== 1 || !Array.isArray(value.approvals) || Object.keys(value).length !== 2) {
    throw new Error('approval-document')
  }
  for (const entry of /** @type {unknown[]} */ (value.approvals)) {
    if (!object(entry) || Object.keys(entry).length !== 8 || !text(entry.advisoryId) || !ghsa.test(entry.advisoryId)
        || !name(entry.packageName) || !pathKey(entry.lockPath) || !text(entry.version) || semver.valid(entry.version) === null
        || !highRisk(entry.severity) || !text(entry.expiresOn) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn)
        || !text(entry.owner) || !text(entry.reason)) throw new Error('approval-entry')
    const expiry = new Date(entry.expiresOn + 'T00:00:00Z')
    if (!Number.isFinite(expiry.valueOf()) || expiry.toISOString().slice(0, 10) !== entry.expiresOn) throw new Error('approval-expiry')
    const approval = {
      advisoryId: entry.advisoryId, packageName: entry.packageName, lockPath: entry.lockPath,
      version: entry.version, severity: entry.severity, expiresOn: entry.expiresOn, owner: entry.owner, reason: entry.reason,
    }
    const key = identity(approval)
    if (approvals.has(key)) throw new Error('duplicate-approval')
    approvals.set(key, approval)
  }
  return approvals
}

/** @param {string} packageId @param {unknown} paths @param {Record<string, unknown>} packages @param {Semver} semver */
function lockedNodes(packageId, paths, packages, semver) {
  if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length) throw new Error('invalid-audit-nodes')
  return /** @type {unknown[]} */ (paths).map((path) => {
    if (!pathKey(path) || !Object.hasOwn(packages, path)) throw new Error('missing-audit-lock-node')
    const node = packages[path]
    const folderName = path.split('node_modules/').at(-1)
    if (!object(node) || (node.name ?? folderName) !== packageId || node.link === true
        || !text(node.version) || semver.valid(node.version) === null) throw new Error('invalid-audit-lock-node')
    return /** @type {LockedNode} */ ({ lockPath: path, version: node.version, scope: node.dev === true ? 'dev' : 'runtime-or-mixed' })
  })
}

/** @param {unknown} audit @param {unknown} lock @param {Map<string, Approval>} approvals @param {string} utcDate @param {Semver} semver */
function summarize(audit, lock, approvals, utcDate, semver) {
  if (!object(lock) || (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3) || !object(lock.packages)) throw new Error('invalid-lock')
  if (!object(audit) || audit.auditReportVersion !== 2 || !object(audit.vulnerabilities)
      || !object(audit.metadata) || !object(audit.metadata.vulnerabilities)) throw new Error('invalid-audit-format')

  /** @type {Record<Severity, number>} */
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  /** @type {Map<string, {severity: Severity, nodes: LockedNode[], via: string[], direct: boolean}>} */
  const records = new Map()
  /** @type {Map<string, RiskKey & LockedNode>} */
  const findings = new Map()
  const reportedHighAdvisories = new Set()
  const locatedHighAdvisories = new Set()
  const metadata = audit.metadata.vulnerabilities
  for (const [packageId, item] of Object.entries(audit.vulnerabilities)) {
    if (!name(packageId) || !object(item) || item.name !== packageId || !severity(item.severity)
        || !Array.isArray(item.via) || item.via.length === 0) throw new Error('invalid-audit-record')
    counts[item.severity]++
    const nodes = lockedNodes(packageId, item.nodes, lock.packages, semver)
    /** @type {string[]} */
    const via = []
    let direct = false
    for (const source of /** @type {unknown[]} */ (item.via)) {
      if (name(source)) { via.push(source); continue }
      if (!object(source) || !severity(source.severity) || source.name !== packageId) throw new Error('invalid-audit-source')
      if (!highRisk(source.severity)) continue
      const advisoryId = typeof source.url === 'string' && /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/.exec(source.url)?.[1]
      if (!advisoryId || !ghsa.test(advisoryId) || !text(source.range) || semver.validRange(source.range) === null
          || severities.indexOf(source.severity) > severities.indexOf(item.severity)) throw new Error('invalid-high-advisory')
      const advisoryKey = JSON.stringify([packageId, advisoryId, source.severity])
      reportedHighAdvisories.add(advisoryKey)
      for (const node of nodes) {
        if (!semver.satisfies(node.version, source.range)) continue
        locatedHighAdvisories.add(advisoryKey)
        const finding = { advisoryId, packageName: packageId, severity: source.severity, ...node }
        findings.set(identity(finding), finding)
        if (source.severity === item.severity) direct = true
      }
    }
    records.set(packageId, { severity: item.severity, nodes, via, direct })
  }
  if ([...reportedHighAdvisories].some((key) => !locatedHighAdvisories.has(key))) throw new Error('high-advisory-without-lock-match')
  if (severities.some((level) => metadata[level] !== counts[level]) || metadata.total !== records.size) {
    throw new Error('audit-count-mismatch')
  }
  for (const record of records.values()) {
    if (record.via.some((target) => !records.has(target))) throw new Error('missing-audit-source')
  }

  /** @type {{packageName: string, severity: RiskSeverity, nodes: LockedNode[], through: string[]}[]} */
  const transitive = []
  for (const [packageId, record] of records) {
    if (!highRisk(record.severity) || record.direct) continue
    const seen = new Set([packageId])
    const pending = [...record.via]
    const through = []
    while (pending.length > 0) {
      const target = pending.pop()
      if (target === undefined || seen.has(target)) continue
      seen.add(target)
      const dependency = records.get(target)
      if (!dependency || dependency.severity !== record.severity) continue
      if (dependency.direct) through.push(target)
      pending.push(...dependency.via)
    }
    if (through.length === 0) throw new Error('unattributed-high-risk')
    transitive.push({ packageName: packageId, severity: record.severity, nodes: record.nodes, through: through.sort() })
  }
  const risks = [...findings.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, finding]) => {
    const approval = approvals.get(key)
    const review = finding.scope !== 'dev' ? 'outside-dev-approval' : !approval ? 'unapproved'
      : approval.expiresOn < utcDate ? 'expired' : 'approved'
    return { ...finding, review, ...(approval && { approval: { owner: approval.owner, reason: approval.reason, expiresOn: approval.expiresOn } }) }
  })
  return {
    packageCounts: { ...counts, total: records.size },
    distinctHighAdvisories: new Set(risks.map((risk) => risk.advisoryId)).size,
    transitive, risks,
  }
}

/** @param {AuditResult} result @param {Buffer} before @param {Buffer} after @param {unknown} policy @param {Date} now */
export function evaluateAudit(result, before, after, policy = { version: 1, approvals: [] }, now = new Date()) {
  const lockSHA256 = digest(before)
  const auditedAt = now.toISOString()
  /** @param {string} status @param {string} code */
  const failed = (status, code) => ({ exitCode: 2, report: { status, code, auditedAt, lockSHA256, npmExit: result.status } })
  if (!before.equals(after)) return failed('audit-data-invalid', 'lock-changed')
  if (result.error || result.signal) {
    return failed('audit-tool-failed', object(result.error) && result.error.code === 'ETIMEDOUT' ? 'timeout' : 'execution')
  }
  /** @type {unknown} */
  let audit
  try { audit = JSON.parse(result.stdout) } catch {
    return result.status === 0 || result.status === 1
      ? failed('audit-data-invalid', 'invalid-audit-json') : failed('audit-tool-failed', 'npm-exit')
  }
  if (object(audit) && Object.hasOwn(audit, 'error')) return failed('audit-tool-failed', 'registry-or-npm-error')
  if (result.status !== 0 && result.status !== 1) return failed('audit-tool-failed', 'npm-exit')
  let semver
  try { semver = loadSemver() } catch { return failed('audit-tool-failed', 'semver-unavailable') }
  /** @type {Map<string, Approval>} */
  let approvals
  try { approvals = approvalsFrom(policy, semver) } catch { return failed('approval-data-invalid', 'invalid-approval-document') }
  try {
    const summary = summarize(audit, JSON.parse(before.toString('utf8')), approvals, auditedAt.slice(0, 10), semver)
    if ((result.status === 1) !== (summary.risks.length > 0)) return failed('audit-data-invalid', 'npm-exit-inconsistent')
    const unapproved = summary.risks.some((risk) => risk.review !== 'approved')
      || summary.transitive.some((record) => record.nodes.some((node) => node.scope !== 'dev'))
    return {
      exitCode: unapproved ? 1 : 0,
      report: {
        status: unapproved ? 'unapproved-risk' : summary.risks.length ? 'reviewed-existing-risk' : 'clear',
        scope: 'lockfile-with-dev', auditedAt, lockSHA256, npmExit: result.status, ...summary,
      },
    }
  } catch (error) {
    return failed('audit-data-invalid', error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : 'invalid-audit-input')
  }
}

/** @param {string[]} args */
function main(args) {
  const argsValid = args.length === 0 || (args.length === 2 && args[0] === '--approved' && Boolean(args[1]))
  if (!argsValid) return { exitCode: 2, report: { status: 'usage-error', usage: '[--approved <file>]' } }
  /** @type {unknown} */
  let policy
  try { if (args[1]) policy = JSON.parse(readFileSync(args[1], 'utf8')) } catch {
    return { exitCode: 2, report: { status: 'approval-data-invalid', code: 'approval-file-unreadable' } }
  }
  const lockFile = 'package-lock.json'
  try {
    const before = readFileSync(lockFile)
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
      'audit', '--include=dev', '--include=prod', '--include=optional', '--include=peer',
      '--package-lock-only', '--ignore-scripts', '--json',
      '--audit-level=high', '--fetch-timeout=12000', '--fetch-retries=0',
    // npm's cold-cache metadata walk can outlast any individual registry request.
    ], { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' })
    return evaluateAudit(result, before, readFileSync(lockFile), policy)
  } catch {
    return { exitCode: 2, report: { status: 'audit-data-invalid', code: 'lock-unreadable' } }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = main(process.argv.slice(2))
  console.log(JSON.stringify(result.report, null, 2))
  process.exitCode = result.exitCode
}
