import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { sha256 } from './narrative-reader-contract.mjs'
import { validateJudgeContinuationParent, validatePriorJudgeCall } from './narrative-reader-judge-contract.mjs'

/** @typedef {{version: number, run: string, manifestSha256: string, claimPath: string, claimSha256: string,
 * policy: string, inheritedPromptHashes: string[], unresolvedPromptHashes: string[]}} JudgeContinuation */
/** @typedef {{manifestSha256: string, files: Record<string, string>, directories: Record<string, string[]>,
 * results: Map<string, {status: 'completed' | 'failed' | 'unknown-or-interrupted' | 'invalid-judgment'}>}} JudgeHistory */

const rawRoot = 'tests/acceptance/narrative-world/raw'
const claimDirectory = `${rawRoot}/judge-continuation-claims`
/** @param {string} parent */
const claimPathFor = parent => `${claimDirectory}/${sha256({ parent })}.json`

/** @param {string} root @param {string} run */
function rawPath(root, run) {
  const full = resolve(root, run)
  const path = relative(root, full)
  if (!path.startsWith(`${rawRoot}/`) || path.startsWith(`${claimDirectory}/`) || path === claimDirectory) {
    throw Error('Judge continuation requires a repository-owned raw run directory')
  }
  return { full, path }
}

/** @param {string} full */
function assertCanonicalDirectory(full) {
  if (!lstatSync(full).isDirectory() || realpathSync(full) !== full) {
    throw Error(`Judge requires a canonical directory; use the real path: ${full}`)
  }
}

/** @param {string} root @param {string} run */
export function canonicalJudgeRun(root, run, { allowMissing = false } = {}) {
  const directory = rawPath(root, run)
  try { assertCanonicalDirectory(directory.full) }
  catch (error) {
    if (!allowMissing || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    assertCanonicalDirectory(dirname(directory.full))
  }
  return directory
}

/** @param {string} output */
export function assertCanonicalJudgeCalls(output) {
  assertCanonicalDirectory(resolve(output, 'calls'))
}

/** @param {string} full */
export function readCanonicalJudgeFile(full) {
  if (!lstatSync(full).isFile() || realpathSync(full) !== full) {
    throw Error(`Judge requires a canonical evidence file: ${full}`)
  }
  return readFileSync(full)
}

/** @param {string} root @param {string} run @param {string} parentManifestSha256 @param {string} output */
function claimFor(root, run, parentManifestSha256, output) {
  const parent = canonicalJudgeRun(root, run), target = canonicalJudgeRun(root, output, { allowMissing: true })
  if (parent.full === target.full || !/^[0-9a-f]{64}$/.test(parentManifestSha256)) {
    throw Error('Judge continuation requires distinct canonical run directories and a frozen parent manifest')
  }
  // The stable run path owns one immutable record; changing the parent
  // manifest bytes cannot mint a second claim.
  const path = claimPathFor(parent.path)
  const claim = { version: 1, parent: parent.path, parentManifestSha256, output: target.path }
  const bytes = JSON.stringify(claim, null, 2) + '\n'
  return { path, bytes }
}

/** @param {string} root @param {string} run @param {string} parentManifestSha256 @param {string} output */
export function verifyJudgeContinuationClaim(root, run, parentManifestSha256, output) {
  const { path, bytes } = claimFor(root, run, parentManifestSha256, output)
  const absolute = resolve(root, path)
  const original = readCanonicalJudgeFile(absolute)
  if (!original.equals(Buffer.from(bytes))) throw Error('Parent judge batch already has a different continuation or invalid claim')
  return { path, sha256: sha256(original) }
}

/** @param {string} root @param {string} run @param {string} parentManifestSha256 @param {string} output */
export async function reserveJudgeContinuation(root, run, parentManifestSha256, output) {
  const { path, bytes } = claimFor(root, run, parentManifestSha256, output)
  await mkdir(resolve(root, claimDirectory), { recursive: true })
  if (await realpath(resolve(root, claimDirectory)) !== resolve(root, claimDirectory)) {
    throw Error('Judge continuation claim directory must be canonical')
  }
  try { await writeFile(resolve(root, path), bytes, { flag: 'wx' }) }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  return verifyJudgeContinuationClaim(root, run, parentManifestSha256, output)
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => sha256(a) === sha256(b)
/** @param {Record<string, unknown> | null | undefined} value */
const sorted = value => Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))

/** Older judge continuations were saved without a claim. See them before
 * allowing a new fork, without modifying their historical evidence. */
/** @param {string} root @param {string} run @param {string} parentManifestSha256 */
export async function findJudgeContinuationChildren(root, run, parentManifestSha256) {
  const parent = canonicalJudgeRun(root, run)
  /** @type {string[]} */
  const children = []
  /** @param {string} directory */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.some(entry => entry.isFile() && entry.name === 'manifest.json')) {
      const path = relative(root, directory)
      let manifest
      try { manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')) }
      catch (error) { if (!(error instanceof SyntaxError)) throw error }
      const claim = manifest?.continuation
      if (['storyforge.narrative-reader-judge-run', 'storyforge.narrative-reader-incomplete-judge-run'].includes(manifest?.schema)
        && claim?.run === parent.path) {
        if (claim.manifestSha256 !== parentManifestSha256) throw Error('Historical judge continuation refers to different parent manifest bytes')
        children.push(path)
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !['calls', 'judge-continuation-claims', 'reader-continuation-claims'].includes(entry.name)) {
        await visit(resolve(directory, entry.name))
      }
    }
  }
  await visit(resolve(root, rawRoot))
  return children.sort()
}

