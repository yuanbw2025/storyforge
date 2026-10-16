import { cp, lstat, mkdir, readdir, symlink } from 'node:fs/promises'
import { withTestDirectory } from './test-temp-directory.mjs'
import { basename, dirname, join } from 'node:path'

const workspaceRoot = process.cwd()
const portFlagIndex = process.argv.indexOf('--port')
const configuredPort = Number(portFlagIndex >= 0 ? process.argv[portFlagIndex + 1] : 4178)
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4178
const snapshotEntries = [
  'scripts/local-codex',
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
    return temporary.run(process.execPath, [
      join(workspaceRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ], {
      cwd: snapshotRoot,
      env: { ...process.env, STORYFORGE_E2E_SNAPSHOT: '1' },
    })
  })
} catch (error) {
  console.error('[snapshot] ' + error.message)
  process.exitCode = error.exitCode ?? 1
}
