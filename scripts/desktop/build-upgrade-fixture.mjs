import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

await build({
  entryPoints: ['tests/helpers/native-upgrade-fixture.ts'],
  outfile: 'release/test-fixtures/native-upgrade.js',
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  define: { 'import.meta.env': JSON.stringify({ DEV: false, MODE: 'portable', BASE_URL: '/storyforge/' }) },
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
