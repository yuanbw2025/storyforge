import { build } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'

const result = await build({ configFile: 'vite.adventure-player.config.ts', mode: 'adventure-player', envFile: false })
const zip = new JSZip()
async function collect(dir, prefix = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = prefix + entry.name
    if (entry.isDirectory()) await collect(path.join(dir, entry.name), `${relative}/`)
    else zip.file(relative === 'adventure-web.html' ? 'index.html' : relative, await fs.readFile(path.join(dir, entry.name)))
  }
}
await collect('dist-adventure-player')
zip.file('LICENSE.runtime.txt', await fs.readFile('LICENSE'))
// Copy notices from the actual bundled packages, rather than copying application
// source, author material or every dependency from the development installation.
const packageRoots = new Set()
for (const output of Array.isArray(result) ? result : [result]) {
  for (const chunk of output.output ?? []) {
    if (chunk.type !== 'chunk') continue
    for (const moduleId of Object.keys(chunk.modules)) {
      const normalized = moduleId.replace(/^\0+/, '').replaceAll('\\', '/')
      if (!normalized.startsWith('/') && !/^[a-z]:\//i.test(normalized)) continue
      const marker = normalized.lastIndexOf('/node_modules/')
      if (marker < 0) continue
      const rest = normalized.slice(marker + '/node_modules/'.length).split('/')
      const packageName = rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0]
      packageRoots.add(normalized.slice(0, marker) + '/node_modules/' + packageName)
    }
  }
}
const notices = ['Third-party notices for the bundled StoryForge player. Game content and media retain their own rights metadata.']
for (const packageRoot of [...packageRoots].sort()) {
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  notices.push(`\n${metadata.name} ${metadata.version}\nLicense: ${typeof metadata.license === 'string' ? metadata.license : JSON.stringify(metadata.license ?? 'See package notices')}\n`)
  const entries = await fs.readdir(packageRoot, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (entry.isFile() && /^(?:licen[cs]e|notice|copying)(?:[.-].*)?$/i.test(entry.name)) {
      notices.push(`${entry.name}\n${await fs.readFile(path.join(packageRoot, entry.name), 'utf8')}\n`)
    }
  }
}
zip.file('THIRD-PARTY-NOTICES.txt', notices.join('\n'))
// Release runners compare the complete Android payload byte for byte. ZIP directory
// entries also get a timestamp from JSZip, so normalize them along with the files.
const zipEpoch = new Date('1980-01-01T00:00:00Z')
zip.forEach((_, entry) => { entry.date = zipEpoch })
await fs.mkdir('public/player', { recursive: true })
await fs.writeFile('public/player/adventure-player-template.zip', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
console.log('Independent adventure player template built.')
