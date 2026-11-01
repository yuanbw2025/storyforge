import ts from 'typescript'

// Resolve only a direct local const metadata object in this very function.
// The compiler binder handles shadow parameters/blocks. No alias, import,
// outer function, getter or user expression is evaluated; unresolved stays visible.
export function localChatMetaCategoryPositions(rel, src) {
  const name = rel.endsWith('.tsx') ? '/__ai_manual_meta__.tsx' : '/__ai_manual_meta__.ts'
  const source = ts.createSourceFile(name, src, ts.ScriptTarget.Latest, true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
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
  const positions = new Set()
  const owner = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return parent
    }
    return null
  }
  const walk = node => {
    inspect(node)
    ts.forEachChild(node, walk)
  }
  const inspect = node => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'chat') return
    const meta = node.arguments[2]
    if (!meta || !ts.isIdentifier(meta)) return
    const declarations = checker.getSymbolAtLocation(meta)?.declarations ?? []
    const declaration = declarations.length === 1 ? declarations[0] : undefined
    if (!declaration || !ts.isVariableDeclaration(declaration)
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)
      || owner(declaration) !== owner(node) || owner(node) === null
      || declaration.end >= node.getStart(source) || !declaration.initializer
      || !ts.isObjectLiteralExpression(declaration.initializer)
      || !declaration.initializer.properties.some(property => ts.isPropertyAssignment(property)
        && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        && property.name.text === 'category')) return
    positions.add(node.expression.getStart(source))
  }
  walk(source)
  return positions
}
