import { readFileSync, statSync } from 'node:fs'
import { posix } from 'node:path'
import ts from 'typescript'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { readProductProductionDetailsV1 as readDetails } from '../../src/lib/product-production/read-details'
import { readProductProductionDetailsV1 as readThroughService } from '../../src/lib/product-production/service'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const production = 'src/lib/product-production/'
const service = production + 'service.ts'
const commands = production + 'commands.ts'
const authorSource = production + 'original-response-author-source.ts'
const booking = production + 'original-response-booking.ts'
const readDetailsModule = production + 'read-details.ts'

beforeAll(async () => { await db.delete(); await db.open() })
afterAll(() => db.close())

function resolveLocalModule(file: string, specifier: string): string | null {
  const name = specifier.startsWith('@/')
    ? 'src/' + specifier.slice(2)
    : specifier.startsWith('.') ? posix.normalize(posix.join(posix.dirname(file), specifier)) : null
  if (!name) return null
  const candidates = [name, name + '.ts', name + '.tsx', name + '/index.ts', name + '/index.tsx']
  if (/\.[cm]?jsx?$/.test(name)) candidates.push(name.replace(/\.[cm]?jsx?$/, '.ts'), name.replace(/\.jsx?$/, '.tsx'))
  return candidates.find(candidate => statSync(candidate, {throwIfNoEntry: false})?.isFile()) ?? null
}

function createRuntimeImportGraph() {
  const bySource = new Map<string, string[]>()
  const edges = (file: string) => {
    const existing = bySource.get(file)
    if (existing) return existing
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const targets = ast.statements.flatMap(node => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        const bindings = clause?.namedBindings
        if (clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly))) return []
      } else if (ts.isExportDeclaration(node)) {
        const exports = node.exportClause
        if (node.isTypeOnly || (exports && ts.isNamedExports(exports) && exports.elements.length > 0
          && exports.elements.every(element => element.isTypeOnly))) return []
      } else return []
      const module = node.moduleSpecifier
      if (!module || !ts.isStringLiteral(module)) return []
      const target = resolveLocalModule(file, module.text)
      return target ? [target] : []
    })
    bySource.set(file, targets)
    return targets
  }
  function path(source: string, destination: string): string[] | null {
    const pending = [[source]]
    const seen = new Set([source])
    for (let index = 0; index < pending.length; index++) {
      const route = pending[index]
      for (const dependency of edges(route[route.length - 1])) {
        if (dependency === destination) return [...route, dependency]
        if (!seen.has(dependency)) {
          seen.add(dependency)
          pending.push([...route, dependency])
        }
      }
    }
    return null
  }
  return { edges, path }
}

it('retains both original-response command handlers without a static route back to the service', () => {
  const graph = createRuntimeImportGraph()
  expect(graph.edges(service)).toContain(commands)
  expect(graph.edges(commands)).toEqual(expect.arrayContaining([authorSource, booking]))
  expect(graph.edges(authorSource)).toContain(readDetailsModule)
  expect(graph.edges(booking)).toContain(readDetailsModule)
  expect(graph.path(readDetailsModule, service)).toBeNull()
  expect(graph.path(readDetailsModule, commands)).toBeNull()
  expect({
    commandToService: graph.path(commands, service),
    authorToService: graph.path(authorSource, service),
    bookingToService: graph.path(booking, service),
  }).toEqual({commandToService: null, authorToService: null, bookingToService: null})
})


it('preserves the public details reader and its Work, Brief history, Build and pause read contract', async () => {
  expect(readThroughService).toBe(readDetails)
  const owner = await seedCurrentProductWorld('sfqa010-production-read')
  const foreign = await seedCurrentProductWorld('sfqa010-foreign')
  const worldReleaseId = owner.release.id!
  const {productionId} = await executeProductProductionCommand({scope: owner.scope, command: {
    type: 'create-intent', commandId: 'sfqa010.intent', productionKey: 'sfqa010.read-cycle',
    productType: 'avg', worldReleaseId, userText: '以冻结车站为背景的单场作品。',
  }})
  const intent = await readThroughService(owner.scope, productionId, ['avg'])
  expect(intent).toMatchObject({brief: null, executionBrief: null, build: null, artifactCount: 0,
    briefHistory: [], buildHistory: []})
  await expect(readDetails(foreign.scope, productionId, ['avg'])).rejects.toThrow('跨 Work')
  await expect(readThroughService(owner.scope, productionId, ['ttrpg'])).rejects.toThrow('不属于当前产品入口')

  const suggested = await suggestProductStartingPoints({scope: owner.scope, worldReleaseId})
  const brief = await draftProductProductionBriefV3({
    scope: owner.scope, worldReleaseId, suggestionKey: suggested.suggestions[0].suggestionKey,
    productType: 'avg', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
    requiredFacts: ['保留已封存事实'], forbiddenChanges: ['禁止写回冻结世界'],
  })
  const saved = await executeProductProductionCommand({scope: owner.scope, productionId, command: {
    type: 'save-brief-revision', commandId: 'sfqa010.brief', expectedStateRevision: intent.production.stateRevision,
    parentRevision: null, brief,
  }})
  const ready = await readThroughService(owner.scope, productionId, ['avg'])
  expect(ready).toMatchObject({brief: {revision: 1}, executionBrief: {intent: {productType: 'avg'}}, build: null})
  await executeProductProductionCommand({scope: owner.scope, productionId, command: {
    type: 'authorize-start', commandId: 'sfqa010.start', expectedStateRevision: ready.production.stateRevision,
    briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'sfqa010.click',
  }})
  const active = await readThroughService(owner.scope, productionId, ['avg'])
  expect(active).toMatchObject({brief: {revision: 1, status: 'authorized'},
    briefHistory: [{revision: 1, status: 'authorized'}], build: {buildNumber: 1}, buildHistory: [{buildNumber: 1}]})
  expect(active.recentCommands.map(row => row.commandId)).toEqual(['sfqa010.start', 'sfqa010.brief', 'sfqa010.intent'])

  await executeProductProductionCommand({scope: owner.scope, productionId, command: {
    type: 'pause', commandId: 'sfqa010.pause', expectedStateRevision: active.production.stateRevision, reason: '验证暂停读回',
  }})
  const stored = await db.productBuilds.get(active.build!.id!)
  const paused = await readDetails(owner.scope, productionId, ['avg'])
  expect(paused).toMatchObject({production: {status: 'paused'}, build: {status: 'paused'},
    buildHistory: [{status: 'paused'}], artifactCount: 0})
  expect(paused.recentCommands[0]?.commandId).toBe('sfqa010.pause')
  expect(await db.productBuilds.get(active.build!.id!)).toEqual(stored)
})
