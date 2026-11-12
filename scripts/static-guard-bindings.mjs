import path from 'node:path'
import ts from 'typescript'

/**
 * @typedef {{ key: string, args?: never } | { args: readonly ts.Expression[], key?: never }} StaticSegment
 * @typedef {({ kind: 'import', module: string } | { kind: 'type', node: ts.TypeNode }
 *   | { kind: 'local', name: string }) & {
 *     segments: StaticSegment[], boundArguments?: readonly ts.Expression[], uncertainMutable?: boolean
 *   }} StaticOrigin
 * @typedef {{
 *   declaration: (name: ts.Node) => ts.Declaration | null,
 *   resolve: (node: ts.Node | undefined) => StaticOrigin[]
 * }} StaticBindingResolver
 * @typedef {{ node: ts.BinaryExpression, value: ts.Expression, definite: boolean }} BindingWrite
 */

/**
 * @overload
 * @param {ts.Node} node
 * @returns {ts.Node}
 */
/**
 * @overload
 * @param {ts.Node | undefined} node
 * @returns {ts.Node | undefined}
 */
/** @param {ts.Node | undefined} node */
export function unwrapStaticExpression(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))) {
    node = node.expression
  }
  return node
}

/** @param {ts.Node | undefined} node */
export function staticLiteralMember(node) {
  const unwrapped = unwrapStaticExpression(node)
  return unwrapped && ts.isStringLiteralLike(unwrapped) ? unwrapped.text : null
}

/** @param {ts.Node | undefined} node */
export function staticPropertyKey(node) {
  if (!node) return null
  if (ts.isIdentifier(node)) return node.text
  if (ts.isComputedPropertyName(node)) return staticLiteralMember(node.expression)
  return staticLiteralMember(node)
}

/** @param {ts.Node} node */
export function staticMemberAccess(node) {
  if (ts.isPropertyAccessExpression(node)) return { receiver: node.expression, key: node.name.text }
  if (!ts.isElementAccessExpression(node)) return null
  const key = staticLiteralMember(node.argumentExpression)
  return key === null ? null : { receiver: node.expression, key }
}

/**
 * @param {string} file
 * @param {ts.Node | undefined} declaration
 * @param {string[]} members
 * @returns {StaticOrigin[]}
 */
function importOrigin(file, declaration, members) {
  if (!declaration || !ts.isImportDeclaration(declaration) || !ts.isStringLiteral(declaration.moduleSpecifier)) return []
  const specifier = declaration.moduleSpecifier
  const raw = specifier.text.replace(/\.(?:[cm]?[jt]sx?)$/, '')
  const module = raw.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), raw))
    : raw.startsWith('@/') ? 'src/' + raw.slice(2) : raw
  return [{ kind: 'import', module, segments: members.map(key => ({ key })) }]
}

/**
 * @param {ts.SourceFile} ast
 * @returns {StaticBindingResolver}
 */
