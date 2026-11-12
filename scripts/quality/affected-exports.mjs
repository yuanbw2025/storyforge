import ts from 'typescript'

/** @param {string} path @param {string} text */
const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

/** Only named function declarations can be excluded. Treat other exports,
 * module-level executable changes and unsupported syntax conservatively.
 * @param {string} path @param {string} text */
function index(path, text) {
  const file = parse(path, text)
  /** @type {Map<string, string[]>} */
  const declarations = new Map()
  /** @type {Map<string, Set<string>>} */
  const dependencies = new Map()
  /** @type {Set<string>} */
  const functions = new Set()
  /** @type {string[]} */
  const effects = []
  /** @param {string} key @param {string} value */
  function add(key, value) {
    const entries = declarations.get(key) ?? []
    entries.push(value)
    declarations.set(key, entries)
  }
  /** @type {Map<string, string>} */
  const imports = new Map()
  /** @type {Set<string>} */
  const runtimeImports = new Set()
  const effectRefs = new Set()
  /** @param {import('typescript').Node} node @param {Set<string>} refs */
  function collect(node, refs) {
    if (ts.isIdentifier(node)) refs.add(node.text)
    ts.forEachChild(node, child => collect(child, refs))
  }
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause
      if (!clause) { effects.push(statement.getText(file)); continue }
      const source = statement.moduleSpecifier.text
      if (!clause.isTypeOnly) runtimeImports.add(source)
      /** @param {string} local @param {string} imported */
      const bind = (local, imported) => { add(local, imported + ' from ' + source); imports.set(local, source) }
      if (clause.name) bind(clause.name.text, 'default')
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) bind(bindings.name.text, '*')
      if (bindings && ts.isNamedImports(bindings)) {
        for (const part of bindings.elements) bind(part.name.text, (part.propertyName ?? part.name).text)
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name = statement.name.text
      add(name, statement.getText(file))
      const refs = dependencies.get(name) ?? new Set()
      collect(statement, refs)
      dependencies.set(name, refs)
      if (statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) functions.add(name)
    } else if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      add(statement.name.text, statement.getText(file))
      const refs = dependencies.get(statement.name.text) ?? new Set()
      collect(statement, refs)
      dependencies.set(statement.name.text, refs)
    } else {
      // Includes top-level assignments, initialized variables, classes and re-exports.
      effects.push(statement.getText(file))
      collect(statement, effectRefs)
    }
  }
  return { declarations, dependencies, functions, effects, effectRefs, imports, runtimeImports }
}

/** Named functions whose implementations and same-module dependencies survived
 * the diff. Keep tests for imports from another changed module conservative.
 * @param {string} path @param {string} before @param {string} after
 * @param {(specifier:string)=>boolean} dependencyChanged
 * @param {(specifier:string)=>boolean} inertImport */
export function unchangedFunctions(path, before, after, dependencyChanged = () => false, inertImport = () => false) {
  const a = index(path, before), b = index(path, after)
  const unchanged = new Set()
  if (JSON.stringify(a.effects) !== JSON.stringify(b.effects)) return unchanged
  for (const src of new Set([...a.runtimeImports, ...b.runtimeImports])) {
    if (a.runtimeImports.has(src) !== b.runtimeImports.has(src) && !inertImport(src)) return unchanged
  }
  const modified = new Set([...a.declarations.keys(), ...b.declarations.keys()].filter(name =>
    JSON.stringify(a.declarations.get(name)) !== JSON.stringify(b.declarations.get(name))))
  for (const [name, src] of b.imports) if (dependencyChanged(src)) modified.add(name)
  // Fixed point includes cycles, overloads and dependencies of dependencies.
  for (let previous = -1; previous !== modified.size;) {
    previous = modified.size
    for (const [name, refs] of b.dependencies) if ([...refs].some(ref => modified.has(ref))) modified.add(name)
  }
  if ([...b.effectRefs].some(ref => modified.has(ref))) return unchanged
  for (const name of b.functions) if (a.functions.has(name) && !modified.has(name)) unchanged.add(name)
  return unchanged
}

/** The caller first confirms a direct path match with the preprocessor. Only
 * an entirely understood set of named imports may be narrowed. Dynamic access,
 * namespace/default imports, module mocks and re-exports keep the test selected.
 * @param {string} path @param {string} text @param {string} specifier @param {Set<string>} unchanged */
export function onlyUnchangedImports(path, text, specifier, unchanged) {
  if (!unchanged.size) return false
  const file = parse(path, text)
  let seen = false, opaque = false
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isStringLiteralLike(node) && node.text === specifier) {
      const parent = node.parent
      if (!ts.isImportDeclaration(parent) || parent.moduleSpecifier !== node) { opaque = true; return }
      const clause = parent.importClause, bindings = clause?.namedBindings
      if (clause?.name || !bindings || !ts.isNamedImports(bindings) || !bindings.elements.length) { opaque = true; return }
      seen = true
      if (bindings.elements.some(part => !unchanged.has((part.propertyName ?? part.name).text))) opaque = true
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return seen && !opaque
}

/** Only declarations and literal constants can be introduced without running
 * initializers. Unknown imports, calls and class initialization use full scope.
 * @param {string} path @param {string} text */
export function inertModule(path, text) {
  return parse(path, text).statements.every(s => ts.isFunctionDeclaration(s) || ts.isInterfaceDeclaration(s)
    || ts.isTypeAliasDeclaration(s) || (ts.isImportDeclaration(s) && s.importClause?.isTypeOnly)
    || (ts.isVariableStatement(s) && Boolean(s.declarationList.flags & ts.NodeFlags.Const)
      && s.declarationList.declarations.every(d => ts.isIdentifier(d.name) && d.initializer && ts.isLiteralExpression(d.initializer))))
}
