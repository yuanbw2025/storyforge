import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const workflow = readFileSync(path.join(root, '.github/workflows/deploy-docs.yml'), 'utf8')
const verifier = path.join(root, 'scripts/deploy/verify-docs-ssh-host-key.mjs')
const host = 'docs-fixture.example.invalid'
const pinVariable = 'STORYFORGE_DOCS_HOST_KEY_SHA256'

/** @param {string} bin @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function command(bin, args, env = {}) {
  const result = spawnSync(bin, args, {
    cwd: root, encoding: 'utf8', timeout: 5_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  })
  if (result.error) throw result.error
  return result
}

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'sfqa133-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const files = ['pinned', 'replacement'].map((name, index) => {
    const key = path.join(directory, name)
    const kind = index === 0 ? 'ed25519' : 'ecdsa'
    assert.equal(command('ssh-keygen', ['-q', '-t', kind, '-N', '', '-f', key]).status, 0)
    const publicFile = key + '.pub'
    const fields = readFileSync(publicFile, 'utf8').trim().split(/\s+/)
    const fingerprint = command('ssh-keygen', ['-l', '-E', 'sha256', '-f', publicFile])
    assert.equal(fingerprint.status, 0)
    return { algorithm: fields[0], key: fields[1], pin: fingerprint.stdout.split(/\s+/)[1],
      line: host + ' ' + fields.slice(0, 2).join(' ') }
  })
  return { directory, pinned: files[0], replacement: files[1],
    scan: path.join(directory, 'candidates'), knownHosts: path.join(directory, 'known_hosts') }
}

/** @param {string} name */
function step(name) {
  const lines = workflow.split('\n')
  const start = lines.indexOf('      - name: ' + name)
  assert.ok(start >= 0)
  const body = lines.findIndex((line, index) => index > start && line === '        run: |')
  assert.ok(body > start)
  const script = []
  for (const line of lines.slice(body + 1)) {
    if (line.trim() && !line.startsWith('          ')) break
    script.push(line.slice(10))
  }
  return script.join('\n')
}

test('the workflow binds an independently configured pin before any deployment', () => {
  assert.match(workflow, /STORYFORGE_DOCS_HOST_KEY_SHA256: \$\{\{ secrets\.STORYFORGE_DOCS_HOST_KEY_SHA256 \}\}/)
  assert.match(workflow, /"scripts\/deploy\/verify-docs-ssh-host-key\.mjs"/)
  assert.doesNotMatch(workflow, /continue-on-error/)
  const prepare = step('Prepare SSH')
  const scanAt = prepare.indexOf('ssh-keyscan')
  const verifyAt = prepare.indexOf('verify-docs-ssh-host-key.mjs')
  const lookupAt = prepare.indexOf('ssh-keygen -F')
  const identityAt = prepare.indexOf('> "$ssh_dir/identity"')
  assert.ok(scanAt >= 0 && scanAt < verifyAt && verifyAt < lookupAt && lookupAt < identityAt)
})

test('the CLI writes only the pinned key using real OpenSSH public-key fingerprints', t => {
  const f = fixture(t)
  writeFileSync(f.scan, '# untrusted comment\n' + f.replacement.line + '\n' + f.pinned.line + '\n' + f.pinned.line + '\n')
  const result = command(process.execPath, [verifier, host, f.scan, f.knownHosts], { [pinVariable]: f.pinned.pin })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(f.knownHosts, 'utf8'), f.pinned.line + '\n')
  assert.equal(statSync(f.knownHosts).mode & 0o777, 0o600)
  assert.equal(command('ssh-keygen', ['-F', host, '-f', f.knownHosts]).status, 0)
  assert.notEqual(command('ssh-keygen', ['-F', 'wrong.example.invalid', '-f', f.knownHosts]).status, 0)
})