export function createStaticBindingResolver(ast) {
  // Only bind this file's lexical declarations. No dependency traversal,
  // emit, type diagnostics, or evaluation of computed expressions.
  /** @type {ts.CompilerOptions} */
  const options = { noLib: true, noResolve: true, allowJs: true, target: ts.ScriptTarget.Latest }
  /** @type {ts.CompilerHost} */
  const host = {
    getSourceFile: file => file === ast.fileName ? ast : undefined,
    getDefaultLibFileName: () => '',
    getCurrentDirectory: () => '/',
    getCanonicalFileName: file => file,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: file => file === ast.fileName,
    readFile: file => file === ast.fileName ? ast.text : undefined,
    writeFile() {},
  }
  const checker = ts.createProgram([ast.fileName], options, host).getTypeChecker()
  /** @param {ts.Node} name */
  const declaration = name => checker.getSymbolAtLocation(name)?.declarations?.[0] ?? null
  /** @param {StaticOrigin[]} origins @param {StaticSegment} segment @returns {StaticOrigin[]} */
  const append = (origins, segment) => origins.map(origin => ({ ...origin, segments: [...origin.segments, segment] }))

  /** @type {Map<ts.Declaration, BindingWrite[]> | undefined} */
  let writesByDeclaration

  /** @param {ts.Node} node @returns {ts.Node | null} */
  function lexicalFunction(node) {
    for (let cursor = node.parent; cursor; cursor = cursor.parent) {
      if (ts.isFunctionLike(cursor)) return cursor
    }
    return null
  }

  /** @param {ts.Node} binding @returns {boolean} */
  function isMutable(binding) {
    while (ts.isBindingElement(binding)) binding = binding.parent.parent
    if (ts.isParameter(binding)) return true
    return ts.isVariableDeclaration(binding) && ts.isVariableDeclarationList(binding.parent)
      && !(binding.parent.flags & ts.NodeFlags.Const)
  }

  /** @param {ts.Declaration} binding @returns {BindingWrite[]} */
  function bindingWrites(binding) {
    if (!writesByDeclaration) {
      writesByDeclaration = new Map()
      /** @param {ts.Node} node */
      const scan = node => {
        if (ts.isBinaryExpression(node)) {
          const op = node.operatorToken.kind
          if (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.AmpersandAmpersandEqualsToken
            || op === ts.SyntaxKind.BarBarEqualsToken || op === ts.SyntaxKind.QuestionQuestionEqualsToken) {
            const left = unwrapStaticExpression(node.left)
            const target = ts.isIdentifier(left) ? declaration(left) : null
            if (target && isMutable(target)) {
              const writes = writesByDeclaration?.get(target) ?? []
              writes.push({ node, value: node.right, definite: op === ts.SyntaxKind.EqualsToken })
              writesByDeclaration?.set(target, writes)
            }
          }
        }
        ts.forEachChild(node, scan)
      }
      scan(ast)
    }
    return writesByDeclaration.get(binding) ?? []
  }

  /**
   * Only a standalone assignment before the use in the same statement list
   * can replace the initializer. Branches and nested writers contribute
   * possible guarded origins; they cannot prove that a value became harmless.
   * @param {ts.Node} binding
   * @param {ts.Node | undefined} reference
   * @param {StaticOrigin[]} initial
   * @param {Set<ts.Node>} active
   * @param {number} depth
   * @param {Set<ts.BinaryExpression>} [activeWrites]
   * @returns {StaticOrigin[]}
   */
  function resolveMutable(binding, reference, initial, active, depth, activeWrites = new Set()) {
    if (!reference || !isMutable(binding)) return initial
    if (depth > 24) return initial.map(origin => ({ ...origin, uncertainMutable: true }))
    const writes = bindingWrites(/** @type {ts.Declaration} */ (binding))
      // The RHS of a write observes the preceding value.
      .filter(write => !activeWrites.has(write.node)
        && !(write.node.pos <= reference.pos && reference.end <= write.node.end))
    if (!writes.length) return initial
    const use = reference
    const owner = lexicalFunction(use)
    /** @param {BindingWrite} write @returns {ts.Node | null} */
    function directReferenceSibling(write) {
      const statement = write.node.parent
      const container = statement.parent
      if (lexicalFunction(write.node) !== owner || !ts.isExpressionStatement(statement)
        || !(ts.isSourceFile(container) || ts.isBlock(container))) return null
      for (let cursor = use; cursor.parent; cursor = cursor.parent) {
        if (cursor.parent === container) return cursor
      }
      return null
    }
    const direct = writes.filter(write => {
      const sibling = directReferenceSibling(write)
      return write.definite && sibling != null && write.node.end < sibling.getStart(ast)
    }).sort((left, right) => right.node.end - left.node.end)[0]
    /** @type {ts.Node[]} */
    const enclosingLoops = []
    for (let cursor = use.parent; cursor && cursor !== owner; cursor = cursor.parent) {
      if (ts.isForStatement(cursor) || ts.isForInStatement(cursor) || ts.isForOfStatement(cursor)
        || ts.isWhileStatement(cursor) || ts.isDoStatement(cursor)) enclosingLoops.push(cursor)
    }
    /** @param {ts.Node} outer @param {ts.Node} inner */
    const contains = (outer, inner) => outer.pos <= inner.pos && inner.end <= outer.end
    const candidates = writes.filter(write => {
      if (write === direct) return false
      const sibling = directReferenceSibling(write)
      const reentersUse = enclosingLoops.some(loop => contains(loop, write.node)
        && (!direct || !contains(loop, direct.node)))
      if (sibling && write.node.pos >= sibling.end && !reentersUse) return false
      // A previous direct statement (including a nested branch that completed
      // before it) is dominated by the exact standalone replacement.
      return reentersUse || !direct || lexicalFunction(write.node) !== owner || write.node.end > direct.node.pos
    })
    /** @param {ts.Node} node */
    const isSelf = node => ts.isIdentifier(node) && declaration(node) === binding
    /** @param {BindingWrite} write @returns {readonly ts.Expression[] | null} */
    function selfBindingArguments(write) {
      const rhs = unwrapStaticExpression(write.value)
      if (isSelf(rhs)) return []
      if (!ts.isCallExpression(rhs) || !rhs.arguments.length) return null
      const method = staticMemberAccess(unwrapStaticExpression(rhs.expression))
      return method?.key === 'bind' && isSelf(unwrapStaticExpression(method.receiver))
        ? rhs.arguments.slice(1) : null
    }
    /** @param {BindingWrite} write @returns {StaticOrigin[]} */
    const read = write => {
      const selfArgs = selfBindingArguments(write)
      /** @param {ts.Node} node @returns {boolean} */
      const selfReference = node => isSelf(node)
        || ts.forEachChild(node, child => selfReference(child) ? true : undefined) === true
      if (selfArgs) {
        const predecessor = resolveMutable(binding, write.node, initial, active, depth + 1,
          new Set([...activeWrites, write.node]))
        return predecessor.map(origin => ({
          ...origin, boundArguments: [...(origin.boundArguments ?? []), ...selfArgs],
        }))
      }
      const value = resolve(write.value, active, depth + 1)
      // Arbitrary self-referential expressions remain opaque. Avoid walking
      // a recurrence such as a numeric accumulator as though it were an alias.
      return selfReference(write.value)
        ? [...value, ...initial.map(origin => ({ ...origin, uncertainMutable: true }))]
        : value
    }
    const value = direct ? read(direct) : initial
    const replacement = direct && !selfBindingArguments(direct) && unwrapStaticExpression(direct.value)
    // Calls returning a callable are opaque unless they resolve to a known
    // binding path. Do not treat such a write as proof that a previously
    // observed guarded origin disappeared.
    const opaqueReplacement = replacement && ts.isCallExpression(replacement)
      && (!value.length || value.some(origin => origin.segments.some(segment => segment.args)))
    const unresolved = opaqueReplacement && direct
      ? [...initial, ...writes.filter(write => write.node.end <= direct.node.pos).flatMap(read)]
      : []
    return [...value, ...[...unresolved, ...candidates.flatMap(read)]
      .map(origin => ({ ...origin, uncertainMutable: true }))]
  }

  /**
   * @param {ts.Node | null | undefined} node
   * @param {Set<ts.Node>} active
   * @param {number} depth
   * @param {ts.Node} [reference]
   * @returns {StaticOrigin[]}
   */
  function fromDeclaration(node, active, depth, reference) {
    if (!node || depth > 24 || active.has(node)) return []
    active.add(node)
    try {
      if (ts.isImportSpecifier(node)) {
        const clause = node.parent.parent
        return importOrigin(ast.fileName, clause.parent, [node.propertyName?.text ?? node.name.text])
      }
      if (ts.isNamespaceImport(node)) return importOrigin(ast.fileName, node.parent.parent, [])
      if (ts.isImportClause(node) && node.name) return importOrigin(ast.fileName, node.parent, ['default'])
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
        const fromValue = resolve(node.initializer, active, depth + 1)
        const initial = fromValue.length ? fromValue : node.type ? [{ kind: 'type', node: node.type, segments: [] }] : []
        return resolveMutable(node, reference, /** @type {StaticOrigin[]} */ (initial), active, depth)
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        return [{kind: 'local', name: node.name.text, segments: []}]
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.dotDotDotToken) {
        const key = staticPropertyKey(node.propertyName ?? node.name)
        const initial = key === null ? [] : append(fromDeclaration(node.parent.parent, active, depth + 1), { key })
        return resolveMutable(node, reference, initial, active, depth)
      }
      return []
    } finally {
      active.delete(node)
    }
  }

  /**
   * @param {ts.Node | undefined} node
   * @param {Set<ts.Node>} active
   * @param {number} depth
   * @returns {StaticOrigin[]}
   */
  function resolve(node, active, depth) {
    const expression = unwrapStaticExpression(node)
    if (!expression || depth > 24) return []
    if (ts.isIdentifier(expression)) return fromDeclaration(declaration(expression), active, depth + 1, expression)
    if (ts.isConditionalExpression(expression)) {
      const first = unwrapStaticExpression(expression.whenTrue)
      const second = unwrapStaticExpression(expression.whenFalse)
      if (ts.isIdentifier(first) && ts.isIdentifier(second) && declaration(first) === declaration(second)) {
        return resolve(first, active, depth + 1)
      }
      return [...resolve(first, active, depth + 1), ...resolve(second, active, depth + 1)]
    }
    if (ts.isQualifiedName(expression)) {
      return append(resolve(expression.left, active, depth + 1), {key: expression.right.text})
    }
    const member = staticMemberAccess(expression)
    if (member) return append(resolve(member.receiver, active, depth + 1), { key: member.key })
    if (ts.isCallExpression(expression)) {
      const callee = unwrapStaticExpression(expression.expression)
      const binding = staticMemberAccess(callee)
      if (binding?.key === 'bind' && expression.arguments.length >= 1) {
        return resolve(binding.receiver, active, depth + 1).map(origin => ({
          ...origin, boundArguments: [...(origin.boundArguments ?? []), ...expression.arguments.slice(1)],
        }))
      }
      return append(resolve(callee, active, depth + 1), { args: expression.arguments })
    }
    return []
  }

  return {
    declaration,
    resolve: node => resolve(node, new Set(), 0),
  }
}

