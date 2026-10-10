import fs from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const check = process.argv.includes('--check')
const source = 'tools/plugin-sdk/authoring'
const files = new Map()
const sources = {}
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function add(target, filename) {
  const bytes = await fs.readFile(path.join(root, filename))
  files.set(target, bytes)
  sources[target] = { source: filename, sha256: digest(bytes) }
}
async function tree(prefix, folder) {
  for (const item of (await fs.readdir(path.join(root, folder), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (item.isSymbolicLink()) throw new Error(`Unexpected link: ${folder}/${item.name}`)
    if (item.isDirectory()) await tree(`${prefix}/${item.name}`, `${folder}/${item.name}`)
    else await add(`${prefix}/${item.name}`, `${folder}/${item.name}`)
  }
}
for (const file of ['SKILL.md', 'START-HERE.md', 'developer-prompt.txt']) await add(file, `${source}/${file}`)
await add('references/ACCEPTANCE.md', `${source}/ACCEPTANCE.md`)
await add('references/PLUGIN-DEVELOPMENT.md', 'docs/guides/PLUGIN-DEVELOPMENT.md')
await add('references/MCP-BRIDGE.md', 'tools/mcp-bridge/README.md')
await add('references/PLUGIN-WORKSHOP-V1.md', 'docs/roadmap/PLUGIN-WORKSHOP-V1.md')
await add('references/index.d.ts', 'tools/plugin-sdk/index.d.ts')
await add('LICENSE', 'LICENSE')
await tree('examples', 'examples/plugins')
await tree('guides', 'website-docs/workshop')
await tree('guides/en', 'website-docs/en/workshop')
const hostTypes = await fs.readFile(path.join(root, 'src/lib/extensions/types.ts'))
if (!hostTypes.equals(files.get('references/index.d.ts'))) throw new Error('Public SDK types drifted; run npm run plugins:build-examples first')
const sdk = JSON.parse(await fs.readFile(path.join(root, 'tools/plugin-sdk/package.json'), 'utf8'))
const metadata = {
  format: 1, api: 1, sdk: sdk.version, status: 'development-preview',
  generator: 'tools/plugin-sdk/build-developer-kit.mjs',
  generatorSha256: digest(await fs.readFile(fileURLToPath(import.meta.url))),
  hostContract: Object.fromEntries(await Promise.all([
    'src/lib/extensions/types.ts', 'src/lib/extensions/package.ts',
    'src/lib/extensions/runtime.ts', 'tools/plugin-sdk/cli.mjs',
  ].map(async filename => [filename, digest(await fs.readFile(path.join(root, filename)))]))),
  sources,
}
const metadataBytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n')
files.set('developer-kit.json', metadataBytes)
const zip = new JSZip()
const date = new Date('2026-01-01T00:00:00Z')
for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  zip.file(`storyforge-plugin-author/${name}`, bytes, { date, createFolders: false })
}
const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
const outputs = { 'storyforge-plugin-author.zip': archive, 'developer-prompt.txt': files.get('developer-prompt.txt'), 'developer-kit.json': metadataBytes }
for (const folder of ['public/workshop', 'website-docs/public/downloads/workshop']) {
  if (!check) await fs.mkdir(path.join(root, folder), { recursive: true })
  for (const [name, bytes] of Object.entries(outputs)) {
    const filename = path.join(root, folder, name)
    if (check) {
      const existing = await fs.readFile(filename).catch(() => null)
      if (!existing?.equals(bytes)) throw new Error(`Outdated ${folder}/${name}; run npm run plugins:build-kit`)
    } else await fs.writeFile(filename, bytes)
  }
}
const runtimePrompt = path.join(root, 'src/components/extensions/developer-prompt.generated.txt')
if (check) {
  const existing = await fs.readFile(runtimePrompt).catch(() => null)
  if (!existing?.equals(outputs['developer-prompt.txt'])) throw new Error('Runtime prompt drifted; run npm run plugins:build-kit')
} else await fs.writeFile(runtimePrompt, outputs['developer-prompt.txt'])
console.log(`Developer kit ${check ? 'verified' : 'built'}: ${files.size} files, ${archive.length} bytes, SHA-256 ${digest(archive)}`)