test('missing or wrong pins, mismatched host, algorithm and malformed keys leave an existing output untouched', t => {
  const f = fixture(t)
  writeFileSync(f.knownHosts, 'previous known_hosts bytes\n')
  const cases = [
    { line: f.pinned.line, pin: '' },
    { line: f.pinned.line, pin: 'SHA256:invalid' },
    { line: f.pinned.line, pin: f.pinned.pin + '=' },
    { line: f.replacement.line, pin: f.pinned.pin },
    { line: f.pinned.line.replace(host, 'wrong.example.invalid'), pin: f.pinned.pin },
    { line: host + ' ' + f.replacement.algorithm + ' ' + f.pinned.key, pin: f.pinned.pin },
    { line: host + ' ssh-ed25519 ' + f.pinned.key + '!', pin: f.pinned.pin },
    { line: host + ' ssh-ed25519 YQ==', pin: f.pinned.pin },
    { line: f.pinned.line + '\nmalformed untrusted record', pin: f.pinned.pin },
    { line: '# empty response', pin: f.pinned.pin },
  ]
  for (const item of cases) {
    writeFileSync(f.scan, item.line + '\n')
    const result = command(process.execPath, [verifier, host, f.scan, f.knownHosts], { [pinVariable]: item.pin })
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stderr, new RegExp(host.replaceAll('.', '\\.')))
    assert.equal(readFileSync(f.knownHosts, 'utf8'), 'previous known_hosts bytes\n')
    const fresh = path.join(f.directory, 'uncreated')
    assert.notEqual(command(process.execPath, [verifier, host, f.scan, fresh], { [pinVariable]: item.pin }).status, 0)
    assert.throws(() => statSync(fresh), { code: 'ENOENT' })
  }
  writeFileSync(f.scan, f.pinned.line + '\n')
  assert.notEqual(command(process.execPath, [verifier, host, f.scan, f.knownHosts], { [pinVariable]: f.pinned.pin }).status, 0)
  assert.equal(readFileSync(f.knownHosts, 'utf8'), 'previous known_hosts bytes\n')
})

test('the actual shell steps fail closed and pass strict SSH options to rsync without a network call', t => {
  const f = fixture(t)
  const bin = path.join(f.directory, 'bin')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'ssh-keyscan'), '#!/bin/sh\ncat "$SYNTHETIC_KEYSCAN"\n', { mode: 0o700 })
  writeFileSync(path.join(bin, 'rsync'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$RSYNC_ARGUMENTS"\n', { mode: 0o700 })
  const githubEnv = path.join(f.directory, 'github-env')
  const rsyncArgs = path.join(f.directory, 'rsync-args')
  const env = {
    PATH: bin + path.delimiter + process.env.PATH,
    RUNNER_TEMP: f.directory, GITHUB_ENV: githubEnv, SYNTHETIC_KEYSCAN: f.scan,
    SSH_HOST: host, SSH_USER: 'fixture', SSH_PRIVATE_KEY: 'synthetic-private-key-not-used-for-network',
    RSYNC_ARGUMENTS: rsyncArgs, [pinVariable]: f.pinned.pin,
  }
  const prepare = step('Prepare SSH')
  const deploy = step('Deploy to Tencent Cloud')
  writeFileSync(f.scan, f.replacement.line + '\n')
  const rejected = command('bash', ['--noprofile', '--norc', '-c', prepare], env)
  assert.notEqual(rejected.status, 0)
  assert.throws(() => statSync(githubEnv), { code: 'ENOENT' })
  assert.throws(() => statSync(rsyncArgs), { code: 'ENOENT' })
  assert.doesNotMatch(rejected.stdout + rejected.stderr, /synthetic-private-key|docs-fixture/)
  const missingPin = command('bash', ['--noprofile', '--norc', '-c', prepare], { ...env, [pinVariable]: '' })
  assert.notEqual(missingPin.status, 0)
  assert.throws(() => statSync(githubEnv), { code: 'ENOENT' })
  assert.notEqual(command('bash', ['--noprofile', '--norc', '-c', deploy], env).status, 0)
  assert.throws(() => statSync(rsyncArgs), { code: 'ENOENT' })

  writeFileSync(f.scan, f.pinned.line + '\n')
  const prepared = command('bash', ['--noprofile', '--norc', '-c', prepare], env)
  assert.equal(prepared.status, 0, prepared.stderr)
  const published = readFileSync(githubEnv, 'utf8').trim()
  assert.match(published, /^STORYFORGE_DOCS_SSH_DIR=/)
  const sshDir = published.slice('STORYFORGE_DOCS_SSH_DIR='.length)
  assert.equal(readFileSync(path.join(sshDir, 'known_hosts'), 'utf8'), f.pinned.line + '\n')
  assert.equal(statSync(path.join(sshDir, 'identity')).mode & 0o777, 0o600)
  assert.equal(command('bash', ['--noprofile', '--norc', '-c', deploy],
    { ...env, STORYFORGE_DOCS_SSH_DIR: sshDir }).status, 0)
  const args = readFileSync(rsyncArgs, 'utf8')
  for (const option of ['-F /dev/null', 'BatchMode=yes', 'StrictHostKeyChecking=yes', 'GlobalKnownHostsFile=/dev/null',
    'UpdateHostKeys=no', 'VerifyHostKeyDNS=no', "UserKnownHostsFile='" + sshDir + "/known_hosts'"]) {
    assert.ok(args.includes(option), option)
  }
  assert.match(args, /fixture@docs-fixture\.example\.invalid:\/var\/www\/storyforge-docs\//)
})
