import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Execute the checker’s actual pure policy, without executing its whole-repo
// command or maintaining a second copy of the dependency rules.
const checker = readFileSync('scripts/check-architecture.mjs', 'utf8')
const ast = ts.createSourceFile('check-architecture.mjs', checker, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
  && statement.name?.text === 'workspaceDependencyViolationsV1')
if (!declaration) throw new Error('SFQA004 workspace dependency policy is missing')
const extracted: unknown = new Script(`(${declaration.getText(ast)})`).runInNewContext({ ts })
if (typeof extracted !== 'function') throw new Error('SFQA004 workspace dependency policy is not callable')
const inspect = extracted as (file: string, source: string) => string[]
const facade = 'src/lib/workspace/create-workspace.ts'
const installer = 'src/lib/product-platform/workspace-install.ts'
const allocator = 'src/lib/workspace/workspace-allocation.ts'

describe('SFQA004 · exact workspace allocation dependency boundary', () => {
  it.each([facade, installer, allocator, 'src/lib/workspace/works.ts', 'src/lib/registry/adoption-schema.ts'])('accepts the actual authorized module %s', file => {
    expect(inspect(file, readFileSync(file, 'utf8'))).toEqual([])
  })

  it('accepts only the existing lifecycle-list facade and direct admitted creation call', () => {
    expect(inspect(facade, `
      import { allocateWorkspace as allocate, workspaceCreationTransactionTablesV1 as tables } from './workspace-allocation'
      import { assertCurrentProductEntryV1 } from '../product/product-catalog'
      export function workspaceCreationTransactionTablesV1() { return tables() }
      export function createWorkspace() { assertCurrentProductEntryV1('upper.avg'); return allocate() }
    `)).toEqual([])
  })

  it.each([
    ['catalog outside the two neutral facades', 'src/lib/workspace/ownership.ts', "import { assertCurrentProductEntryV1 } from '../product/product-catalog'"],
    ['concrete product service in the facade', facade, "import { createChatDraftV3 } from '../character-interaction/draft-service'"],
    ['verifier back in the neutral allocator', allocator, "const proof = await import('../adventure/community-package')"],
    ['distribution verifier in Work service', 'src/lib/workspace/works.ts', "const proof = await import('../product-platform/distribution-bundle')"],
    ['similar catalog path', facade, "import { allow } from '../product/product-catalog-extra'"],
    ['new allocator caller', 'src/components/Unchecked.tsx', "import { allocateWorkspace } from '../lib/workspace/workspace-allocation'"],
    ['type import outside the exact callers', 'src/lib/workspace/scope.ts', "import type { CreatedWorkspace } from './workspace-allocation'"],
    ['alternate relative import spelling', facade, "import { allocateWorkspace } from '../workspace/workspace-allocation'"],
    ['namespace import', facade, "import * as raw from './workspace-allocation'"],
    ['default import', facade, "import raw from './workspace-allocation'"],
    ['unregistered imported symbol', facade, "import { unchecked } from './workspace-allocation'"],
    ['dynamic import', facade, "const raw = await import('./workspace-allocation')"],
    ['require import', installer, "const raw = require('../workspace/workspace-allocation')"],
    ['indirect module variable', facade, "const target = './workspace-allocation'; const raw = import(target)"],
    ['computed template import', facade, "const raw = import(`./workspace-allocation${suffix}`)"],
    ['star barrel export', 'src/lib/workspace/index.ts', "export * from './workspace-allocation'"],
    ['named barrel export', facade, "export { allocateWorkspace as unchecked } from './workspace-allocation'"],
    ['local renamed public export', facade, "import { allocateWorkspace as allocate } from './workspace-allocation'; export { allocate as unchecked }"],
    ['default public export', facade, "import { allocateWorkspace } from './workspace-allocation'; export default allocateWorkspace"],
    ['assignment exposes allocator', facade, "import { allocateWorkspace } from './workspace-allocation'; export const unchecked = allocateWorkspace"],
    ['callback exposes allocator', facade, "import { allocateWorkspace } from './workspace-allocation'; export const unchecked = () => allocateWorkspace()"],
    ['extra named bypass', facade, "import { allocateWorkspace } from './workspace-allocation'; export function unchecked() { return allocateWorkspace() }"],
    ['nested registered name', facade, "import { allocateWorkspace } from './workspace-allocation'; export function createWorkspace() { return allocateWorkspace() }; export function unchecked() { function createWorkspace() { return allocateWorkspace() }; return createWorkspace() }"],
    ['duplicate top-level registered name', facade, "import { allocateWorkspace } from './workspace-allocation'; export function createWorkspace() { return allocateWorkspace() }; export function createWorkspace() { return allocateWorkspace() }"],
    ['shadowed module target', facade, "const target = './workspace-allocation'; async function unchecked() { return import(target) }; function later() { const target = './work-kind' }"],
    ['new internal runtime export', allocator, 'export function unchecked() {}'],
    ['internal alias export', allocator, 'export { allocateWorkspace as unchecked }'],
  ] as const)('rejects %s', (_name, file, source) => {
    expect(inspect(file, source).length).toBeGreaterThan(0)
  })
})
