import { lstat, readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CodexRuntime } from './local-codex/runtime.mjs'
import { sha256, validateReaderAnswer, readerUsageWithinBudget } from './narrative-reader-contract.mjs'
import { loadIncompleteReaderJudgeCoverageV1 } from './narrative-reader-judge-coverage.mjs'
import { JUDGE_ENTRY_ID, judgeOutputSchema, judgeRequest, validateJudgeProtocol, validateJudgeAnswer, judgeUsageWithinBudget,
  orderJudgeRequests, summarizeJudge, validatePriorJudgeCall, judgeSummaryName, judgeExecutionCounts } from './narrative-reader-judge-contract.mjs'
import { assertCanonicalJudgeCalls, assertJudgeRunHasNoClaim, canonicalJudgeRun, findJudgeContinuationChildren,
  readCanonicalJudgeFile, readJudgeContinuationHistory, reserveJudgeContinuation,
  verifyJudgeContinuationClaim, verifyJudgeContinuationHistory } from './narrative-reader-judge-continuation.mjs'

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)))
const { values } = parseArgs({ options: { 'reader-report': { type: 'string' }, 'incomplete-reader-diagnostic': { type: 'string' },
  'reader-coverage-policy': { type: 'string' }, protocol: { type: 'string' }, output: { type: 'string' },
  resume: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false }, 'max-calls': { type: 'string' },
  'continue-unstarted-from': { type: 'string' } } })
if (Boolean(values['reader-report']) === Boolean(values['incomplete-reader-diagnostic']) || !values.protocol || !values.output
  || Boolean(values['incomplete-reader-diagnostic']) !== Boolean(values['reader-coverage-policy'])) {
  throw Error('Required: exactly one complete reader report or incomplete diagnostic with its coverage policy, plus --protocol and --output')
}
const localPath = path => { const full = resolve(root, path), rel = relative(root, full)
  if (!rel.startsWith('tests/acceptance/narrative-world/') || rel.includes('..')) throw Error('Only repository-owned evaluation artifacts are allowed')
  return full }
const { full: output, path: runIdentity } = canonicalJudgeRun(root, values.output, { allowMissing: !values.resume })
const sourceHashes = {}
async function frozenFile(path) {
  const full = localPath(path), bytes = await readFile(full)
  sourceHashes[relative(root, full)] = sha256(bytes)
  return bytes
}
const protocolBytes = await frozenFile(values.protocol), protocol = validateJudgeProtocol(JSON.parse(protocolBytes))
const outputSchema = judgeOutputSchema(protocol)
const limit = Number(values['max-calls'] ?? protocol.pilotActualCalls)
if (!Number.isSafeInteger(limit) || limit < 1) throw Error('max-calls must be a positive integer')
const incomplete = values['incomplete-reader-diagnostic'] ? await loadIncompleteReaderJudgeCoverageV1({
  diagnosticPath: values['incomplete-reader-diagnostic'], policyPath: values['reader-coverage-policy'], readFrozen: frozenFile,
  listDirectory: path => readdir(localPath(path)),
}) : null
if (incomplete && protocol.version !== 2) throw Error('Incomplete diagnosis requires the frozen content-based judge rubric')
const report = incomplete?.report ?? JSON.parse(await frozenFile(values['reader-report']))
if (!incomplete && (report.schema !== 'storyforge.narrative-reader-comparison' || report.version !== 2 || report.accepted !== false)) throw Error('Unknown evaluation contract')
const run = localPath(report.run)
const manifestBytes = await frozenFile(relative(root, resolve(run, 'manifest.json'))), readerManifest = JSON.parse(manifestBytes)
const inputBytes = await frozenFile(readerManifest.inputsPath), inputs = JSON.parse(inputBytes)
const readerProtocolBytes = await frozenFile(readerManifest.protocolPath), readerProtocol = JSON.parse(readerProtocolBytes)
const corpusPath = 'tests/acceptance/narrative-world/corpus-v1.json', corpusBytes = await frozenFile(corpusPath), corpus = JSON.parse(corpusBytes)
if (sha256(manifestBytes) !== report.manifestSha256 || sha256(inputBytes) !== readerManifest.inputsSha256
  || sha256(readerProtocolBytes) !== readerManifest.protocolSha256 || sha256(corpusBytes) !== inputs.sourceHashes[corpusPath]
  || protocol.provider === readerProtocol.provider && protocol.model === readerProtocol.model) throw Error('Historical evidence identity or model independence failed')
