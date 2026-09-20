/* global console, process */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(root, '..')
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item =>
  item.name.startsWith('.') || item.name === 'public' ? [] :
    item.isDirectory() ? walk(resolve(dir, item.name)) :
      item.name.endsWith('.md') && item.name !== 'AGENTS.md' ? [resolve(dir, item.name)] : [])
const files = walk(root)
const config = readFileSync(resolve(root, '.vitepress/config.mts'), 'utf8')
const catalog = readFileSync(resolve(repo, 'src/lib/product/product-catalog.ts'), 'utf8')
const products = [...catalog.matchAll(/entry\(\{ id: '([^']+)'[^\n]+?status: '([^']+)'/g)]
const docs = new Map()
const errors = []
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  const front = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const meta = front ? parse(front[1]) : {}
  if (!meta?.productId) continue
  if (docs.has(meta.productId)) errors.push('Duplicate product: ' + meta.productId)
  docs.set(meta.productId, { file, meta })
  if (!meta.lastVerified || Number.isNaN(new Date(meta.lastVerified).valueOf())) errors.push('Missing verification date: ' + file)
  const route = '/' + relative(root, file).replace(/\\/g, '/').replace(/index\.md$/, '').replace(/\.md$/, '')
  if (!config.includes("link: '" + route + "'")) errors.push('Product missing from sidebar: ' + route)
}
for (const [, id, status] of products) {
  if (status === 'experimental') continue
  const doc = docs.get(id)
  if (!doc) errors.push('Missing product guide: ' + id)
  else if (doc.meta.status !== status) errors.push('Stale status: ' + id)
}
for (const id of docs.keys()) if (!products.some(p => p[1] === id)) errors.push('Unknown product: ' + id)
for (const file of files.filter(f => f.includes('/archive/') && !f.endsWith('/index.md') || f.endsWith('/updates/historical-feature-updates.md'))) {
  if (!/^---\r?\n[\s\S]*?search: false[\s\S]*?\r?\n---/.test(readFileSync(file, 'utf8'))) errors.push('Historical page still searchable: ' + file)
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log('Content check passed: ' + files.length + ' pages, ' + docs.size + ' product guides, matching maturity and navigation.')
