/* global console, process, URL */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), 'dist')
if (!existsSync(dist)) throw new Error('Run npm run docs:build first.')
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(item =>
  item.isDirectory() ? walk(resolve(dir, item.name)) : item.name.endsWith('.html') ? [resolve(dir, item.name)] : [])
const files = walk(dist)
const errors = new Set()
const decode = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
const pages = new Map(files.map(file => [file, readFileSync(file, 'utf8')]))
let count = 0
for (const [file, html] of pages) {
  const route = '/' + relative(dist, file).replaceAll('\\', '/')
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const href = decode(match[1])
    if (!href || /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/.test(href)) continue
    const url = new URL(href, 'https://docs.local' + route)
    let path
    try { path = decodeURIComponent(url.pathname) } catch { errors.add(route + ': invalid URL ' + href); continue }
    const target = resolve(dist, '.' + path)
    const options = [target, target + '.html', resolve(target, 'index.html')]
    const found = options.find(p => existsSync(p) && statSync(p).isFile())
    if (!found) { errors.add(route + ': missing ' + href); continue }
    count++
    if (url.hash && found.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1))
      const ids = new Set([...(pages.get(found) || '').matchAll(/\bid="([^"]+)"/g)].map(m => decode(m[1])))
      if (!ids.has(id)) errors.add(route + ': missing anchor ' + href)
    }
  }
}
if (errors.size) { console.error([...errors].join('\n')); process.exitCode = 1 }
else console.log('Link check passed: ' + files.length + ' HTML pages, ' + count + ' internal links/assets and anchors.')