for (const [path, expected] of Object.entries(incomplete ? {} : report.rawHashes)) {
  const full = resolve(run, path)
  if (!relative(run, full).startsWith('calls/')) throw Error('Unexpected reader evidence path')
  if (sha256(await frozenFile(relative(root, full))) !== expected) throw Error(`Historical raw response changed: ${path}`)
}
const registryPath = 'src/lib/agent/ai-entry-registry.json'
async function assertOfflineEntry() {
  const registry = JSON.parse(await readFile(resolve(root, registryPath), 'utf8'))
  const entry = registry.offlineEvaluations?.find(item => item.entryId === JUDGE_ENTRY_ID)
  if (!entry || entry.boundary !== 'eval-only' || entry.adoptAllowed !== false || entry.adoptionTargets?.length
    || entry.transport !== protocol.provider || entry.caller !== relative(root, fileURLToPath(import.meta.url))
    || entry.contract !== 'scripts/narrative-reader-judge-contract.mjs') throw Error('Independent judge entry is not registered')
}
await assertOfflineEntry()
const runtimePaths = ['scripts/evaluate-narrative-reader-judge-local-codex.mjs', 'scripts/narrative-reader-judge-contract.mjs',
  'scripts/narrative-reader-judge-continuation.mjs', 'scripts/narrative-reader-contract.mjs', 'scripts/narrative-reader-judge-coverage.mjs', 'scripts/local-codex/runtime.mjs', registryPath]
const runtimeHashes = Object.fromEntries(await Promise.all(runtimePaths.map(async path => [path, sha256(await readFile(resolve(root, path)))])))
const evidence = new Map(), prepared = []
for (const family of inputs.families) for (const item of family.cases) {
  const identity = readerManifest.cases.find(row => row.id === item.id)
  if (!identity) throw Error('Unmapped historical case')
  let call = evidence.get(identity.promptHash) ?? incomplete?.calls.get(identity.promptHash)
  if (incomplete && !call) continue
  if (!call) {
    const prefix = resolve(run, 'calls', identity.promptHash)
    const requestPath = `${prefix}.request.json`, resultPath = `${prefix}.result.json`
    if (!sourceHashes[relative(root, requestPath)] || !sourceHashes[relative(root, resultPath)]) throw Error('Reader call is not covered by the frozen report')
    const request = JSON.parse(await readFile(requestPath, 'utf8')), result = JSON.parse(await readFile(resultPath, 'utf8'))
    if (sha256(request.messages) !== identity.promptHash || request.model !== readerProtocol.model
      || result.promptHash !== identity.promptHash || result.status !== 'completed' || !result.dispatched
      || result.provider !== readerProtocol.provider || result.model !== readerProtocol.model
      || !readerUsageWithinBudget(result.usage, readerProtocol)) throw Error('Incomplete or incompatible historical reader call')
    call = { request, answer: validateReaderAnswer(result.rawText, readerProtocol) }; evidence.set(identity.promptHash, call)
  }
  evidence.set(identity.promptHash, call)
  const original = corpus.families.find(value => value.id === item.familyId), question = original?.queries.find(value => value.id === item.question.id)
  if (!original || !question) throw Error('Question has no original corpus identity')
  const request = judgeRequest({ readerRequest: call.request, readerAnswer: call.answer, family: original, question }, protocol)
  prepared.push({ id: item.id, familyId: item.familyId, questionId: item.question.id, condition: item.condition, split: item.split,
    operation: item.question.operation, readerPromptHash: identity.promptHash,
    ...(protocol.version === 2 ? { readerReportedStatus: request.readerStatus } : {}), request })
}
if (prepared.length !== (incomplete?.coverage.counts.eligible ?? readerManifest.totalCases) || new Set(prepared.map(item => item.id)).size !== prepared.length
  || evidence.size !== (incomplete?.coverage.counts.successfulReaderInputs ?? readerManifest.distinctPrompts)) throw Error('Historical paired matrix is incomplete')
