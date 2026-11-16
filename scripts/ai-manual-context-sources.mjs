import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/** @typedef {import('typescript').SourceFile} SourceFile */
/** @typedef {import('typescript').Node} Node */
/** @typedef {{key: string, label: string, scope: string, layer: string, budget: string}} ContextRow */

/** @param {SourceFile} source @param {Node} node @param {string} key @param {string} reason @returns {never} */
function fail(source, node, key, reason) {
  const at = source.getLineAndCharacterOfPosition(node.getStart(source))
  throw new Error(`[ai-manual] source "${key}" at ${source.fileName}:${at.line + 1}:${at.character + 1}: ${reason}`)
}

/** @param {import('typescript').PropertyName} name */
function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

/** @param {import('typescript').ObjectLiteralExpression} object @param {string} name @param {SourceFile} source @param {string} key */
function property(object, name, source, key) {
  const matches = object.properties.filter(item => !ts.isSpreadAssignment(item) && propertyName(item.name) === name)
  const item = matches[0]
  if (matches.length !== 1 || !item || !ts.isPropertyAssignment(item)) fail(source, object, key, `requires one literal ${name} property`)
  return item.initializer
}

/** @param {import('typescript').Expression} node */
function unwrap(node) {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
  return node
}

/** Read only declarations, never import/evaluate an application module. Supported
 * budgets are numeric literals and top-level const aliases, including named
 * relative imports of exported consts. Other expressions fail at their source.
 * @param {string} sourcePath
 * @returns {ContextRow[]}
 */
export function readStaticContextSources(sourcePath) {
  /** @type {Map<string, SourceFile>} */
  const files = new Map()
  /** @param {string} name @returns {SourceFile} */
  const load = name => {
    const absolute = path.resolve(name)
    let source = files.get(absolute)
    if (!source) {
      source = ts.createSourceFile(absolute, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      files.set(absolute, source)
    }
    return source
  }
  /** @param {SourceFile} source @param {string} name */
  const declarations = (source, name) => source.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? statement.declarationList.declarations.flatMap(node => ts.isIdentifier(node.name) && node.name.text === name ? [{ statement, node }] : []) : [])
  /** @param {SourceFile} source @param {Node} node @param {string} specifier @param {string} key */
  const importedFile = (source, node, specifier, key) => {
    if (!specifier.startsWith('.')) fail(source, node, key, 'only named relative const imports are supported')
    const base = path.resolve(path.dirname(source.fileName), specifier)
    const candidates = (path.extname(base) ? [base] : [`${base}.ts`, path.join(base, 'index.ts')])
      .filter(name => fs.existsSync(name) && fs.statSync(name).isFile())
    if (candidates.length !== 1) fail(source, node, key, 'missing or ambiguous imported const module')
    return load(candidates[0])
  }
  /** @param {SourceFile} source @param {import('typescript').Expression} expression @param {string} key @param {Set<string>} seen @returns {number} */
  const number = (source, expression, key, seen) => {
    const node = unwrap(expression)
    if (ts.isNumericLiteral(node)) return Number(node.getText(source).replaceAll('_', ''))
    if (!ts.isIdentifier(node)) fail(source, node, key, `unsupported budget expression ${ts.SyntaxKind[node.kind]}`)
    return constant(source, node, node.text, key, seen)
  }
  /** @param {SourceFile} source @param {Node} origin @param {string} name @param {string} key @param {Set<string>} seen @param {boolean} [mustExport] @returns {number} */
  const constant = (source, origin, name, key, seen, mustExport = false) => {
    const identity = `${source.fileName}#${name}`
    if (seen.has(identity)) fail(source, origin, key, `cyclic budget const ${name}`)
    const next = new Set(seen).add(identity)
    const local = declarations(source, name)
    const imports = source.statements.flatMap(statement => {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) return []
      const bindings = statement.importClause?.namedBindings
      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements.flatMap(item => !item.isTypeOnly && item.name.text === name ? [{ statement, item }] : []) : []
    })
    if (local.length + imports.length !== 1) fail(source, origin, key, `unresolved or ambiguous budget const ${name}`)
    const binding = local[0]
    if (binding) {
      if (!(binding.statement.declarationList.flags & ts.NodeFlags.Const) || !binding.node.initializer
        || (mustExport && !binding.statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) {
        fail(source, origin, key, `budget ${name} must be ${mustExport ? 'an exported ' : 'a '}const with a static initializer`)
      }
      return number(source, binding.node.initializer, key, next)
    }
    const imported = imports[0]
    if (mustExport || !imported || !ts.isStringLiteral(imported.statement.moduleSpecifier)) fail(source, origin, key, `unsupported exported budget binding ${name}`)
    const target = importedFile(source, origin, imported.statement.moduleSpecifier.text, key)
    return constant(target, target, imported.item.propertyName?.text ?? imported.item.name.text, key, next, true)
  }

  const source = load(sourcePath), registry = declarations(source, 'CONTEXT_SOURCES')
  const binding = registry[0]
  if (registry.length !== 1 || !binding || !binding.node.initializer
    || !(binding.statement.declarationList.flags & ts.NodeFlags.Const)
    || !binding.statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    fail(source, source, 'CONTEXT_SOURCES', 'requires one exported const registry')
  }
  const array = unwrap(binding.node.initializer)
  if (!ts.isArrayLiteralExpression(array)) fail(source, array, 'CONTEXT_SOURCES', 'requires a static source array')
  /** @type {Set<string>} */
  const keys = new Set()
  return array.elements.map(element => {
    if (!ts.isObjectLiteralExpression(element) || element.properties.some(item => ts.isSpreadAssignment(item))) {
      fail(source, element, 'CONTEXT_SOURCES', 'requires literal source objects without spreads')
    }
    /** @param {string} name @param {string} key */
    const text = (name, key) => {
      const node = property(element, name, source, key)
      if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) fail(source, node, key, `requires a literal ${name}`)
      return node.text
    }
    const key = text('key', 'CONTEXT_SOURCES')
    const computed = element.properties.find(item => !ts.isSpreadAssignment(item) && ts.isComputedPropertyName(item.name))
    if (computed) fail(source, computed, key, 'computed source members are unsupported')
    if (!key.trim() || keys.has(key)) fail(source, element, key, 'empty or duplicate source key')
    keys.add(key)
    const budgetExpression = property(element, 'budgetTokens', source, key)
    const budget = number(source, budgetExpression, key, new Set())
    if (!Number.isSafeInteger(budget) || budget <= 0) fail(source, budgetExpression, key, 'budget must be a positive safe integer')
    return { key, label: text('label', key), scope: text('scope', key), layer: text('layer', key), budget: String(budget) }
  })
}
