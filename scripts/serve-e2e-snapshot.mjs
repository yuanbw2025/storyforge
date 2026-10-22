import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const workspaceRoot = process.cwd()
const snapshotRoot = await mkdtemp(join(tmpdir(), 'storyforge-e2e-snapshot-'))
const portFlagIndex = process.argv.indexOf('--port')
const configuredPort = Number(portFlagIndex >= 0 ? process.argv[portFlagIndex + 1] : 4178)
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4178
const snapshotEntries = [
  'scripts/local-codex',
  // Local voice replay imports this pinned, model-free reading descriptor.
  'scripts/ttrpg-local-tts/reading-profile.json',
  'scripts/ttrpg-local-tts/product-profile.json',
  // The browser verifies historical raw against this immutable V2 wire core.
  'scripts/ttrpg-local-tts/product-profile-v2.json',
  'scripts/ttrpg-local-tts/product-qwen-uncle_fu-v1.json',
  'scripts/ttrpg-local-tts/product-qwen-serena-v1.json',
  // Vite's inactive local transport still needs its Node module imports.
  // Python inference and installed assets remain outside ordinary E2E.
  'scripts/ttrpg-local-tts/product-bridge.mjs',
  'scripts/ttrpg-local-tts/product-jobs.mjs',
  'scripts/ttrpg-local-tts/product-contract.mjs',
  'scripts/ttrpg-local-tts/reading-preview.mjs',
  'scripts/distribution/proxies.mjs',
  'scripts/distribution/diagnostics.mjs',
  'data',
  'showcase/short-novel',
  'showcase/screenplay',
  'showcase/motion-drama',
  // The example readers need source text, full comic pages and downloadable archives.
  ...['before-rain-stops', 'borrowed-flame', 'before-the-gun', 'moon-buys-bread'].flatMap(slug => [
    `showcase/comic/${slug}/source-novel.md`,
    `showcase/comic/${slug}/art/final`,
  ]),
  'index.html',
  'ui-preview',
  'package.json',
  'postcss.config.js',
  'public',
  'src',
  'tailwind.config.ts',
  'tests/helpers',
  'tsconfig.json',
  'vite.config.ts',
]

for (const entry of snapshotEntries) {
  const snapshotTarget = join(snapshotRoot, entry)
  await mkdir(dirname(snapshotTarget), { recursive: true })
  await cp(join(workspaceRoot, entry), snapshotTarget, {
    recursive: true,
    filter(source) {
      // The fixture supplies an isolated non-secret provider binding. Never
      // copy local credentials into the disposable validation workspace.
      return !basename(source).startsWith('.env')
    },
  })
}
await symlink(join(workspaceRoot, 'node_modules'), join(snapshotRoot, 'node_modules'), 'dir')

const viteEntry = join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const snapshotEnv = { ...process.env, STORYFORGE_E2E_SNAPSHOT: '1' }
delete snapshotEnv.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR
delete snapshotEnv.STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR
const child = spawn(process.execPath, [
  viteEntry,
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort',
], {
  cwd: snapshotRoot,
  env: snapshotEnv,
  stdio: 'inherit',
})

let shuttingDown = false
function stop(signal) {
  if (shuttingDown) return
  shuttingDown = true
  if (!child.killed) child.kill(signal)
}

process.once('SIGINT', () => stop('SIGINT'))
process.once('SIGTERM', () => stop('SIGTERM'))

const exitCode = await new Promise(resolve => {
  child.once('exit', (code, signal) => resolve(signal ? 0 : (code ?? 1)))
  child.once('error', () => resolve(1))
})
await rm(snapshotRoot, { recursive: true, force: true })
process.exitCode = exitCode