const unique = orderJudgeRequests(prepared)
const frozenBase = { schema: incomplete ? 'storyforge.narrative-reader-incomplete-judge-run' : 'storyforge.narrative-reader-judge-run',
  version: incomplete ? 1 : protocol.version === 2 ? 3 : 1, entryId: JUDGE_ENTRY_ID,
  ...(protocol.version === 2 ? { protocolVersion: 2, failurePolicy: protocol.failurePolicy } : {}),
  provider: protocol.provider, model: protocol.model, readerProvider: readerProtocol.provider, readerModel: readerProtocol.model,
  reasoningEffort: protocol.reasoningEffort, sourceHashes: { ...sourceHashes }, runtimeHashes,
  totalObservations: incomplete?.coverage.counts.planned ?? prepared.length,
  ...(incomplete ? { eligibleObservations: prepared.length, readerCoverage: incomplete.coverage } : {}), distinctPrompts: unique.size,
  cases: prepared.map(({ request, ...item }) => ({ ...item, judgePromptHash: request.promptHash, inputBytes: request.inputBytes,
    estimatedInputTokens: request.estimatedInputTokens })), dispatchOrder: [...unique.keys()],
  retryPolicy: protocol.version === 2
    ? 'zero; invalid judgments remain ungraded without redispatch; transport/unknown/budget failures stop and block resume'
    : 'zero; any failed or unknown started call blocks resume; no implicit repair',
  deduplication: 'Identical blinded judge messages share one recorded call; repeated observations are not independent samples.',
  independentHumanReviews: 0, accepted: false, costUsd: null }