/**
 * @param {StaticOrigin} origin
 * @param {ts.CallExpression} call
 */
export function staticCallArguments(origin, call) {
  const segments = origin.segments
  const terminal = segments[segments.length - 1]?.key
  const indirect = terminal === 'call' || terminal === 'apply'
  const array = terminal === 'apply' ? unwrapStaticExpression(call.arguments[1]) : null
  const trailing = terminal === 'call' ? call.arguments.slice(1)
    : terminal === 'apply' ? (array && ts.isArrayLiteralExpression(array) ? array.elements : [])
    : call.arguments
  return {
    segments: indirect ? segments.slice(0, -1) : segments,
    args: origin.boundArguments?.length ? [...origin.boundArguments, ...trailing] : trailing,
  }
}

const hookModule = 'src/hooks/useAIStream'

/**
 * @param {StaticBindingResolver} bindings
 * @param {ts.Node | undefined} type
 * @param {string[]} keys
 * @param {Set<ts.Node>} [seen]
 * @returns {boolean}
 */
function carriesHookType(bindings, type, keys, seen = new Set()) {
  if (!type || seen.has(type) || seen.size > 24 || !keys.length) return false
  seen.add(type)
  /** @param {ts.Node | undefined} node @param {string[]} names @returns {boolean} */
  const visit = (node, names) => carriesHookType(bindings, node, names, seen)
  try {
    if (ts.isParenthesizedTypeNode(type)) return visit(type.type, keys)
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      return type.types.some(item => visit(item, keys))
    }
    if (ts.isTypeLiteralNode(type) || ts.isInterfaceDeclaration(type)) {
      const property = type.members.find(item => ts.isPropertySignature(item)
        && staticPropertyKey(item.name) === keys[0])
      return visit(/** @type {ts.PropertySignature | undefined} */ (property)?.type, keys.slice(1))
    }
    if (!ts.isTypeReferenceNode(type)) return false
    if (bindings.resolve(type.typeName).some(origin => origin.kind === 'import'
      && origin.module === hookModule && origin.segments.length === 1
      && origin.segments[0].key === 'UseAIStreamReturn')) return keys.length === 1 && keys[0] === 'start'
    const declaration = bindings.declaration(type.typeName)
    if (declaration && ts.isTypeAliasDeclaration(declaration)) return visit(declaration.type, keys)
    if (declaration && ts.isInterfaceDeclaration(declaration)) return visit(declaration, keys)
    if (!declaration && ts.isIdentifier(type.typeName) && type.typeName.text === 'ReturnType'
      && type.typeArguments?.length === 1 && ts.isTypeQueryNode(type.typeArguments[0])) {
      return keys.length === 1 && keys[0] === 'start'
        && bindings.resolve(type.typeArguments[0].exprName).some(origin => origin.kind === 'import'
          && origin.module === hookModule && origin.segments.length === 1 && origin.segments[0].key === 'useAIStream')
    }
    if (!declaration && ts.isIdentifier(type.typeName) && type.typeName.text === 'Pick'
      && type.typeArguments?.length === 2) {
      const picked = type.typeArguments[1]
      const pickedKeys = (ts.isUnionTypeNode(picked) ? picked.types : [picked]).flatMap(item => (
        ts.isLiteralTypeNode(item) ? [staticLiteralMember(item.literal)] : []
      ))
      return pickedKeys.includes(keys[0]) && visit(type.typeArguments[0], keys)
    }
    return false
  } finally {
    seen.delete(type)
  }
}

/**
 * @param {StaticBindingResolver} bindings
 * @param {StaticOrigin} origin
 * @param {StaticSegment[]} segments
 * @returns {'hook-start' | 'chat' | 'streamChat' | null}
 */
export function staticTransportKind(bindings, origin, segments) {
  if (origin.kind === 'type') {
    return segments.every(segment => segment.key)
      && carriesHookType(bindings, origin.node, /** @type {string[]} */ (segments.map(segment => segment.key))) ? 'hook-start' : null
  }
  if (origin.kind !== 'import') return null
  if (origin.module === hookModule && segments.length === 3 && segments[0].key === 'useAIStream'
    && segments[1].args && segments[2].key === 'start') return 'hook-start'
  if (origin.module === 'src/lib/ai/client' && segments.length === 1) {
    const member = segments[0].key
    if (member === 'chat' || member === 'streamChat') return member
  }
  return null
}
