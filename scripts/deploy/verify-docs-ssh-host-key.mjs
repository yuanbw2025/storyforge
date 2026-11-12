import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const supportedAlgorithms = new Set([
  'ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521',
])

/** @param {string} scan @param {string} host @param {string} expectedPin */
function verifyHostKey(scan, host, expectedPin) {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)
    || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(expectedPin)
    || Buffer.from(expectedPin.slice(7), 'base64').toString('base64').slice(0, -1) !== expectedPin.slice(7)) {
    throw new Error('The docs SSH host or configured SHA256 fingerprint is missing or invalid.')
  }

  const matches = new Set()
  for (const line of scan.split('\n')) {
    const record = line.trim()
    if (!record || record.startsWith('#')) continue
    const fields = record.split(/\s+/)
    const [candidateHost, algorithm, encoded] = fields
    if (fields.length !== 3 || candidateHost !== host || !supportedAlgorithms.has(algorithm)) {
      throw new Error('The docs SSH scan returned an invalid host or key algorithm.')
    }
    const bytes = Buffer.from(encoded, 'base64')
    const expectedAlgorithm = Buffer.from(algorithm)
    const algorithmLength = expectedAlgorithm.length
    if (bytes.toString('base64') !== encoded || bytes.length <= 4 + algorithmLength
      || bytes.readUInt32BE(0) !== algorithmLength || !bytes.subarray(4, 4 + algorithmLength).equals(expectedAlgorithm)) {
      throw new Error('The docs SSH scan returned an invalid public-key blob.')
    }
    const fingerprint = 'SHA256:' + createHash('sha256').update(bytes).digest('base64').slice(0, -1)
    if (fingerprint === expectedPin) matches.add(record)
  }
  if (matches.size !== 1) throw new Error('The docs SSH scan did not return exactly one pinned host key.')
  return [...matches][0] + '\n'
}

function run() {
  const [host, candidatesPath, knownHostsPath] = process.argv.slice(2)
  if (!host || !candidatesPath || !knownHostsPath || process.argv.length !== 5) {
    throw new Error('The docs SSH verifier requires a host, candidate file and fresh known-hosts file.')
  }

  let candidates
  try {
    candidates = readFileSync(candidatesPath, 'utf8')
  } catch {
    throw new Error('Unable to read docs SSH host-key candidates.')
  }
  const verified = verifyHostKey(candidates, host, process.env.STORYFORGE_DOCS_HOST_KEY_SHA256 ?? '')
  try {
    writeFileSync(knownHostsPath, verified, { flag: 'wx', mode: 0o600 })
  } catch {
    throw new Error('Unable to create the private docs SSH known-hosts file.')
  }
}

try {
  run()
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : 'Unable to verify docs SSH host-key candidates.')
  process.exitCode = 1
}
