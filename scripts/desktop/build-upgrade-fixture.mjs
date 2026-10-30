import { build } from 'esbuild'
import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const sourceDir = await realpath(path.resolve(process.argv[2] ?? '.'))
const outfile = path.resolve(process.argv[3] ?? 'release/test-fixtures/native-upgrade.js')
const expectedVersion = process.argv[4]
const { version } = JSON.parse(await readFile(path.join(sourceDir, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version) || (expectedVersion && version !== expectedVersion)) {
  throw new Error(`Upgrade fixture source version mismatch: expected ${expectedVersion ?? 'stable x.y.z'}, got ${version}`)
}
const entry = path.join(sourceDir, 'tests/helpers/native-upgrade-fixture.ts')
const git = (...args) => spawnSync('git', ['-C', sourceDir, ...args], { encoding: 'utf8' }).stdout?.trim()
const cleanSource = git('rev-parse', '--show-toplevel') === sourceDir
  && !git('status', '--porcelain', '--untracked-files=no')
const metadata = {
  version,
  entrySha256: createHash('sha256').update(await readFile(entry)).digest('hex'),
  sourceCommit: cleanSource ? git('rev-parse', 'HEAD') : null,
  sourceTree: cleanSource ? git('rev-parse', 'HEAD^{tree}') : null,
}

await build({
  absWorkingDir: sourceDir,
  entryPoints: [entry],
  outfile,
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  define: { 'import.meta.env': JSON.stringify({ DEV: false, MODE: 'portable', BASE_URL: '/storyforge/' }) },
  footer: { js: `globalThis.__nativeUpgradeSource = Object.freeze(${JSON.stringify(metadata)});` },
  plugins: [{
    name: 'vite-raw-source',
    setup(plugin) {
      // Production imports use Vite's ?raw contract even in this test-only bundle.
      plugin.onResolve({ filter: /\?raw$/ }, async args => {
        const resolved = await plugin.resolve(args.path.slice(0, -4), { kind: args.kind, resolveDir: args.resolveDir })
        if (resolved.errors.length) return { errors: resolved.errors }
        return { path: resolved.path, namespace: 'vite-raw-source' }
      })
      plugin.onLoad({ filter: /.*/, namespace: 'vite-raw-source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }))
    },
  }],
})
