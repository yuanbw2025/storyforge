/* global console, process */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.name.startsWith('.') || e.name === 'public' || e.name === 'AGENTS.md' ? [] :
    e.isDirectory() ? walk(resolve(dir, e.name)) : e.name.endsWith('.md') ? [relative(root, resolve(dir, e.name))] : [])
const files = walk(root)
const source = files.filter(f => !f.startsWith('en/'))
const errors = []
const decode = s => s.replaceAll('&#123;', '{').replaceAll('&#125;', '}').replaceAll('\\_', '_')
for (const file of source) {
  const target = resolve(root, 'en', file)
  if (!existsSync(target)) { errors.push('Missing English page: ' + file); continue }
  const zh = decode(readFileSync(resolve(root, file), 'utf8'))
  const en = readFileSync(target, 'utf8')
  if (!/^# .+/m.test(en) && !en.includes('<h1>')) errors.push('Missing English title: ' + file)
  // Archives intentionally retain their Chinese originals through explicit English wrappers.
  if (file.startsWith('archive/') || file === 'updates/historical-feature-updates.md') continue
  for (const [, href] of en.matchAll(/(?:\]\(|href=")["']?(\/[^\s)"']+)/g)) {
    if (!href.startsWith('/en/') && !href.startsWith('/assets/') && !href.startsWith('/images/') && !href.startsWith('/brand/')) errors.push('Nonlocalized link: ' + file + ' ' + href)
  }
  if (file.startsWith('prompts/c/')) {
    for (const [, variable] of zh.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) {
      if (!en.includes('{{' + variable + '}}')) errors.push('Missing Prompt variable: ' + file + ' ' + variable)
    }
    for (const [, value] of zh.matchAll(/(?:asset_id|asset_family|version)\s*[：:]\s*([A-Za-z0-9._-]+)/g)) {
      if (!en.includes(value)) errors.push('Changed asset identity/version: ' + file + ' ' + value)
    }
  }
}
for (const file of files.filter(f => f.startsWith('en/'))) if (!source.includes(file.slice(3))) errors.push('Orphan English page: ' + file)
if (errors.length) { console.error([...new Set(errors)].join('\n')); process.exitCode = 1 }
else console.log('Bilingual check passed: ' + source.length + ' Chinese/English page pairs; localized links and C-suite variables/identities preserved. Semantic translation review remains required.')
