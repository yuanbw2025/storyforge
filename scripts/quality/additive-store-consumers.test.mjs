import assert from 'node:assert/strict'
import test from 'node:test'
import { additiveStoreChange, usesOnlyExistingStores } from './additive-store-consumers.mjs'

const v13 = `import type { Chapter } from './types'
export const STORYFORGE_SCHEMA_VERSION = 13
export const STORYFORGE_STORES_V12 = {
  chapters: '++id, name',
} as const satisfies Record<string, string>

export const STORYFORGE_STORES = {
  ...STORYFORGE_STORES_V12,
} as const satisfies Record<string, string>

export class StoryForgeDB extends Dexie {
  chapters!: Table<Chapter, number>
  constructor() {
    this.version(12).stores(STORYFORGE_STORES_V12)
    this.version(STORYFORGE_SCHEMA_VERSION).stores(STORYFORGE_STORES)
  }
}
export const db = new StoryForgeDB()
`
const v14 = v13.replace('{ Chapter }','{ Chapter, Receipt }')
  .replace('VERSION = 13','VERSION = 14').replace('export const STORYFORGE_STORES =','export const STORYFORGE_STORES_V13 =')
  .replace('export class', `export const STORYFORGE_STORES = {
  ...STORYFORGE_STORES_V13,
  receipts: '++id, &worldId',
  settings: '++id, [owner+key]',
} as const satisfies Record<string, string>

export class`)
  .replace('  constructor()', '  receipts!: Table<Receipt, number>\n  settings!: Table<Setting, string>\n  constructor()')
  .replace('    this.version(STORYFORGE_SCHEMA_VERSION)', '    this.version(13).stores(STORYFORGE_STORES_V13)\n    this.version(STORYFORGE_SCHEMA_VERSION)')

test('only additive stores with an identical old schema and constructor qualify', () => {
  assert.deepEqual(additiveStoreChange(v13, v14), {known: new Set(['chapters']), added: new Set(['receipts','settings'])})
  for (const modified of [
    v14.replace('++id, name', '++id, title'), v14.replace('++id, name', '++id,name'),
    v14.replace("receipts: '++id", "chapters: '++id"), v14.replace('STORES_V13,','STORES_V12,'),
    v14.replace('this.version(13).stores(STORYFORGE_STORES_V13)', 'this.version(13).stores(STORYFORGE_STORES_V13).upgrade(rewrite)'),
    v14.replace('    this.version(13)', '    rewriteData()\n    this.version(13)'),
    v14.replace('receipts!: Table<Receipt, number>', 'receipts = setup()'),
    v14.replace("receipts: '++id, &worldId'", 'receipts: dynamicSpec()'),
    v14.replace('new StoryForgeDB()', 'new StoryForgeDB(otherName)'), v14.replace('VERSION = 14','VERSION = 15'),
  ]) assert.equal(additiveStoreChange(v13,modified), undefined)
})

test('scoped schema discovery preserves new stores, opaque access and explicit database contracts', () => {
  const change = additiveStoreChange(v13,v14)
  assert.ok(change)
  const module = './schema'
  /** @param {string} body @param {string} [prefix] */
  const run = (body, prefix = "import { db as data } from './schema'\n") =>
    usesOnlyExistingStores('test.ts',prefix + body,module,change)
  for (const body of ["await data.chapters.where('name').equals('A').toArray()", 'data.chapters.put(row)',
    'await data.open(); await data.delete(); data.close()', 'afterEach(() => data.close())']) assert.equal(run(body),true)
  for (const body of ['data.receipts.get(1)', 'data.settings.count()', 'data.tables', 'unknown(data)',
    'const table = data.chapters', 'take(data.chapters.where(key))', "data.table('chapters')",
    "data.transaction('rw', data.chapters, edit)", 'data[store].get(1)', 'const handle = await data.open()',
    'await data.chapters.db.tables', "vi.mock('./schema')", "const m = await import('./schema')"]) assert.equal(run(body),false)
  for (const imp of ["import * as m from './schema'", "import { StoryForgeDB } from './schema'",
    "import './schema'", "import db from './schema'", "import {db,STORYFORGE_SCHEMA_VERSION} from './schema'"]) assert.equal(run('',imp),false)
})
