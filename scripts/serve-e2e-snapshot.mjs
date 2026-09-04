import { spawn } from 'node:child_process'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const workspaceRoot = process.cwd()
const snapshotRoot = await mkdtemp(join(tmpdir(), 'storyforge-e2e-snapshot-'))
const portFlagIndex = process.argv.indexOf('--port')
const configuredPort = Number(portFlagIndex >= 0 ? process.argv[portFlagIndex + 1] : 4178)
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4178
const snapshotEntries = [
  'data',
  'index.html',
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
  await cp(join(workspaceRoot, entry), join(snapshotRoot, entry), {
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
const child = spawn(process.execPath, [
  viteEntry,
  '--host', '127.0.0.1',
  '--port', String(port),
  '--strictPort',
], {
  cwd: snapshotRoot,
  env: { ...process.env, STORYFORGE_E2E_SNAPSHOT: '1' },
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
