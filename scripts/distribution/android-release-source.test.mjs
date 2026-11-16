import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertCleanAndroidBuildSource, writeAndroidBuildSource } from './android-build-source.mjs'

const checker = fileURLToPath(new URL('./verify-android-source.py', import.meta.url))

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'storyforge-apk-source-'))
  /** @param {...string} args */
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q'); git('config', 'user.name', 'isolated test'); git('config', 'user.email', 'test@example.invalid')
  writeFileSync(path.join(root, '.gitignore'), 'web/\n*.apk\n*.json.tmp\nphases/\n')
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '4.0.6' }))
  git('add', '.gitignore', 'package.json'); git('commit', '-qm', 'isolated source')
  const web = path.join(root, 'web')
  mkdirSync(path.join(web, 'storyforge/assets'), { recursive: true })
  writeFileSync(path.join(web, 'index.html'), '<html>route</html>')
  writeFileSync(path.join(web, 'storyforge/index.html'), '<html>current</html>')
  writeFileSync(path.join(web, 'storyforge/assets/app.js'), 'original synthetic payload')
  const previous = process.env.STORYFORGE_ANDROID_SOURCE_SHA
  delete process.env.STORYFORGE_ANDROID_SOURCE_SHA
  let info
  try { info = await writeAndroidBuildSource(root, web) }
  finally { if (previous !== undefined) process.env.STORYFORGE_ANDROID_SOURCE_SHA = previous }
  return { root, web, git, info }
}

/** @param {Awaited<ReturnType<typeof fixture>>} f */
function apk(f, mutation = '') {
  const destination = path.join(f.root, 'candidate.apk')
  const code = `import pathlib,zipfile,json,sys
web=pathlib.Path(sys.argv[1]); target=sys.argv[2]
${mutation}
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
 for p in web.rglob('*'):
  if p.is_file(): z.writestr('assets/public/'+p.relative_to(web).as_posix(),p.read_bytes())
 z.writestr('assets/public/capacitor.js','native bridge')
`
  execFileSync('python3', ['-c', code, f.web, destination])
  return destination
}

/** @param {Awaited<ReturnType<typeof fixture>>} f
 * @param {string} [operation]
 * @param {string[]} [extra] */
function run(f, operation = 'verify', extra = []) {
  return spawnSync('python3', [checker, operation, path.join(f.root, 'candidate.apk'), '--commit', f.info.sourceCommit,
    '--tree', f.info.sourceTree, '--version', '4.0.6', ...extra], { encoding: 'utf8' })
}