/** @type {typeof frozenBase & {continuation?: import('./narrative-reader-judge-continuation.mjs').JudgeContinuation}} */
const frozen = frozenBase
let inherited = new Map()
/** @type {import('./narrative-reader-judge-continuation.mjs').JudgeHistory | null} */
let history = null
if (values['continue-unstarted-from']) {
  const parent = relative(root, localPath(values['continue-unstarted-from']))
  const child = runIdentity
  if (parent === child) throw Error('Continuation requires a distinct raw run directory')
  history = await readJudgeContinuationHistory(root, parent, frozen, unique, protocol)
  const children = await findJudgeContinuationChildren(root, parent, history.manifestSha256)
  if (children.some(existing => existing !== child)) {
    throw Error('Parent judge batch already has a different continuation; use its latest descendant')
  }
  if (!values.resume) {
    try {
      await lstat(output)
      throw Error('Judge output already exists; use --resume for the same claimed directory')
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  }
  const claim = values.resume
    ? verifyJudgeContinuationClaim(root, parent, history.manifestSha256, child)
    : await reserveJudgeContinuation(root, parent, history.manifestSha256, child)
  verifyJudgeContinuationHistory(root, history)
  inherited = history.results
  frozen.version += 1
  Object.assign(sourceHashes, history.files, { [claim.path]: claim.sha256 })
  frozen.sourceHashes = { ...sourceHashes }
  frozen.continuation = { version: 1, run: parent, manifestSha256: history.manifestSha256, claimPath: claim.path, claimSha256: claim.sha256,
    policy: 'Continue only inputs without any prior request/start/result; never retry or overwrite prior completed, failed or interrupted calls.',
    inheritedPromptHashes: [...inherited.keys()], unresolvedPromptHashes: [...inherited].filter(([, value]) => value.status !== 'completed').map(([hash]) => hash) }
  frozen.retryPolicy = 'zero; inherited failures remain unresolved and excluded; any new failed/unknown call blocks this cohort resume'
}
const ownManifestPath = resolve(output, 'manifest.json')
canonicalJudgeRun(root, runIdentity, { allowMissing: !values.resume })
if (values.resume) {
  if (sha256(JSON.parse(readCanonicalJudgeFile(ownManifestPath).toString('utf8'))) !== sha256(frozen)) throw Error('Resume would change frozen judge inputs, rubric, model or runtime')
} else {
  await mkdir(output)
  canonicalJudgeRun(root, runIdentity)
  await mkdir(resolve(output, 'calls'))
  canonicalJudgeRun(root, runIdentity)
  await writeFile(ownManifestPath, JSON.stringify(frozen, null, 2) + '\n', { flag: 'wx' })
}
const ownManifestSha256 = sha256(readCanonicalJudgeFile(ownManifestPath))
function assertRunStorage() {
  canonicalJudgeRun(root, runIdentity)
  assertCanonicalJudgeCalls(output)
}
function assertDispatchOwner() {
  assertRunStorage()
  if (sha256(readCanonicalJudgeFile(ownManifestPath)) !== ownManifestSha256) throw Error('Judge run manifest changed before dispatch')
  assertJudgeRunHasNoClaim(root, runIdentity)
  if (frozen.continuation) {
    const edge = frozen.continuation
    const claim = verifyJudgeContinuationClaim(root, edge.run, edge.manifestSha256, runIdentity)
    if (claim.path !== edge.claimPath || claim.sha256 !== edge.claimSha256) throw Error('Judge continuation claim changed before dispatch')
  }
}
assertRunStorage()
const files = new Set(await readdir(resolve(output, 'calls'))), results = new Map(inherited)
for (const [hash, request] of unique) {
  if (inherited.has(hash) && ['request', 'started', 'result'].some(kind => files.has(`${hash}.${kind}.json`))) throw Error('Continuation would repeat a historical call')
  if (files.has(`${hash}.result.json`)) {
    /** @type {Record<string, unknown>} */
    const prior = {}
    for (const kind of ['request', 'started', 'result']) {
      if (files.has(`${hash}.${kind}.json`)) prior[kind] = JSON.parse(readCanonicalJudgeFile(resolve(output, 'calls', `${hash}.${kind}.json`)).toString('utf8'))
    }
    const value = validatePriorJudgeCall(prior, request, protocol)
    if (value.status !== 'completed' && !(protocol.version === 2 && value.status === 'invalid-judgment')) throw Error('Prior judge failure blocks automatic resume')
    results.set(hash, value)
  } else if (files.has(`${hash}.started.json`) || files.has(`${hash}.request.json`)) throw Error('Prior judge call outcome is unknown; never resubmit it automatically')
}
const pending = [...unique].filter(([hash]) => !results.has(hash)), runtime = new CodexRuntime(), controllers = new Set()
let cursor = 0, dispatched = 0, stopped = false, cliVersion = null, runError = null
const interrupt = () => { stopped = true; for (const controller of controllers) controller.abort() }
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt)
async function worker() {
  while (!stopped && cursor < pending.length && dispatched < limit) {
    const [hash, request] = pending[cursor++]; dispatched++
    assertDispatchOwner()
    for (const [path, expected] of Object.entries(runtimeHashes)) if (sha256(await readFile(resolve(root, path))) !== expected) throw Error(`Judge runtime changed: ${path}`)
    assertDispatchOwner()
    const start = performance.now(), startedAt = new Date().toISOString(), controller = new AbortController()
    const value = { promptHash: hash, provider: protocol.provider, model: protocol.model, cliVersion, startedAt,
      status: 'running', dispatched: false, generationCompleted: false, rawText: '', usage: null, costUsd: null, serverEnforcedOutputTokenLimit: null }
    await writeFile(resolve(output, 'calls', `${hash}.request.json`), JSON.stringify({ promptHash: hash, model: protocol.model,
      messages: request.messages, outputSchema }, null, 2) + '\n', { flag: 'wx' })
    assertRunStorage()
    await writeFile(resolve(output, 'calls', `${hash}.started.json`), JSON.stringify({ promptHash: hash, startedAt }) + '\n', { flag: 'wx' })
    // A newly claimed successor either sees these exact receipts or this
    // former owner stops here. Only the claim's owner may enter the transport.
    assertDispatchOwner()
    controllers.add(controller); const timer = setTimeout(() => controller.abort(), protocol.budget.timeoutMs)
    try {
      console.log(JSON.stringify({ phase: 'requesting', call: results.size + 1, hash: hash.slice(0, 12) }))
      await runtime.generate({ id: hash, model: protocol.model, messages: request.messages, outputSchema }, update => {
        if (update.dispatched) {
          // Codex invokes this synchronously after its last account check,
          // immediately before writing turn/start. A thrown check sends no turn.
          if (history) verifyJudgeContinuationHistory(root, history)
          assertDispatchOwner()
          value.dispatched = true
        }
        if (update.text !== undefined) value.rawText = update.text
        if (update.usage) { value.usage = update.usage; if (!judgeUsageWithinBudget(update.usage, protocol)) controller.abort() }
      }, controller.signal)
      value.generationCompleted = true
      if (!judgeUsageWithinBudget(value.usage, protocol)) throw Error('Missing usage or observed budget exceeded')
      try {
        value.judgment = validateJudgeAnswer(value.rawText, request, protocol)
        value.status = 'completed'
      } catch (error) {
        if (protocol.version !== 2) throw error
        value.status = 'invalid-judgment'; value.validationError = String(error)
      }
    } catch (error) { stopped = true; value.status = value.dispatched && controller.signal.aborted ? 'unknown-or-interrupted' : 'failed'; value.error = String(error)
      value.codexDiagnostic = error.codexDiagnostic ?? null }
    finally {
      clearTimeout(timer); controllers.delete(controller); value.durationMs = performance.now() - start; value.completedAt = new Date().toISOString()
      assertRunStorage()
      await writeFile(resolve(output, 'calls', `${hash}.result.json`), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); results.set(hash, value)
      console.log(JSON.stringify({ phase: 'recorded', hash: hash.slice(0, 12), status: value.status, durationMs: Math.round(value.durationMs), usage: value.usage }))
    }
  }
}
try {
  if (!values['dry-run'] && pending.length) {
    assertDispatchOwner()
    if ((await findJudgeContinuationChildren(root, runIdentity, ownManifestSha256)).length) {
      throw Error('This judge run already authorized a continuation; use its latest descendant')
    }
    if (history) verifyJudgeContinuationHistory(root, history)
    await runtime.start()
    if ((await runtime.account()).state !== 'ready' || !(await runtime.models()).some(model => model.id === protocol.model)) throw Error('Frozen local judge model is unavailable; no fallback')
    if (history) verifyJudgeContinuationHistory(root, history)
    cliVersion = runtime.version
    const outcomes = await Promise.allSettled(Array.from({ length: protocol.concurrency }, () => worker().catch(error => { interrupt(); throw error })))
    const failure = outcomes.find(outcome => outcome.status === 'rejected')
    if (failure) throw failure.reason
  }
} catch (error) {
  runError = { error: String(error), codexDiagnostic: error.codexDiagnostic ?? null, newCohortAttempts: dispatched }
  console.error(JSON.stringify({ phase: 'run-failed-before-summary', ...runError }))
  throw error
} finally {
  runtime.close(); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt)
  const rows = prepared.flatMap(({ request, ...item }) => { const result = results.get(request.promptHash)
    return result?.status === 'completed' ? [{ ...item, judgePromptHash: request.promptHash, judgment: result.judgment }] : [] })
  const calls = [...results.values()], eligibleJudgmentsComplete = rows.length === prepared.length && calls.every(call => call.status === 'completed')
  const complete = !incomplete && eligibleJudgmentsComplete
  const executionCounts = judgeExecutionCounts(calls, unique.size)
  const coverageByCondition = Object.fromEntries([...new Set(prepared.map(item => item.condition))].sort().map(condition => {
    const selected = prepared.filter(item => item.condition === condition)
    const readerCoverage = incomplete?.coverage.byCondition[condition]
    return [condition, { totalObservations: readerCoverage?.planned ?? selected.length,
      ...(readerCoverage ? { eligibleObservations: selected.length, readerFailed: readerCoverage.failed, readerUnknown: readerCoverage.unknown } : {}),
      ...Object.fromEntries(['completed', 'invalid-judgment', 'failed', 'unknown-or-interrupted', 'not-attempted'].map(status =>
        [status, selected.filter(item => (results.get(item.request.promptHash)?.status ?? 'not-attempted') === status).length])) }]
  }))
  const unchanged = (await Promise.all(Object.entries({ ...sourceHashes, ...runtimeHashes }).map(async ([path, hash]) => sha256(await readFile(resolve(root, path))) === hash))).every(Boolean)
  const summary = { schema: incomplete ? 'storyforge.narrative-reader-incomplete-judge-results' : 'storyforge.narrative-reader-judge-results',
    version: frozen.version, createdAt: new Date().toISOString(),
    manifestSha256: sha256(frozen), provider: protocol.provider, model: protocol.model, readerModel: readerProtocol.model, cliVersion,
    runError,
    dryRun: values['dry-run'], complete, sourceUnchanged: unchanged,
    totalObservations: incomplete?.coverage.counts.planned ?? prepared.length, completedObservations: rows.length,
    distinctPrompts: unique.size, ...executionCounts, coverageByCondition,
    ...(incomplete ? { readerCoverage: incomplete.coverage, eligibleObservations: prepared.length, eligibleJudgmentsComplete,
      eligibleJudgmentExecutionComplete: executionCounts.executionComplete, executionComplete: false } : {}),
    ...(frozen.continuation ? { continuation: frozen.continuation, inheritedActualCalls: inherited.size,
      newCohortAttempts: dispatched, unresolvedPromptHashes: [...results].filter(([, value]) => value.status !== 'completed').map(([hash]) => hash) } : {}),
    usage: { inputTokens: calls.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0),
      outputTokens: calls.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0),
      unknownDispatchedCalls: calls.filter(call => call.dispatched && (!Number.isSafeInteger(call.usage?.inputTokens)
        || !Number.isSafeInteger(call.usage?.outputTokens))).length }, metrics: summarizeJudge(rows), rows,
    accepted: false, independentHumanReviews: 0, costUsd: null,
    evidenceBoundary: incomplete
      ? 'Diagnostic independent review of available historical reader answers only. Failed and unknown reader observations remain in planned denominators, never receive a judgment and are never redispatched. Even all eligible judgments cannot complete the original matrix or establish current-code, human, literary, product or performance acceptance.'
      : 'Independent model review of historical frozen synthetic reader answers. Partial pilot is not full evaluation; model judgments and traceable quotes do not establish human, literary, product or performance acceptance.' }
  const summaryName = judgeSummaryName(await readdir(output), calls.length)
  assertRunStorage()
  await writeFile(resolve(output, summaryName), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ phase: 'summary', actualCalls: executionCounts.dispatchedActualCalls, preDispatchFailures: executionCounts.preDispatchFailures,
    invalidJudgments: executionCounts.invalidJudgmentActualCalls, completedObservations: rows.length, complete, sourceUnchanged: unchanged, stopped }))
}
if (stopped) process.exitCode = 1
