import ts from 'typescript'
import { staticPropertyKey } from './static-guard-bindings.mjs'

// Resolve only a direct local const metadata object in this very function.
// The compiler binder handles shadow parameters/blocks. No alias, import,
// outer function, getter or user expression is evaluated; unresolved stays visible.
/**
 * @param {string} rel
 * @param {string} src
 * @returns {Set<number>}
 */
export function localChatMetaCategoryPositions(rel, src) {
  const name = rel.endsWith('.tsx') ? '/__ai_manual_meta__.tsx' : '/__ai_manual_meta__.ts'
  const source = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  /** @type {import('typescript').CompilerHost} */
  const host = {
    getSourceFile: file => file === name ? source : undefined,
    getDefaultLibFileName: () => '', writeFile: () => {},
    getCurrentDirectory: () => '/', getDirectories: () => [],
    fileExists: file => file === name, readFile: file => file === name ? src : undefined,
    getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  }
  const program = ts.createProgram([name], { noLib: true, noResolve: true, types: [] }, host)
  const checker = program.getTypeChecker()
  /** @type {Set<number>} */
  const positions = new Set()
  /**
   * @param {import('typescript').Node} node
   * @returns {void}
   */
  const walk = node => {
    inspect(node)
    ts.forEachChild(node, walk)
  }
  /**
   * @param {import('typescript').Node} node
   * @returns {void}
   */
  const inspect = node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'chat') return
    if (!localConstChatMetaHasCategory(node, node.arguments[2], name => {
      const declarations = checker.getSymbolAtLocation(name)?.declarations ?? []
      return declarations.length === 1 ? declarations[0] : null
    })) return
    positions.add(node.expression.getStart(source))
  }
  walk(source)
  return positions
}


// The existing narrow exception: a prior const object in this very function.
// Both the manual scanner and the source guard use the same lexical rule.
/**
 * @param {ts.CallExpression} call
 * @param {ts.Node | undefined} meta
 * @param {(name: ts.Identifier) => ts.Declaration | null | undefined} resolveDeclaration
 */
export function localConstChatMetaHasCategory(call, meta, resolveDeclaration) {
  if (!meta || !ts.isIdentifier(meta)) return false
  /** @param {ts.Node} node */
  const owner = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return parent
    }
    return null
  }
  const declaration = resolveDeclaration(meta)
  const scope = owner(call)
  return !!declaration && ts.isVariableDeclaration(declaration)
    && ts.isVariableDeclarationList(declaration.parent) && !!(declaration.parent.flags & ts.NodeFlags.Const)
    && scope !== null && owner(declaration) === scope && declaration.end < call.getStart()
    && !!declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)
    && declaration.initializer.properties.some(property => ts.isPropertyAssignment(property)
      && staticPropertyKey(property.name) === 'category')
}
