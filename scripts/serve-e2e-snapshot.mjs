import { cp, lstat, mkdir, readdir, symlink } from 'node:fs/promises'
import { withTestDirectory } from './test-temp-directory.mjs'
import { basename, dirname, join } from 'node:path'

const workspaceRoot = process.cwd()
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
  // Browser sound contracts import these pinned public metadata files. Copy
  // only JSON, never local weights, runtimes, provider journals or credentials.
  'scripts/avg-local-music/model-source.json',
  'scripts/avg-local-music/library-source.json',
  'scripts/avg-local-music/publisher-library-source.json',
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
  'tests/acceptance/narrative-world/corpus-v1.json',
  'tests/acceptance/narrative-world/worldrelease-v4-content-golden.json',
  'tests/acceptance/narrative-world/scale-plan-20261015-v1.json',
  'tsconfig.json',
  'vite.config.ts',
]

async function copyBytes(source) {
  if (basename(source).startsWith('.env')) return 0
  const info = await lstat(source)
  if (info.isSymbolicLink()) return 0
  if (!info.isDirectory()) return info.size
  let bytes = 0
  for (const name of await readdir(source)) bytes += await copyBytes(join(source, name))
  return bytes
}

try {
  process.exitCode = await withTestDirectory('e2e', async temporary => {
    const snapshotRoot = temporary.path
    const sizes = await Promise.all(snapshotEntries.map(entry => copyBytes(join(workspaceRoot, entry))))
    await temporary.checkSpace(sizes.reduce((sum, bytes) => sum + bytes, 0))
    for (const [index, entry] of snapshotEntries.entries()) {
      await temporary.checkSpace(sizes[index])
      const snapshotTarget = join(snapshotRoot, entry)
      await mkdir(dirname(snapshotTarget), { recursive: true })
      await cp(join(workspaceRoot, entry), snapshotTarget, {
        recursive: true,
        // Never copy the source workspace's local provider credentials.
        filter: source => !basename(source).startsWith('.env'),
      })
      temporary.checkInterrupted()
    }
    await symlink(join(workspaceRoot, 'node_modules'), join(snapshotRoot, 'node_modules'), 'dir')
    const snapshotEnv = { ...process.env, STORYFORGE_E2E_SNAPSHOT: '1' }
    delete snapshotEnv.STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR
    delete snapshotEnv.STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR
    return temporary.run(process.execPath, [
      join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ], {
      cwd: snapshotRoot,
      env: snapshotEnv,
    })
  })
} catch (error) {
  console.error('[snapshot] ' + error.message)
  process.exitCode = error.exitCode ?? 1
}
