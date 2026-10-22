// Build-time closure only. Ship exact pinned implementation/proof bytes and
// notices, never operator runtimes, model caches, jobs or browser data.
const { readFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { resolve } = require('node:path')

function localTtsResourceFiles(root = resolve(__dirname, '../..')) {
  const base = 'scripts/ttrpg-local-tts/'
  const profiles = ['product-profile.json', 'product-qwen-uncle_fu-v1.json', 'product-qwen-serena-v1.json'].map(file => base + file)
  const files = new Set([...profiles, 'LICENSE', base + 'README.md', base + 'MLX-Audio-LICENSE',
    base + 'reading-profile.json', base + 'runtime-profile.json', 'src/lib/agent/ai-entry-registry.json'])
  for (const file of profiles) {
    const profile = JSON.parse(readFileSync(resolve(root, file), 'utf8'))
    for (const row of profile.implementation.sources) {
      if (!/^(scripts\/ttrpg-local-tts\/[\w.-]+|src\/lib\/ttrpg\/[\w.-]+\.ts)$/.test(row.path)
        || !/^[a-f0-9]{64}$/.test(row.sha256)
        || createHash('sha256').update(readFileSync(resolve(root, row.path))).digest('hex') !== row.sha256) throw new Error('Pinned local voice package source changed')
      files.add(row.path)
    }
  }
  // Read every support file now: incomplete packages must fail the build.
  for (const file of files) readFileSync(resolve(root, file))
  return [...files].sort()
}

module.exports = { localTtsResourceFiles }
if (require.main === module) process.stdout.write(JSON.stringify(localTtsResourceFiles()) + '\n')
