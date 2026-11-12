import ts from 'typescript'

/** @param {string} path @param {string} text */
const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

/** The representation below is deliberately restricted to the project's named,
 * literal store snapshots. Unknown spreads or computed names leave all consumers selected.
 * @param {string} text */
function existingStores(text) {
  const names = new Set()
  const snapshots = new Set()
  for (const statement of parse('schema.ts', text).statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const d of statement.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !/^STORYFORGE_STORES(?:_V\d+)?$/.test(d.name.text)) continue
      let object = d.initializer
      while (object && (ts.isAsExpression(object) || ts.isSatisfiesExpression(object))) object = object.expression
      if (!object || !ts.isObjectLiteralExpression(object)) return
      for (const member of object.properties) {
        if (ts.isSpreadAssignment(member) && ts.isIdentifier(member.expression) && snapshots.has(member.expression.text)) continue
        if (!ts.isPropertyAssignment(member) || !ts.isIdentifier(member.name)) return
        names.add(member.name.text)
      }
      snapshots.add(d.name.text)
    }
  }
  if (snapshots.has('STORYFORGE_STORES')) return names
}

/** @param {string} text */
function withoutTypeImports(text) {
  for (const node of [...parse('schema.ts', text).statements].reverse()) {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) {
      text = text.slice(0, node.getStart()) + text.slice(node.end)
    }
  }
  return text
}

/** Undo just the four mechanically recognizable additions, then compare every
 * remaining byte. A changed old index, custom migration, constructor effect,
 * unfamiliar layout or unrelated edit falls back to normal consumer discovery.
 * @param {string} before @param {string} after */
export function additiveStoreChange(before, after) {
  const versionLine = /^export const STORYFORGE_SCHEMA_VERSION = (\d+)$/m
  const version = before.match(versionLine)?.[1]
  if (!version || after.match(versionLine)?.[1] !== String(Number(version) + 1)) return
  const known = existingStores(before)
  if (!known) return
  const snapshot = 'STORYFORGE_STORES_V' + version
  const oldStorePrefix = 'export const STORYFORGE_STORES = {'
  const newStore = after.match(/^export const STORYFORGE_STORES = \{\n([\s\S]*?)\n\} as const satisfies Record<string, string>\n\n/m)
  if (!newStore) return
  const [spread, ...entries] = newStore[1].split('\n')
  if (spread !== '  ...' + snapshot + ',' || !entries.length) return
  const added = new Set()
  let restored = withoutTypeImports(after).replace(newStore[0], '')
  for (const entry of entries) {
    const match = /^ {2}([a-zA-Z_]\w*): '[A-Za-z0-9_,. &+*[\]-]+',$/.exec(entry)
    if (!match || known.has(match[1]) || added.has(match[1])) return
    added.add(match[1])
    const field = new RegExp('^  ' + match[1] + '!: Table<[A-Za-z_$][\\w$]*, (?:number|string)>\\n', 'm')
    if (!field.test(restored)) return
    restored = restored.replace(field, '')
  }
  const register = '    this.version(' + version + ').stores(' + snapshot + ')\n'
  if (!restored.includes(register + '    this.version(STORYFORGE_SCHEMA_VERSION).stores(STORYFORGE_STORES)')) return
  restored = restored.replace(register, '').replace('export const ' + snapshot + ' = {', oldStorePrefix)
    .replace(versionLine, 'export const STORYFORGE_SCHEMA_VERSION = ' + version)
  if (restored === withoutTypeImports(before)) return { known, added }
}

const querySteps = new Set(['where', 'orderBy', 'filter', 'toCollection', 'equals', 'anyOf', 'between', 'and', 'reverse', 'limit', 'offset'])
const tableOperations = new Set(['add', 'bulkAdd', 'put', 'bulkPut', 'get', 'bulkGet', 'update', 'clear', 'delete', 'bulkDelete', 'count', 'toArray', 'first', 'last', 'primaryKeys', 'keys', 'sortBy'])

/** A table or query passed to an unknown helper can expose the entire Dexie
 * instance. Narrow only complete, ordinary operations on a named table.
 * @param {import('typescript').Node} table */
function ordinaryTableOperation(table) {
  let receiver = table
  for (;;) {
    const member = receiver.parent
    if (!ts.isPropertyAccessExpression(member) || member.expression !== receiver) return false
    const call = member.parent
    if (!ts.isCallExpression(call) || call.expression !== member) return false
    if (tableOperations.has(member.name.text)) return true
    if (!querySteps.has(member.name.text)) return false
    receiver = call
  }
}

/** Scope only a direct named db import. A mock, an escaped database handle,
 * a dynamic table lookup, a whole-database operation or any new-table reference
 * keeps the test. Other changed imports can independently select the same test.
 * @param {string} path @param {string} text @param {string} specifier
 * @param {{known:Set<string>, added:Set<string>}} change */
export function usesOnlyExistingStores(path, text, specifier, change) {
  const file = parse(path, text), aliases = new Set()
  const bindings = new Set()
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== specifier) continue
    const clause = statement.importClause
    if (clause?.isTypeOnly) continue
    if (clause?.name || !clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return false
    for (const part of clause.namedBindings.elements) {
      if (part.isTypeOnly) continue
      if ((part.propertyName ?? part.name).text !== 'db') return false
      aliases.add(part.name.text)
      bindings.add(part.name)
      if (part.propertyName) bindings.add(part.propertyName)
    }
  }
  let safe = aliases.size > 0
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (!safe) return
    if (ts.isStringLiteralLike(node) && node.text === specifier && !ts.isImportDeclaration(node.parent)) safe = false
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && change.added.has(node.text)) safe = false
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'db') safe = false
    if (ts.isIdentifier(node) && aliases.has(node.text) && !bindings.has(node)) {
      const access = node.parent
      if (!ts.isPropertyAccessExpression(access) || access.expression !== node) { safe = false; return }
      if (change.known.has(access.name.text)) {
        if (!ordinaryTableOperation(access)) safe = false
      } else {
        const call = access.parent
        if (!['open', 'close', 'delete'].includes(access.name.text) || !ts.isCallExpression(call)
          || call.expression !== access || call.arguments.length) { safe = false; return }
        const result = ts.isAwaitExpression(call.parent) ? call.parent : call
        if (access.name.text === 'open' && !ts.isExpressionStatement(result.parent)) safe = false
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return safe
}
