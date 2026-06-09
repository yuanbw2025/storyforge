import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = path.join(root, 'src/lib/db/schema.ts')
const ensureSchemaPath = path.join(root, 'src/lib/db/ensure-schema.ts')

const schemaSource = fs.readFileSync(schemaPath, 'utf8')
const ensureSchemaSource = fs.readFileSync(ensureSchemaPath, 'utf8')

const schemaTables = extractSchemaTables(schemaSource)
const requiredTables = extractRequiredTables(ensureSchemaSource)

const missing = schemaTables.filter(name => !requiredTables.includes(name))
const extra = requiredTables.filter(name => !schemaTables.includes(name))

if (missing.length > 0 || extra.length > 0) {
  console.error('[required-tables] REQUIRED_TABLES_V26 does not match schema.ts')
  if (missing.length > 0) console.error(`Missing: ${missing.join(', ')}`)
  if (extra.length > 0) console.error(`Extra: ${extra.join(', ')}`)
  process.exit(1)
}

console.log(`[required-tables] ok: ${requiredTables.length} tables match schema.ts`)

function extractSchemaTables(source) {
  const names = new Set()
  const storeBlockRe = /this\.version\(\d+\)\.stores\(\{([\s\S]*?)\n\s*\}\)/g
  let block
  while ((block = storeBlockRe.exec(source))) {
    const tableRe = /\n\s*([A-Za-z]\w*)\s*:\s*'[^']*'/g
    let table
    while ((table = tableRe.exec(block[1]))) {
      names.add(table[1])
    }
  }
  return [...names].sort()
}

function extractRequiredTables(source) {
  const match = source.match(/export const REQUIRED_TABLES_V26 = \[([\s\S]*?)\] as const/)
  if (!match) {
    console.error('[required-tables] REQUIRED_TABLES_V26 not found')
    process.exit(1)
  }
  const names = []
  const entryRe = /'([^']+)'/g
  let entry
  while ((entry = entryRe.exec(match[1]))) {
    names.push(entry[1])
  }
  return names.sort()
}