/** @param {string} root @param {JudgeHistory} history */
export function verifyJudgeContinuationHistory(root, history) {
  for (const [path, hash] of Object.entries(history.files)) {
    const full = resolve(root, path)
    let unchanged = false
    try { unchanged = sha256(readCanonicalJudgeFile(full)) === hash }
    catch (error) { throw Error(`Historical judge evidence changed: ${path}`, { cause: error }) }
    if (!unchanged) throw Error(`Historical judge evidence changed: ${path}`)
  }
  for (const [path, names] of Object.entries(history.directories)) {
    const full = resolve(root, path)
    assertCanonicalDirectory(full)
    if (!same(readdirSync(full).sort(), names)) {
      throw Error(`Historical judge call inventory changed: ${path}`)
    }
  }
}

/** @param {string} root @param {string} run
 * @param {{version: number, sourceHashes: Record<string, string>}} frozen
 * @param {Map<string, unknown>} unique
 * @param {{version: number, model: string, provider: string}} protocol
 * @param {Set<string>} seen
 * @returns {Promise<JudgeHistory>} */
export async function readJudgeContinuationHistory(root, run, frozen, unique, protocol, seen = new Set()) {
  const directory = canonicalJudgeRun(root, run)
  if (seen.has(directory.path) || seen.size >= 16) {
    throw Error('Cyclic, excessive or noncanonical judge continuation chain')
  }
  seen.add(directory.path)
  /** @type {Record<string, string>} */
  const files = {}
  /** @type {Record<string, string[]>} */
  const directories = {}
  /** @param {string} name */
  async function json(name) {
    const full = resolve(directory.full, name)
    const bytes = readCanonicalJudgeFile(full)
    files[relative(root, full)] = sha256(bytes)
    return JSON.parse(bytes.toString('utf8'))
  }
  const parent = await json('manifest.json')
  const manifestSha256 = files[`${directory.path}/manifest.json`]
  /** @type {JudgeHistory['results']} */
  const results = new Map()
  if (!parent.continuation) validateJudgeContinuationParent(parent, frozen)
  else {
    const edge = parent.continuation
    if (parent.version !== frozen.version + 1 || (edge.version !== undefined && edge.version !== 1)) {
      throw Error('Unknown judge continuation manifest')
    }
    const previous = await readJudgeContinuationHistory(root, edge.run, frozen, unique, protocol, seen)
    if (edge.manifestSha256 !== previous.manifestSha256 || !same(edge.inheritedPromptHashes, [...previous.results.keys()])
      || !same(edge.unresolvedPromptHashes, [...previous.results].filter(([, result]) => result.status !== 'completed').map(([hash]) => hash))) {
      throw Error('Historical judge continuation ancestry changed')
    }
    if (edge.version === 1) {
      const claim = verifyJudgeContinuationClaim(root, edge.run, previous.manifestSha256, directory.path)
      if (edge.claimPath !== claim.path || edge.claimSha256 !== claim.sha256) throw Error('Historical judge claim changed')
      // The parent claim is an input of this descendant, not of its own parent.
      Object.assign(previous.files, { [claim.path]: claim.sha256 })
    } else {
      const children = await findJudgeContinuationChildren(root, edge.run, previous.manifestSha256)
      if (!same(children, [directory.path])) throw Error('Historical judge batch has competing continuations; no new dispatch')
    }
    if (!same(sorted(parent.sourceHashes), sorted({ ...frozen.sourceHashes, ...previous.files }))) {
      throw Error('Historical judge continuation source files changed')
    }
    validateJudgeContinuationParent({ ...parent, version: frozen.version, continuation: undefined, sourceHashes: frozen.sourceHashes }, frozen)
    Object.assign(files, previous.files)
    Object.assign(directories, previous.directories)
    for (const [hash, value] of previous.results) results.set(hash, value)
  }
  assertCanonicalJudgeCalls(directory.full)
  const callsPath = `${directory.path}/calls`
  const names = (await readdir(resolve(root, callsPath))).sort()
  const namesSet = new Set(names)
  directories[callsPath] = names
  for (const file of names) {
    const match = /^([a-f0-9]{64})\.(request|started|result)\.json$/.exec(file)
    if (!match || !unique.has(match[1]) || results.has(match[1])) throw Error('Unexpected or repeated historical judge call artifact')
  }
  for (const [hash, request] of unique) {
    /** @type {Record<string, unknown>} */
    const prior = {}
    for (const kind of ['request', 'started', 'result']) {
      if (namesSet.has(`${hash}.${kind}.json`)) prior[kind] = await json(`calls/${hash}.${kind}.json`)
    }
    if (Object.keys(prior).length) results.set(hash, validatePriorJudgeCall(prior, request, protocol))
  }
  return { manifestSha256, files, directories, results }
}

/** A known successor owns all remaining inputs. The parent can still be read
 * or reported; it may not send new turns while a continuation exists. */
/** @param {string} root @param {string} run */
export function assertJudgeRunHasNoClaim(root, run) {
  const parent = canonicalJudgeRun(root, run)
  const path = claimPathFor(parent.path)
  try { lstatSync(resolve(root, path)) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return; throw error }
  throw Error('This judge run already authorized a continuation; use its latest descendant')
}
