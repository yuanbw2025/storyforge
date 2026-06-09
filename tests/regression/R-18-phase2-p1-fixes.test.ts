/**
 * R-18: Phase 2.8 remaining P1 fixes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { trimMessagesToFit } from '../../src/lib/ai/context-budget'
import { chat } from '../../src/lib/ai/client'
import { sanitizeExportHtml } from '../../src/lib/export/sanitize-html'
import { removeLocationSubtree } from '../../src/components/geography/GeographyPanel'
import { filterExistingIds } from '../../src/components/outline/DetailedOutlinePanel'
import { useWorldNodeStore } from '../../src/stores/world-node'
import type { AIConfig, Location } from '../../src/lib/types'

describe('R-18: request trimming and abort signal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('trims messages before they exceed the model input budget', () => {
    const huge = '长'.repeat(12000)
    const result = trimMessagesToFit([
      { role: 'system', content: 'system-stays' },
      { role: 'user', content: huge },
    ], 'kimi', 'moonshot-v1-8k', 4096)

    expect(result.trimmed).toBe(true)
    expect(result.totalInputTokens).toBeLessThanOrEqual(result.inputBudget)
    expect(result.messages[0].content).toBe('system-stays')
    expect(result.messages[1].content.length).toBeLessThan(huge.length)
  })

  it('passes AbortSignal into non-streaming fetch', async () => {
    const ac = new AbortController()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(ac.signal)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const config: AIConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
      temperature: 0.7,
      maxTokens: 1024,
    }
    await expect(chat([{ role: 'user', content: 'ping' }], config, undefined, ac.signal)).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('R-18: export sanitization', () => {
  it('removes script tags, event handlers, and javascript urls', () => {
    const clean = sanitizeExportHtml('<p onclick="x()">正文</p><a href="javascript:alert(1)">x</a><script>alert(1)</script>')
    expect(clean).toContain('<p>正文</p>')
    expect(clean).not.toContain('onclick')
    expect(clean).not.toContain('javascript:')
    expect(clean).not.toContain('<script')
  })
})

describe('R-18: recursive geography and detailed-outline id filters', () => {
  it('removes all descendant locations, not only direct children', () => {
    const locations: Location[] = [
      loc('root', null),
      loc('child', 'root'),
      loc('grandchild', 'child'),
      loc('sibling', null),
    ]
    expect(removeLocationSubtree(locations, 'root').map(l => l.id)).toEqual(['sibling'])
  })

  it('filters hallucinated ids and deduplicates valid ids', () => {
    expect(filterExistingIds([1, 999, 1, 2], new Set([1, 2]))).toEqual([1, 2])
  })
})

describe('R-18: world portal cleanup', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('deleting a world node subtree removes reverse portal references and tolerates invalid portal JSON', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'R-18-world-node', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const rootId = await db.worldNodes.add(worldNode(projectId, null, 'root', now)) as number
    const childId = await db.worldNodes.add(worldNode(projectId, rootId, 'child', now)) as number
    const otherId = await db.worldNodes.add({
      ...worldNode(projectId, null, 'other', now),
      portalsJSON: JSON.stringify([{ name: 'to child', targetWorldId: childId, x: 0, y: 0 }]),
    } as any) as number
    await db.worldNodes.add({
      ...worldNode(projectId, null, 'broken', now),
      portalsJSON: '{bad json',
    } as any)

    await useWorldNodeStore.getState().deleteNode(rootId)

    expect(await db.worldNodes.get(rootId)).toBeUndefined()
    expect(await db.worldNodes.get(childId)).toBeUndefined()
    const other = await db.worldNodes.get(otherId)
    expect(other?.portalsJSON ?? '').not.toContain(String(childId))
  })
})

describe('R-18: multiworld context wiring', () => {
  it('SceneVerify uses one assembled world-scoped context for history and world rules', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/scene/SceneVerifyPanel.tsx'), 'utf8')
    expect(source).toContain('worldGroupId: project.enableMultiWorld ? activeGroupId ?? null : null')
    expect(source).toContain("'historical'")
    expect(source).toContain("'worldRules'")
    expect(source).toContain("const historyContext = part('historical')")
    expect(source).toContain("const worldRulesContext = part('worldRules')")
  })

  it('StoryCorePanel loads worldview with the active multiworld group', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/worldview/StoryCorePanel.tsx'), 'utf8')
    expect(source).toContain('useWorldGroupStore')
    expect(source).toContain('loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)')
  })
})

function loc(id: string, parentId: string | null): Location {
  return { id, parentId, name: id, type: 'other', description: '', significance: '', order: 0 }
}

function worldNode(projectId: number, parentId: number | null, name: string, now: number) {
  return {
    projectId,
    parentId,
    name,
    description: '',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  }
}
