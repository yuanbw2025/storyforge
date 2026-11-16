import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as context from '../../src/lib/registry/assemble-context'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { usePromptStore } from '../../src/stores/prompt'
import {
  adoptProseExtractionFixtureV1 as adopt,
  generateProseExtractionCandidateFixtureV1 as generate,
  readProseExtractionRowsV1 as rows,
  recoverableProseExtractionV1,
  seedProseExtractionSourceFixtureV1 as seed,
  type ProseExtractionKindV1,
} from '../helpers/prose-extraction-source-cas'

const editedBody = '<p>作者已修改冻结来源：本章没有找到钥匙，也未进入钟楼。新正文必须保留。</p>'

async function expectSourceStale(pending: Promise<unknown>) {
  let errorMessage = ''
  try { await pending } catch (error) { errorMessage = error instanceof Error ? error.message : String(error) }
  expect(errorMessage).toMatch(/变化|过期|停止|stale/)
}

describe.sequential('SFQA-073 · extraction source CAS across adoption and first receipt', () => {
  beforeEach(async () => {
    usePromptStore.setState({ templates: [], loaded: false })
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    usePromptStore.setState({ templates: [], loaded: false })
    db.close()
  })

  for (const kind of ['inventory', 'timeline'] as const satisfies readonly ProseExtractionKindV1[]) {
    it(`${kind}: unchanged sources adopt and replay the exact receipt without rewriting rows or models`, async () => {
      const fixture = await seed()
      const generated = await generate(kind, fixture.scope)
      expect(generated.modelCalls()).toBe(2)
      const input = { scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes }
      const accepted = await adopt(kind, input)
      const first = await rows(kind, fixture.scope)
      expect(accepted.snapshot.projection.state).toBe('completed')
      expect(accepted.written).toBe(2)
      expect((await adopt(kind, input)).receiptHash).toBe(accepted.receiptHash)
      expect(await rows(kind, fixture.scope)).toEqual(first)
      expect(generated.modelCalls()).toBe(2)
    })

    it(`${kind}: editing the previewed source before confirmation preserves the author's text and prior rows`, async () => {
      const fixture = await seed()
      const original = await rows(kind, fixture.scope)
      const generated = await generate(kind, fixture.scope)
      await db.chapters.update(fixture.chapterIds[0], { content: editedBody })
      const input = { scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes }
      await expectSourceStale(adopt(kind, input))
      expect(await rows(kind, fixture.scope)).toEqual(original)
      expect((await db.chapters.get(fixture.chapterIds[0]))?.content).toBe(editedBody)
      const stopped = await readAgentRunV1(fixture.scope, input.runId)
      expect(stopped.projection.terminalReceiptHash).toBeUndefined()
      expect(stopped.events.some(event => event.type === 'confirmation.recorded')).toBe(false)
      expect(generated.modelCalls()).toBe(2)
    })

    it(`${kind}: settlement failure rolls back the first receipt; an explicit retry keeps all chapter rows`, async () => {
      const fixture = await seed()
      const generated = await generate(kind, fixture.scope)
      const input = { scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes }
      const failSettlement = (_key: unknown, row: { type?: string }) => {
        if (row.type === 'memory.settlement.recorded') throw new Error('storage-full-at-settlement')
      }
      db.agentRunEvents.hook('creating', failSettlement)
      try {
        await expect(adopt(kind, input)).rejects.toThrow('storage-full-at-settlement')
      } finally {
        db.agentRunEvents.hook('creating').unsubscribe(failSettlement)
      }
      const savedRows = await rows(kind, fixture.scope)
      const failed = await readAgentRunV1(fixture.scope, input.runId)
      expect(failed.projection.terminalReceiptHash).toBeUndefined()
      expect(failed.events.some(event => event.type === 'verification.accepted')).toBe(false)
      const accepted = await adopt(kind, input)
      expect(accepted.snapshot.events.filter(event => event.type === 'verification.accepted')).toHaveLength(1)
      expect(accepted.snapshot.events.filter(event => event.type === 'memory.settlement.recorded')).toHaveLength(1)
      expect(await rows(kind, fixture.scope)).toEqual(savedRows)
      expect(generated.modelCalls()).toBe(2)
    })

    it(`${kind}: source edits after the first committed chapter stop later replacements and preserve both authorship and committed rows`, async () => {
      const fixture = await seed()
      const original = await rows(kind, fixture.scope)
      const generated = await generate(kind, fixture.scope)
      await expectSourceStale(adopt(kind, {
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
        onDurableBoundary: async (boundary, _snapshot, index) => {
          if (boundary === 'formal.chapter' && index === 0) await db.chapters.update(fixture.chapterIds[1], { content: editedBody })
        },
      }))
      const current = await rows(kind, fixture.scope)
      expect(current.find(row => row.chapterId === fixture.chapterIds[0])?.id).not.toBe(original[0].id)
      expect(current.find(row => row.chapterId === fixture.chapterIds[1])).toEqual(original[1])
      expect((await db.chapters.get(fixture.chapterIds[1]))?.content).toBe(editedBody)
      const run = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
      expect(run.projection.state).toBe('paused')
      expect(run.projection.terminalReceiptHash).toBeUndefined()
      expect(run.events.some(event => event.type === 'verification.accepted')).toBe(false)
      expect(await recoverableProseExtractionV1(kind, fixture.scope) == null).toBe(true)
      expect(generated.modelCalls()).toBe(2)
    })

    for (const boundary of ['adoption.committed', 'step.succeeded', 'verification.started'] as const) {
      it(`${kind}: changes at ${boundary} cannot mint the first successful receipt`, async () => {
        const fixture = await seed()
        const generated = await generate(kind, fixture.scope)
        await expectSourceStale(adopt(kind, {
          scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
          onDurableBoundary: async reached => {
            if (reached === boundary) await db.chapters.update(fixture.chapterIds[0], { content: editedBody })
          },
        }))
        const run = await readAgentRunV1(fixture.scope, generated.snapshot.run.id)
        expect(run.projection.state).toBe('paused')
        expect(run.projection.terminalReceiptHash).toBeUndefined()
        expect(run.events.some(event => event.type === 'verification.accepted')).toBe(false)
        expect((await db.chapters.get(fixture.chapterIds[0]))?.content).toBe(editedBody)
        expect((await rows(kind, fixture.scope)).every(row => String(row[kind === 'inventory' ? 'itemName' : 'title']).startsWith('新'))).toBe(true)
        expect(generated.modelCalls()).toBe(2)
      })
    }

    it(`${kind}: registered reads stay frozen while an independent author write queues; no replacement follows that write`, async () => {
      const fixture = await seed()
      const generated = await generate(kind, fixture.scope)
      const assemble = context.assembleContext
      let armed = false
      let injected = false
      let pendingAuthor: Promise<unknown> | undefined
      let rowsAtAuthorCommit: Record<string, unknown>[] | undefined
      vi.spyOn(context, 'assembleContext').mockImplementation(async input => {
        const assembled = await assemble(input)
        if (armed && !injected && input.chapterId === fixture.chapterIds[1] && input.sourceKeys?.includes('chapterContent')) {
          injected = true
          const locked = Dexie.currentTransaction != null
          pendingAuthor = Dexie.ignoreTransaction(() => db.transaction('rw', scopeTransactionTables(
            db.chapters, kind === 'inventory' ? db.itemLedger : db.storyTimelineEvents,
          ), async () => {
            await db.chapters.update(fixture.chapterIds[0], { content: editedBody })
            rowsAtAuthorCommit = await rows(kind, fixture.scope)
          }))
          // A separate author must wait for the current adoption lock to release.
          if (!locked) await pendingAuthor
        }
        return assembled
      })
      await expectSourceStale(adopt(kind, {
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
        onDurableBoundary: boundary => { if (boundary === 'adoption.started') armed = true },
      }))
      await pendingAuthor
      expect(injected).toBe(true)
      expect(rowsAtAuthorCommit).toBeDefined()
      expect(await rows(kind, fixture.scope)).toEqual(rowsAtAuthorCommit)
      expect((await db.chapters.get(fixture.chapterIds[0]))?.content).toBe(editedBody)
      expect((await readAgentRunV1(fixture.scope, generated.snapshot.run.id)).projection.terminalReceiptHash).toBeUndefined()
    })

    it(`${kind}: a resumed first receipt rejects an author replacement that kept its visible fields`, async () => {
      const fixture = await seed()
      const generated = await generate(kind, fixture.scope)
      const input = { scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes }
      await expect(adopt(kind, { ...input, onDurableBoundary: boundary => {
        if (boundary === 'verification.started') throw new Error('window-closed-before-receipt')
      } })).rejects.toThrow('window-closed-before-receipt')
      async function replaceIdentity<T extends { id?: number }>(table: import('dexie').Table<T, number>) {
        const first = (await table.where('projectId').equals(input.scope.projectId).first())!
        await db.transaction('rw', table, async () => {
          await table.delete(first.id!)
          await table.add({ ...first, id: undefined })
        })
        return first.id
      }
      const id = kind === 'inventory'
        ? await replaceIdentity(db.itemLedger)
        : await replaceIdentity(db.storyTimelineEvents)
      const authorRows = await rows(kind, input.scope)
      expect(authorRows.some(row => row.id === id)).toBe(false)
      await expectSourceStale(adopt(kind, input))
      const stopped = await readAgentRunV1(input.scope, input.runId)
      expect(stopped.projection.terminalReceiptHash).toBeUndefined()
      expect(stopped.events.some(event => event.type === 'verification.accepted')).toBe(false)
      expect(await rows(kind, input.scope)).toEqual(authorRows)
    })

    it(`${kind}: receipt-only interruption resumes with unchanged upstream without treating its own writes as drift`, async () => {
      const fixture = await seed()
      const generated = await generate(kind, fixture.scope)
      const input = { scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes }
      await expect(adopt(kind, { ...input, onDurableBoundary: boundary => {
        if (boundary === 'verification.started') throw new Error('simulated-refresh')
      } })).rejects.toThrow('simulated-refresh')
      const written = await rows(kind, fixture.scope)
      expect((await adopt(kind, input)).snapshot.projection.state).toBe('completed')
      expect(await rows(kind, fixture.scope)).toEqual(written)
      expect(generated.modelCalls()).toBe(2)
    })

    it(`${kind}: an ABA source change cannot separate the captured version from the registered verification`, async () => {
      const fixture = await seed()
      const original = await rows(kind, fixture.scope)
      const oldBody = (await db.chapters.get(fixture.chapterIds[0]))!.content
      const newBody = editedBody + oldBody
      const generated = await generate(kind, fixture.scope)
      const assemble = context.assembleContext
      const pending: Promise<unknown>[] = []
      let armed = false
      let restored = false
      let changedAgain = false
      const authorWrite = async (body: string) => {
        const insideRead = Dexie.currentTransaction != null
        const write = Dexie.ignoreTransaction(() => db.chapters.update(fixture.chapterIds[0], { content: body }))
        pending.push(write)
        // An independent author writer waits for any source read lock to finish.
        if (!insideRead) await write
      }
      vi.spyOn(context, 'assembleContext').mockImplementation(async input => {
        if (armed && !restored && input.chapterId === fixture.chapterIds[0]) {
          restored = true
          await authorWrite(oldBody)
        }
        const assembled = await assemble(input)
        if (armed && !changedAgain && input.chapterId === fixture.chapterIds[1]) {
          changedAgain = true
          await authorWrite(newBody)
        }
        return assembled
      })
      await expectSourceStale(adopt(kind, {
        scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
        onDurableBoundary: async boundary => {
          if (boundary === 'adoption.started') {
            await db.chapters.update(fixture.chapterIds[0], { content: newBody })
            armed = true
          }
        },
      }))
      await Promise.all(pending)
      expect(await rows(kind, fixture.scope)).toEqual(original)
      expect((await db.chapters.get(fixture.chapterIds[0]))?.content).toBe(newBody)
      expect(generated.modelCalls()).toBe(2)
    })
  }

  it('inventory: a referenced character rename between chapters stops stale name adoption', async () => {
    const fixture = await seed()
    const original = await rows('inventory', fixture.scope)
    const generated = await generate('inventory', fixture.scope)
    await expectSourceStale(adopt('inventory', {
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
      onDurableBoundary: async (boundary, _snapshot, index) => {
        if (boundary === 'formal.chapter' && index === 0) await db.characters.update(fixture.characterId, { name: '作者新角色名' })
      },
    }))
    expect((await rows('inventory', fixture.scope)).find(row => row.chapterId === fixture.chapterIds[1])).toEqual(original[1])
    expect((await db.characters.get(fixture.characterId))?.name).toBe('作者新角色名')
  })
})
