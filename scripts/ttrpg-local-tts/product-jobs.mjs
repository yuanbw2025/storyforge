// One physical local worker, immutable job input and an irreversible launch
// claim. Creating/reading a waiting job never starts inference, even on restart.
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, existsSync, lstatSync, appendFileSync, statfsSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { base, stable, digest, exact, productProfile as profile, productProfiles, isQwenProfile, currentProductProfile, assertProductImplementation, readStoredProductJob, validateProductJob, verifyProductResult, ownedRuntime } from './product-contract.mjs'

function writeNew(file, value) {
  const fd = openSync(file, 'wx', 0o600)
  try { writeFileSync(fd, stable(value)); fsyncSync(fd) } finally { closeSync(fd) }
  const directory = openSync(path.dirname(file), 'r'); try { fsyncSync(directory) } finally { closeSync(directory) }
}
function atomic(file, value) { const temp = file + '.' + randomUUID() + '.tmp'; writeNew(temp, value); renameSync(temp, file); const dir = openSync(path.dirname(file), 'r'); try { fsyncSync(dir) } finally { closeSync(dir) } }
function ownedDirectory(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = lstatSync(dir)
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error('Unsafe owned job directory; preserve it')
}
function read(file) {
  const st = lstatSync(file)
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.nlink !== 1 || st.size > 65536) throw new Error('Unsafe owned job record')
  return JSON.parse(readFileSync(file, 'utf8'))
}
function processStart(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' } }).trim() || null }
  catch (error) {
    // ps uses exit 1 for an absent PID, but inspection errors can also return
    // 1. Only an empty, diagnostic-free absence is usable negative evidence.
    if (error.status === 1 && error.stdout != null && error.stderr != null && !error.stdout.toString().trim() && !error.stderr.toString().trim()) return null
    throw new Error('Cannot observe process identity; preserve the job')
  }
}
export function createProductVoiceJobs(runtimeDir, options = {}) {
  assertProductImplementation()
  const runtime = ownedRuntime(runtimeDir), jobs = path.join(runtime, 'product-jobs-v2'), lock = path.join(runtime, '.product-voice-worker.lock'), physicalSlot = path.join(runtime, '.eval.lock')
  let nativeRuntime = null
  try { if (options.qwenRuntimeDir !== undefined) nativeRuntime = ownedNativeRuntime(options.qwenRuntimeDir) }
  catch { /* An optional engine cannot disable the existing bridge/readers. Its profiles stay unavailable; no other voice is substituted. */ }
  const nativeSlot = nativeRuntime && path.join(nativeRuntime, '.eval.lock')
  mkdirSync(jobs, { recursive: true, mode: 0o700 })
  const active = new Map(), owner = { pid: process.pid, start: processStart(process.pid), token: randomUUID() }
  if (!owner.start || lstatSync(jobs).isSymbolicLink() || lstatSync(jobs).uid !== process.getuid()) throw new Error('Cannot own speech jobs')
  const worker = path.join(base, 'product-worker.py'), injected = typeof options.spawnWorker === 'function'
  let closed = false
  function ownedNativeRuntime(dir) {
    const st = lstatSync(dir)
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error('Unowned Qwen product assets')
    const admission = read(path.join(dir, 'product-asset-admission-v1.json'))
    const native = productProfiles.filter(isQwenProfile)
    if (admission.schema !== 'storyforge.ttrpg-qwen-product-assets' || admission.version !== 1 || admission.status !== 'verified-assets-only'
      || admission.modelCalls !== 0 || admission.adoptionAllowed !== false || admission.humanRightsAcceptance !== 'unproven'
      || native.some(p => p.nativeAssetProfileSha256 !== admission.nativeAssetProfileSha256)
      || stable(admission.productProfileIds) !== stable(native.map(p => p.profileId))) throw new Error('Qwen assets lack their separate explicit product admission')
    return path.resolve(dir)
  }
  function supported(p) {
    try { currentProductProfile(p); return !isQwenProfile(p) || !!nativeRuntime && ownedNativeRuntime(nativeRuntime) === nativeRuntime } catch { return false }
  }
  function directory(jobKey) { if (typeof jobKey !== 'string' || !/^ttrpg\.voice\.[1-9][0-9]*\.[a-f0-9]{64}$/.test(jobKey)) throw new Error('Invalid original job key'); return path.join(jobs, digest(jobKey)) }
  function cancellationFile(jobKey) { directory(jobKey); return path.join(jobs, 'cancellations', digest(jobKey) + '.json') }
  function persistCancellation(jobKey, reason) {
    const file = cancellationFile(jobKey)
    ownedDirectory(path.dirname(file))
    try { writeNew(file, { jobKey, inputArtifactHash: jobKey.slice(-64), reason, at: Date.now() }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    const stored = read(file)
    if (stored.jobKey !== jobKey || stored.inputArtifactHash !== jobKey.slice(-64)) throw new Error('Original cancellation identity changed')
  }
  function jobData(jobKey) {
    const dir = directory(jobKey)
    if (!existsSync(dir)) return null
    const st = lstatSync(dir)
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error('Unowned speech job')
    const input = readStoredProductJob(read(path.join(dir, 'input.json'))), record = read(path.join(dir, 'job.json'))
    if (input.jobKey !== jobKey || record.jobKey !== jobKey || record.inputArtifactHash !== input.inputArtifactHash) throw new Error('Original job binding changed')
    return { dir, input, record }
  }
  function liveWorker(dir) {
    const lines = execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n').slice(1)
    return lines.some(line => line.includes('product-worker.py') && line.includes(dir))
  }
  function archiveOwnPhysicalSlot(claim, kind) {
    if (!existsSync(physicalSlot)) return
    const held = read(physicalSlot)
    if (held.kind !== 'product-voice-physical-slot') return // Never retire an evaluation's lock.
    if (held.jobKey !== claim.jobKey || held.inputArtifactHash !== claim.inputArtifactHash || held.nonce !== claim.nonce) throw new Error('Physical speech slot identity changed')
    ownedDirectory(path.join(jobs, 'lock-history'))
    if (claim.nativeRuntime) {
      if (!nativeRuntime || path.resolve(claim.nativeRuntime) !== nativeRuntime) throw new Error('Original native slot needs its configured owner; preserve both claims')
      const native = read(nativeSlot)
      if (native.kind !== 'product-voice-native-slot' || native.nonce !== claim.nonce || native.jobKey !== claim.jobKey || native.inputArtifactHash !== claim.inputArtifactHash) throw new Error('Native physical slot owner changed')
      renameSync(nativeSlot, path.join(jobs, 'lock-history', 'native-' + kind + '-' + claim.nonce + '.json'))
    }
    renameSync(physicalSlot, path.join(jobs, 'lock-history', 'physical-' + kind + '-' + claim.nonce + '.json'))
  }
  function archiveUnlaunchedLocks(claim, physicalAcquired = true) {
    if (read(lock).nonce !== claim.nonce) throw new Error('Worker lock owner changed')
    if (physicalAcquired) archiveOwnPhysicalSlot(claim, 'not-launched')
    ownedDirectory(path.join(jobs, 'lock-history'))
    renameSync(lock, path.join(jobs, 'lock-history', 'not-launched-' + claim.nonce + '.json'))
  }
  function retireLockIfObservedAbsent() {
    if (!existsSync(lock)) return true
    const old = read(lock), dir = directory(old.jobKey)
    if (!old.owner || !Number.isSafeInteger(old.owner.pid) || !old.owner.start || !old.nonce) throw new Error('Unidentified worker lock; preserve all')
    const state = read(path.join(dir, 'job.json')), startedFile = path.join(dir, 'worker-started.json')
    const started = existsSync(startedFile) ? read(startedFile) : null
    const terminal = state.terminal?.kind === 'observed-child-close'
    if (liveWorker(dir)) return false
    if (!terminal && (!started || started.jobKey !== old.jobKey || started.launchNonce !== old.nonce
      || started.inputArtifactHash !== old.inputArtifactHash || !Number.isSafeInteger(started.pid) || !started.processStart
      || processStart(started.pid) === started.processStart)) return false
    // A missing controller PID is insufficient. A real terminal observation,
    // or a pinned worker's startup identity observed gone, is required. This
    // releases capacity only; an unconfirmed old job still stays unknown.
    archiveOwnPhysicalSlot(old, 'observed-absent')
    ownedDirectory(path.join(jobs, 'lock-history'))
    renameSync(lock, path.join(jobs, 'lock-history', 'unconfirmed-' + old.nonce + '.json'))
    return true
  }
  function projection(jobKey) {
    const job = jobData(jobKey)
    if (!job) return { jobKey, status: existsSync(cancellationFile(jobKey)) ? 'stop-requested-without-job' : 'not-found', canStart: false,
      futureStartBlocked: existsSync(cancellationFile(jobKey)), cancellationConfirmed: false }
    const { dir, input, record } = job, claim = existsSync(path.join(dir, 'start.json')) ? read(path.join(dir, 'start.json')) : null, running = active.get(jobKey)
    let status = record.status, cancellationConfirmed = record.cancellationConfirmed === true
    if (claim?.kind === 'cancelled-before-start') { status = 'cancelled-before-start'; cancellationConfirmed = true }
    else if (claim && !record.terminal && !running) status = liveWorker(dir) ? 'running-observed' : 'unknown'
    if (!claim && record.status !== 'waiting-for-slot' && record.status !== 'cancelled-before-start') throw new Error('Job status lacks its launch proof')
    return { jobKey, inputArtifactHash: input.inputArtifactHash, profileHash: input.execution.profileHash, status,
      canStart: supported(input.execution.profile) && !closed && !claim && record.status === 'waiting-for-slot' && !existsSync(path.join(runtime, '.setup.lock'))
        && (!isQwenProfile(input.execution.profile) || !existsSync(path.join(nativeRuntime, '.prepare.lock')) && !existsSync(nativeSlot))
        && retireLockIfObservedAbsent() && !existsSync(physicalSlot),
      cancellationRequested: existsSync(path.join(dir, 'cancel-request.json')), cancellationConfirmed,
      workerExecutionKind: record.workerExecutionKind, hasResultFile: existsSync(path.join(dir, 'result.json')), automaticRetryAllowed: false }
  }
  function create(value) {
    if (closed) throw new Error('Speech service closed')
    const input = validateProductJob(value), dir = directory(input.jobKey)
    assertProductImplementation(input.execution.profile)
    if (!supported(input.execution.profile)) throw new Error('Selected local voice engine is not configured; no job created')
    if (existsSync(dir)) {
      const prior = jobData(input.jobKey)
      if (stable(prior.input) !== stable(input)) throw new Error('Cannot replace the original speech payload')
      return projection(input.jobKey)
    }
    mkdirSync(dir, { mode: 0o700 })
    writeNew(path.join(dir, 'input.json'), input)
    writeNew(path.join(dir, 'job.json'), { jobKey: input.jobKey, inputArtifactHash: input.inputArtifactHash, status: 'waiting-for-slot', createdAt: Date.now(),
      workerExecutionKind: injected ? 'injected-test-worker' : 'pinned-offline-worker', cancellationConfirmed: false })
    if (existsSync(cancellationFile(input.jobKey))) return cancel(input.jobKey, 'persisted-original-cancel-before-create')
    return projection(input.jobKey)
  }
  function cancel(jobKey, reason = 'explicit-user-cancel') {
    // Persist before looking for the job. A cancelled request may still be
    // between browser dispatch and backend create; missing files prove no stop.
    persistCancellation(jobKey, reason)
    const job = jobData(jobKey)
    if (!job) return projection(jobKey)
    const file = path.join(job.dir, 'cancel-request.json')
    if (!existsSync(file)) writeNew(file, { jobKey, inputArtifactHash: job.input.inputArtifactHash, at: Date.now(), reason })
    const run = active.get(jobKey)
    if (run) run.stop(reason)
    else if (!existsSync(path.join(job.dir, 'start.json'))) {
      // Cancellation and start compete for the same immutable claim. Checking
      // two separate files would permit a false "never launched" race.
      try {
        writeNew(path.join(job.dir, 'start.json'), { kind: 'cancelled-before-start', jobKey, inputArtifactHash: job.input.inputArtifactHash, at: Date.now() })
        atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'cancelled-before-start', cancellationConfirmed: true, terminal: { kind: 'never-launched', at: Date.now() } })
      } catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    // No signal is sent to an unowned/reused PID after a service restart.
    return projection(jobKey)
  }
  function start(jobKey, inputArtifactHash) {
    if (closed) throw new Error('Speech service closed')
    const job = jobData(jobKey)
    if (!job || job.input.inputArtifactHash !== inputArtifactHash) throw new Error('Original speech input not found')
    if (existsSync(cancellationFile(jobKey))) return cancel(jobKey, 'original-stop-already-persisted')
    if (existsSync(path.join(job.dir, 'start.json')) || existsSync(path.join(job.dir, 'cancel-request.json'))) return projection(jobKey)
    validateProductJob(job.input)
    const selectedProfile = job.input.execution.profile, qwen = isQwenProfile(selectedProfile)
    assertProductImplementation(selectedProfile)
    if (!supported(selectedProfile)) throw new Error('Original selected engine is not configured')
    const profile = selectedProfile
    if (qwen && (existsSync(path.join(nativeRuntime, '.prepare.lock')) || existsSync(nativeSlot))) return projection(jobKey)
    if (existsSync(path.join(runtime, '.setup.lock')) || !retireLockIfObservedAbsent() || existsSync(physicalSlot)) return projection(jobKey)
    const disk = statfsSync(runtime)
    if (disk.bavail * disk.bsize < profile.minimumFreeBytes) throw new Error('Insufficient free space; original job retained without starting')
    const nonce = randomUUID(), claim = { kind: 'start-authorized', jobKey, inputArtifactHash, owner, nonce, at: Date.now(), ...(qwen ? { nativeRuntime } : {}) }
    try { writeNew(lock, claim) } catch (error) { if (error.code === 'EEXIST') return projection(jobKey); throw error }
    // The existing eval launcher owns this same exclusive file. Taking only
    // a separate product lock or checking the other's file would leave a
    // check/create race and allow two physical inference processes.
    try { writeNew(physicalSlot, { ...claim, kind: 'product-voice-physical-slot' }) }
    catch (error) { if (error.code !== 'EEXIST') throw error; archiveUnlaunchedLocks(claim, false); return projection(jobKey) }
    if (qwen) {
      try { writeNew(nativeSlot, { ...claim, kind: 'product-voice-native-slot' }) }
      catch (error) {
        // Candidate setup/eval won. We own only the common slot and must not
        // retire the other owner's candidate lock while releasing our claims.
        const held = read(physicalSlot)
        if (held.nonce !== nonce) throw new Error('Common slot ownership changed')
        ownedDirectory(path.join(jobs, 'lock-history'))
        renameSync(physicalSlot, path.join(jobs, 'lock-history', 'physical-not-launched-' + nonce + '.json'))
        archiveUnlaunchedLocks(claim, false)
        if (error.code !== 'EEXIST') throw error
        return projection(jobKey)
      }
    }
    // Installer owns .setup.lock before checking .eval.lock; both directions
    // recheck after claiming, so a simultaneous setup cannot alter live assets.
    if (existsSync(path.join(runtime, '.setup.lock')) || qwen && existsSync(path.join(nativeRuntime, '.prepare.lock'))) { archiveUnlaunchedLocks(claim); return projection(jobKey) }
    // Permanent claim precedes spawn. A lost return is unknown, never unsent.
    try { writeNew(path.join(job.dir, 'start.json'), claim) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      // The cancellation claim won before any spawn. Retain our unused lock
      // as evidence, and do not launch a worker behind that confirmation.
      archiveUnlaunchedLocks(claim)
      return projection(jobKey)
    }
    atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'launch-recorded', launchNonce: nonce })
    let leaseSequence = 1, leaseDue = process.hrtime.bigint() + BigInt(profile.authorizationLeaseMs) * 1000000n
    atomic(path.join(job.dir, 'lease.json'), { jobKey, inputArtifactHash, launchNonce: nonce, sequence: leaseSequence, expiresAt: Date.now() + profile.authorizationLeaseMs })
    if (existsSync(cancellationFile(jobKey)) || existsSync(path.join(job.dir, 'cancel-request.json'))) {
      atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'cancelled-before-spawn', launchNonce: nonce, cancellationConfirmed: true,
        terminal: { kind: 'own-launch-prevented', at: Date.now() } })
      archiveUnlaunchedLocks(claim)
      return projection(jobKey)
    }
    let child
    try {
      child = injected ? options.spawnWorker(job.dir, job.input) : spawn(path.join(runtime, 'venv/bin/python3'), ['-I', worker, '--runtime-dir', runtime, '--job-dir', job.dir], {
        cwd: runtime, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1',
          ...(qwen ? { STORYFORGE_QWEN_ASSET_DIR: nativeRuntime, TOKENIZERS_PARALLELISM: 'false', OMP_NUM_THREADS: String(profile.cpuThreads), OPENBLAS_NUM_THREADS: String(profile.cpuThreads), MKL_NUM_THREADS: String(profile.cpuThreads), VECLIB_MAXIMUM_THREADS: String(profile.cpuThreads) } : {}) },
      })
    } catch (error) {
      atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'unknown', launchNonce: nonce, errorCode: 'spawn-return-unknown' }); throw error
    }
    let killTimer, terminal = false, stopped = false
    const counts = { stdout: 0, stderr: 0 }, truncated = { stdout: false, stderr: false }
    const stop = reason => {
      if (terminal || stopped) return
      stopped = true
      if (!existsSync(path.join(job.dir, 'cancel-request.json'))) writeNew(path.join(job.dir, 'cancel-request.json'), { jobKey, inputArtifactHash, reason, at: Date.now() })
      if (injected) child.kill('SIGTERM'); else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error } }
      killTimer = setTimeout(() => { if (!terminal) { if (injected) child.kill('SIGKILL'); else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } } } }, 5000)
      killTimer.unref()
    }
    active.set(jobKey, { child, stop, renew() {
      if (terminal || stopped) throw new Error('Original worker is not renewably active')
      if (existsSync(cancellationFile(jobKey)) || existsSync(path.join(job.dir, 'cancel-request.json'))) { stop('persisted-original-cancel'); throw new Error('Original cancellation already persisted') }
      if (process.hrtime.bigint() >= leaseDue) { stop('original-authorization-lease-expired'); throw new Error('Original authorization lease already expired') }
      leaseSequence++
      atomic(path.join(job.dir, 'lease.json'), { jobKey, inputArtifactHash, launchNonce: nonce, sequence: leaseSequence, expiresAt: Date.now() + profile.authorizationLeaseMs })
      leaseDue = process.hrtime.bigint() + BigInt(profile.authorizationLeaseMs) * 1000000n
    } })
    for (const name of ['stdout', 'stderr']) child[name]?.on('data', data => {
      const remaining = profile.maxDiagnosticBytes - counts.stdout - counts.stderr
      if (remaining > 0) appendFileSync(path.join(job.dir, name + '.log'), data.subarray(0, remaining), { mode: 0o600 })
      counts[name] += data.length
      if (counts.stdout + counts.stderr > profile.maxDiagnosticBytes) { truncated[name] = true; stop('diagnostic-output-limit') }
    })
    const deadline = setTimeout(() => stop('profile-deadline'), profile.timeoutMs); deadline.unref()
    const leaseTimer = setInterval(() => { if (process.hrtime.bigint() > leaseDue) stop('original-authorization-lease-expired') }, 500); leaseTimer.unref()
    child.once('error', () => { /* close is the authoritative terminal; never retry spawn */ })
    child.once('close', (code, signal) => {
      terminal = true; clearTimeout(deadline); clearTimeout(leaseTimer); clearTimeout(killTimer); active.delete(jobKey)
      const result = existsSync(path.join(job.dir, 'result.json'))
      const cancelled = stopped || existsSync(cancellationFile(jobKey)) || existsSync(path.join(job.dir, 'cancel-request.json'))
      const status = code === 0 && result ? 'generated' : cancelled ? 'cancelled-confirmed' : 'failed'
      try {
        atomic(path.join(job.dir, 'job.json'), { ...job.record, status, launchNonce: nonce, cancellationConfirmed: cancelled && status !== 'generated',
          lateResult: cancelled && status === 'generated', diagnostics: { counts, truncated }, terminal: { kind: 'observed-child-close', code, signal, at: Date.now() } })
        if (existsSync(lock) && read(lock).nonce === nonce) {
          archiveOwnPhysicalSlot(claim, 'terminal')
          ownedDirectory(path.join(jobs, 'lock-history'))
          renameSync(lock, path.join(jobs, 'lock-history', 'terminal-' + nonce + '.json'))
        }
      } catch { /* Keep the original files/claim. Reading projects unknown; no retry or false stop receipt. */ }
    })
    atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'running', launchNonce: nonce, childPid: child.pid ?? null })
    return projection(jobKey)
  }
  function verifiedOutput(job) {
    const result = read(path.join(job.dir, 'result.json')), wavPath = path.join(job.dir, 'audio.wav'), st = lstatSync(wavPath)
    if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || st.nlink !== 1 || st.size > profile.maxAudioBytes || st.size < 46) throw new Error('Invalid owned audio output')
    const bytes = readFileSync(wavPath); verifyProductResult(result, bytes, job.input)
    return { result, bytes }
  }
  function raw(jobKey) {
    const job = jobData(jobKey), state = projection(jobKey), terminal = job?.record.terminal
    if (!job || state.status !== 'generated' || !(terminal?.kind === 'observed-child-close' && terminal.code === 0
      || terminal?.kind === 'verified-result-worker-absent')) throw new Error('No observed complete raw speech result; inspect the original job')
    const { result, bytes } = verifiedOutput(job)
    if (terminal.kind === 'verified-result-worker-absent' && (terminal.resultHash !== digest(stable(result)) || terminal.audioHash !== digest(bytes))) throw new Error('Recovered original output changed')
    // Freeze small first-delivery metadata, not another copy of audio. A later
    // stop changes status, but cannot change the exact response bound by a Run
    // recovery checkpoint. Incomplete/corrupt exclusive records fail closed.
    const binding = { version: 1, jobKey, inputArtifactHash: job.input.inputArtifactHash, launchNonce: job.record.launchNonce,
      resultHash: digest(stable(result)), audioHash: digest(bytes), workerExecutionKind: state.workerExecutionKind, completionEvidence: terminal.kind }
    const file = path.join(job.dir, 'raw-delivery-v1.json')
    try { writeNew(file, { ...binding, cancellationRequested: state.cancellationRequested }) }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    const delivery = read(file)
    if (!exact(delivery, [...Object.keys(binding), 'cancellationRequested']) || Object.entries(binding).some(([key, value]) => delivery[key] !== value)
      || typeof delivery.cancellationRequested !== 'boolean') throw new Error('Original raw delivery evidence changed; preserve it')
    return { schema: 'storyforge.ttrpg-local-tts-product-raw-response', version: 1, result: JSON.parse(stable(result)), workerExecutionKind: delivery.workerExecutionKind,
      completionEvidence: delivery.completionEvidence, cancellationRequested: delivery.cancellationRequested, audio: { encoding: 'base64', data: bytes.toString('base64') }, candidateAccepted: false, adoptionAllowed: false }
  }
  function recoverRaw(jobKey, inputArtifactHash) {
    const job = jobData(jobKey)
    if (!job || job.input.inputArtifactHash !== inputArtifactHash) throw new Error('Original speech input not found')
    if (job.record.status === 'generated') return raw(jobKey)
    if (job.record.terminal) throw new Error('Original known terminal is retained; recovery cannot erase it')
    const claim = read(path.join(job.dir, 'start.json')), started = read(path.join(job.dir, 'worker-started.json'))
    if (active.has(jobKey) || claim.kind !== 'start-authorized' || claim.jobKey !== jobKey || claim.inputArtifactHash !== inputArtifactHash
      || typeof claim.nonce !== 'string' || !/^[a-f0-9-]{36}$/.test(claim.nonce) || job.record.launchNonce !== claim.nonce
      || !claim.owner?.start || !Number.isSafeInteger(claim.owner.pid) || claim.owner.pid < 1 || processStart(claim.owner.pid) === claim.owner.start
      || started.jobKey !== jobKey || started.inputArtifactHash !== inputArtifactHash || started.launchNonce !== claim.nonce
      || !started.processStart || !Number.isSafeInteger(started.pid) || started.pid < 1 || processStart(started.pid) === started.processStart || liveWorker(job.dir)) throw new Error('Original owner/worker is live or unconfirmed; preserve unknown')
    const { result, bytes } = verifiedOutput(job)
    atomic(path.join(job.dir, 'job.json'), { ...job.record, status: 'generated', cancellationConfirmed: false,
      lateResult: existsSync(path.join(job.dir, 'cancel-request.json')), terminal: { kind: 'verified-result-worker-absent', at: Date.now(), resultHash: digest(stable(result)), audioHash: digest(bytes) } })
    return raw(jobKey)
  }
  function renew(jobKey, inputArtifactHash) {
    const job = jobData(jobKey), run = active.get(jobKey)
    if (!job || job.input.inputArtifactHash !== inputArtifactHash) throw new Error('Original live worker cannot be renewed from an unknown job')
    // The owned child can close between the caller's running GET and /lease.
    // Return its proven success without writing a lease or touching the result.
    // raw() still validates the complete original PCM before any candidate.
    const terminal = job.record.terminal
    if (!run && job.record.status === 'generated' && (terminal?.kind === 'observed-child-close' && terminal.code === 0
      || terminal?.kind === 'verified-result-worker-absent')) return projection(jobKey)
    if (!run) throw new Error('Original live worker cannot be renewed from an unknown job')
    run.renew(); return projection(jobKey)
  }
  return { profiles: () => productProfiles.filter(supported), create, get: projection, start, cancel, renew, raw, recoverRaw, close() { closed = true; for (const [key] of active) cancel(key, 'owning-service-closed') } }
}
