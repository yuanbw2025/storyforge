// Deterministic maintainer operation. Does not install, download or run models.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = new URL('../../', import.meta.url), target = new URL('./product-profile.json', import.meta.url)
const paths = [
  'scripts/ttrpg-local-tts/product-contract.mjs', 'scripts/ttrpg-local-tts/product-worker.py',
  'scripts/ttrpg-local-tts/product-jobs.mjs', 'scripts/ttrpg-local-tts/product-bridge.mjs',
  'scripts/ttrpg-local-tts/engine.py', 'scripts/ttrpg-local-tts/reading_frontend.py',
  'scripts/ttrpg-local-tts/reading-preview.mjs', 'src/lib/ttrpg/open-local-voice-transport.ts',
  'src/lib/ttrpg/open-voice-execution.ts',
]
const profile = JSON.parse(readFileSync(target, 'utf8'))
const current = { ...profile, version: 2, profileId: 'melo-zh-product-v2', maxSegmentAudioSeconds: 60, maxConcurrentJobs: 1,
  minimumFreeBytes: 5 * 1024 ** 3, maxDiagnosticBytes: 65536,
  authorizationLeaseMs: 10000, authorizationRenewMs: 2000,
  statusRequestTimeoutMs: 15000, rawResponseTimeoutMs: 120000,
  implementation: { version: 'storyforge-local-tts-worker-v1', sources: paths.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex') })) } }
const output = JSON.stringify(current, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Product implementation profile drifted')
} else writeFileSync(fileURLToPath(target), output)
for (const voice of ['uncle_fu', 'serena']) {
  const file = new URL(`./product-qwen-${voice}-v1.json`, import.meta.url)
  const profile = JSON.parse(readFileSync(file, 'utf8'))
  const sources = [...paths, 'scripts/ttrpg-local-tts/qwen-product.py', 'scripts/ttrpg-local-tts/qwen-native-eval-profile.json',
    'src/lib/ttrpg/open-voice-execution-input.ts', 'src/lib/ttrpg/open-voice-product-profile.ts']
  const value = { ...profile, implementation: { version: 'storyforge-local-tts-qwen-worker-v1',
    sources: sources.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(new URL(path, root))).digest('hex') })) } }
  const bytes = JSON.stringify(value, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== bytes) throw new Error('Qwen product implementation profile drifted')
  } else writeFileSync(fileURLToPath(file), bytes)
}
