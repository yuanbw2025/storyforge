import * as fs from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sha256 } from './narrative-reader-contract.mjs'

export const READER_STORAGE_POLICY = Object.freeze({ version: 1, minimumFreeBytes: 64 * 1024 ** 2,
  maximumCallReceiptBytes: 1024 ** 2, maximumSummaryBytes: 16 * 1024 ** 2,
  journal: 'sha256 JSON lines; sync before generation and after each recorded milestone',
  commit: 'synced staging file, exclusive hard link, synced destination directory',
  boundary: 'Admission check is not a disk reservation. Journal evidence is audit-only until validated; never resubmit a started input.' })

export function readerStorageDiagnostic(error) {
  const known = ['ENOSPC', 'EDQUOT', 'EIO', 'EROFS', 'EEXIST', 'EMFILE', 'ENFILE', 'EFBIG', 'READER_STORAGE_LOW_SPACE']
  const operations = ['write', 'admission', 'receipt-size', 'commit', 'identity', 'closed-or-broken-journal', 'journal-kind', 'journal-size', 'journal']
  return { code: known.includes(error?.code) ? error.code : 'unclassified',
    operation: operations.includes(error?.receiptOperation) ? error.receiptOperation : 'unknown' }
}

function storageError(code, operation) {
  return Object.assign(new Error(`Reader receipt storage failed (${code}; ${operation}); new dispatch must stop.`),
    { code, receiptOperation: operation })
}

/** Synchronous, small writes are intentional: notify() must finish recording
 * submission intent before the transport may send turn/start. It is not a
 * provider acknowledgement or proof that a model completed the request. */
export function createReaderReceiptStore(output, io = fs) {
  const journalDirectory = resolve(output, 'receipt-journal'), staging = resolve(journalDirectory, 'staging')
  io.mkdirSync(staging, { recursive: true })
  const syncDirectory = path => {
    const fd = io.openSync(path, 'r')
    try { io.fsyncSync(fd) } finally { io.closeSync(fd) }
  }
  const writeAll = (fd, bytes) => {
    let offset = 0
    while (offset < bytes.length) {
      const count = io.writeSync(fd, bytes, offset, bytes.length - offset)
      if (!Number.isInteger(count) || count <= 0) throw storageError('EIO', 'write')
      offset += count
    }
  }
  function assertCapacity() {
    const status = io.statfsSync(output, { bigint: true })
    const available = status.bavail * status.bsize
    if (available < BigInt(READER_STORAGE_POLICY.minimumFreeBytes)) throw storageError('READER_STORAGE_LOW_SPACE', 'admission')
    return { availableBytes: String(available), minimumFreeBytes: READER_STORAGE_POLICY.minimumFreeBytes }
  }
  function writeJson(file, value, maximumBytes = READER_STORAGE_POLICY.maximumCallReceiptBytes) {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n')
    if (bytes.length > maximumBytes) throw storageError('EFBIG', 'receipt-size')
    const temporary = resolve(staging, `${randomUUID()}.json`)
    let fd
    try {
      fd = io.openSync(temporary, 'wx', 0o600)
      writeAll(fd, bytes); io.fsyncSync(fd); io.closeSync(fd); fd = undefined
      // link() cannot overwrite an existing request/start/result/summary.
      io.linkSync(temporary, file); syncDirectory(dirname(file))
      io.unlinkSync(temporary); syncDirectory(staging)
    } catch (error) {
      if (fd !== undefined) { try { io.closeSync(fd) } catch { /* preserve the write failure */ } }
      error.receiptOperation ??= 'commit'
      // A staged file is forensic evidence, not a committed result. Keep it.
      throw error
    }
  }
  function begin({ promptHash, startedAt, model }, startedPath) {
    assertCapacity()
    if (!/^[a-f0-9]{64}$/.test(promptHash)) throw storageError('EIO', 'identity')
    writeJson(startedPath, { promptHash, startedAt, model })
    const path = resolve(journalDirectory, `${promptHash}.jsonl`)
    const fd = io.openSync(path, 'wx', 0o600)
    let sequence = 0, closed = false, broken = false
    function append(kind, payload) {
      if (closed || broken) throw storageError('EIO', 'closed-or-broken-journal')
      if (!['started', 'submission-intent', 'usage', 'generation-completed', 'terminal-receipt'].includes(kind)) throw storageError('EIO', 'journal-kind')
      const body = { version: 1, promptHash, sequence, kind, payload }
      const bytes = Buffer.from(JSON.stringify({ body, sha256: sha256(body) }) + '\n')
      if (bytes.length > READER_STORAGE_POLICY.maximumCallReceiptBytes) throw storageError('EFBIG', 'journal-size')
      try { writeAll(fd, bytes); io.fsyncSync(fd); sequence++ }
      catch (error) { broken = true; error.receiptOperation ??= 'journal'; throw error }
    }
    try { append('started', { startedAt, model }); syncDirectory(journalDirectory) }
    catch (error) { io.closeSync(fd); throw error }
    return { path, append, close() { if (!closed) { closed = true; io.closeSync(fd) } } }
  }
  return { assertCapacity, writeJson, begin }
}

/** Read-only forensic view. A damaged suffix cannot promote a partial event or
 * manufacture a terminal. Even intact events are not author/quality approval. */
export function inspectReaderReceiptJournal(bytes, promptHash) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : bytes
  const lines = text.split('\n'), events = [], trailingPartial = lines.pop()
  let corruption = null
  for (const line of lines) {
    try {
      const value = JSON.parse(line), body = value.body
      if (body?.version !== 1 || body.promptHash !== promptHash || body.sequence !== events.length
        || sha256(body) !== value.sha256) throw Error('identity, sequence or checksum mismatch')
      const kinds = events.map(event => event.kind)
      if (!['started', 'submission-intent', 'usage', 'generation-completed', 'terminal-receipt'].includes(body.kind)
        || !events.length && body.kind !== 'started' || kinds.includes('terminal-receipt')
        || body.kind === 'started' && events.length
        || body.kind === 'submission-intent' && kinds.includes('submission-intent')
        || ['usage', 'generation-completed'].includes(body.kind) && !kinds.includes('submission-intent')
        || body.kind === 'generation-completed' && kinds.includes('generation-completed')) throw Error('invalid journal transition')
      events.push(body)
    } catch { corruption = 'invalid-complete-line'; break }
  }
  if (!corruption && trailingPartial) corruption = 'incomplete-final-line'
  return { version: 1, promptHash, events, corruption, automaticRecoveryAllowed: false,
    generationCompletedEvidence: [...events].reverse().find(event => event.kind === 'generation-completed')?.payload ?? null,
    terminalEvidence: [...events].reverse().find(event => event.kind === 'terminal-receipt')?.payload ?? null,
    accepted: false }
}