test('signed payload evidence is bound to clean source and every application byte', async () => {
  const f = await fixture()
  try {
    apk(f)
    await assertCleanAndroidBuildSource(f.root, f.web)
    const result = run(f, 'verify', ['--web', f.web])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).webFiles, 3)
    assert.equal(JSON.stringify(f.info).includes(f.root), false)
    writeFileSync(path.join(f.web, 'storyforge/assets/app.js'), 'different current checkout payload')
    assert.notEqual(run(f, 'verify', ['--web', f.web]).status, 0)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

for (const [name, change] of [
  ['old same-version source', "p=web/'storyforge/build-source.json'; d=json.loads(p.read_text()); d['sourceCommit']='a'*40; p.write_text(json.dumps(d))"],
  ['wrong source tree', "p=web/'storyforge/build-source.json'; d=json.loads(p.read_text()); d['sourceTree']='b'*40; p.write_text(json.dumps(d))"],
  ['wrong package version', "p=web/'storyforge/build-source.json'; d=json.loads(p.read_text()); d['packageVersion']='4.0.5'; p.write_text(json.dumps(d))"],
  ['dirty source', "p=web/'storyforge/build-source.json'; d=json.loads(p.read_text()); d['dirty']=True; p.write_text(json.dumps(d))"],
  ['legacy APK without source evidence', "(web/'storyforge/build-source.json').unlink()"],
  ['modified application file', "(web/'storyforge/assets/app.js').write_text('old source')"],
  ['missing application file', "(web/'storyforge/assets/app.js').unlink()"],
  ['unexpected application file', "(web/'storyforge/assets/stale.js').write_text('stale')"],
  ['unsafe evidence path', "p=web/'storyforge/build-source.json'; d=json.loads(p.read_text()); d['files'][0]['path']='../outside'; p.write_text(json.dumps(d))"],
]) {
  test(`rejects ${name}`, async () => {
    const f = await fixture()
    try { apk(f, change); assert.notEqual(run(f).status, 0) }
    finally { rmSync(f.root, { recursive: true, force: true }) }
  })
}

test('a clean build cannot silently claim a different checkout tree', async () => {
  const f = await fixture()
  const previous = process.env.STORYFORGE_ANDROID_SOURCE_SHA
  try {
    const prior = f.git('rev-parse', 'HEAD')
    writeFileSync(path.join(f.root, 'native-source.txt'), 'changed native source')
    f.git('add', 'native-source.txt'); f.git('commit', '-qm', 'different native source')
    process.env.STORYFORGE_ANDROID_SOURCE_SHA = prior
    await assert.rejects(writeAndroidBuildSource(f.root, f.web), /differs from checkout tree/)
  } finally {
    if (previous === undefined) delete process.env.STORYFORGE_ANDROID_SOURCE_SHA
    else process.env.STORYFORGE_ANDROID_SOURCE_SHA = previous
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('uncommitted native or web source is recorded as dirty, not a formal clean source', async () => {
  const f = await fixture()
  const previous = process.env.STORYFORGE_ANDROID_SOURCE_SHA
  delete process.env.STORYFORGE_ANDROID_SOURCE_SHA
  try {
    writeFileSync(path.join(f.root, 'uncommitted-native-source.txt'), 'uncommitted')
    await assert.rejects(assertCleanAndroidBuildSource(f.root, f.web), /same clean source/)
    const info = await writeAndroidBuildSource(f.root, f.web)
    assert.equal(info.dirty, true)
    apk(f)
    assert.notEqual(run(f).status, 0)
  } finally {
    if (previous !== undefined) process.env.STORYFORGE_ANDROID_SOURCE_SHA = previous
    rmSync(f.root, { recursive: true, force: true })
  }
})

test('publication requires the exact tested APK and four unchanged successful phases', async () => {
  const f = await fixture()
  try {
    apk(f)
    const preflight = path.join(f.root, 'preflight.json.tmp')
    const receipt = path.join(f.root, 'receipt.json.tmp')
    const phases = path.join(f.root, 'phases'); mkdirSync(phases)
    const names = ['seed.txt', 'baseline-restart.txt', 'restore.txt', 'restart.txt']
    for (const name of names) writeFileSync(path.join(phases, name), 'OK (1 test)\n')
    writeFileSync(preflight, run(f).stdout)
    const record = run(f, 'record-tested', ['--preflight', preflight, '--phases', phases])
    assert.equal(record.status, 0, record.stderr); writeFileSync(receipt, record.stdout)
    const check = () => run(f, 'check-tested', ['--receipt', receipt, '--phases', phases])
    assert.equal(check().status, 0)
    writeFileSync(path.join(phases, 'baseline-restart.txt'), 'FAILURES!!!\n')
    assert.notEqual(check().status, 0)
    assert.notEqual(run(f, 'record-tested', ['--preflight', preflight, '--phases', phases]).status, 0)
    writeFileSync(path.join(phases, 'baseline-restart.txt'), 'OK (1 test)\n')
    const bytes = readFileSync(path.join(f.root, 'candidate.apk'))
    writeFileSync(path.join(f.root, 'candidate.apk'), Buffer.concat([bytes, Buffer.from('replaced after testing')]))
    assert.notEqual(check().status, 0)
    assert.notEqual(run(f, 'record-tested', ['--preflight', preflight, '--phases', phases]).status, 0)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
