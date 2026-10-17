import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, it, expect } from 'vitest'
/** Verify the actual static dependency closure, not a filename or import spelling. */
function staticImports(relative: string): string[] {
  const file = ts.createSourceFile(relative, readFileSync(relative, 'utf8'), ts.ScriptTarget.Latest, true)
  const targets: string[] = []
  for (const node of file.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || (ts.isExportDeclaration(node) && node.isTypeOnly) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue
    if (ts.isImportDeclaration(node) && node.importClause && (node.importClause.isTypeOnly || (!node.importClause.name && node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every(e => e.isTypeOnly)))) continue
    const specifier = node.moduleSpecifier.text
    if (!specifier.startsWith('.')) continue
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier))
    const found = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(suffix => base + suffix).find(existsSync)
    if (found) targets.push(found)
  }
  return targets
}
describe('R-TTRPGOPEN3 deterministic replay does not eagerly load model/production readers', () => {
  for (const root of ['runtime-event-reducer', 'runtime', 'runtime-branch']) it(root, () => {
    const queue = [[`src/lib/ttrpg/${root}.ts`]], visited = new Set<string>(), violations: string[] = []
    while (queue.length) {
      const chain = queue.shift()!, current = chain[chain.length - 1]
      if (visited.has(current)) continue
      visited.add(current)
      if (/\/ttrpg\/(?:open-(?:runtime-candidate|intent-candidate|kp-candidate|intent-harness|intent-input|kp-context|gm-oracle-context|player-context|context-provider)|authoring-service)\.ts$/.test(current)
        || /\/product-production\/(?:preview-source|production-executor)\.ts$/.test(current)) violations.push(chain.join(' -> '))
      for (const child of staticImports(current)) queue.push([...chain, child])
    }
    expect(visited.size).toBeGreaterThan(10)
    expect(violations).toEqual([])
  })
  it('keeps every actual TTRPG replay module in an acyclic build group under the unchanged shared budgets', () => {
    const config = ts.createSourceFile('vite.config.ts', readFileSync('vite.config.ts', 'utf8'), ts.ScriptTarget.Latest, true)
    const declaration = config.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => ts.isIdentifier(d.name) && d.name.text === 'TTRPG_REPLAY_CHUNK_MODULES')!
    let expression = declaration.initializer!
    if (ts.isAsExpression(expression)) expression = expression.expression
    if (!ts.isObjectLiteralExpression(expression)) throw new Error('missing actual replay chunk groups')
    const groups = new Map<string, number>(), ranks: Record<string, number> = { state: 0, open: 1, adapters: 2 }
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !ts.isArrayLiteralExpression(property.initializer)) throw new Error('invalid replay chunk metadata')
      const rank = ranks[property.name.text]
      expect(rank).toBeDefined()
      for (const file of property.initializer.elements) {
        if (!ts.isStringLiteral(file)) throw new Error('invalid replay module')
        const module = `src/lib/ttrpg/${file.text}.ts`
        expect(groups.has(module)).toBe(false);groups.set(module, rank)
      }
    }
    const queue = ['runtime-event-reducer', 'runtime', 'runtime-branch'].map(root => `src/lib/ttrpg/${root}.ts`), visited = new Set<string>(), violations: string[] = []
    while (queue.length) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      if (current.startsWith('src/lib/ttrpg/')) expect(groups.has(current), current).toBe(true)
      for (const dependency of staticImports(current)) {
        queue.push(dependency)
        if (groups.has(current) && groups.has(dependency) && groups.get(dependency)! > groups.get(current)!) violations.push(`${current} -> ${dependency}`)
      }
    }
    expect(violations).toEqual([])
  })

})
