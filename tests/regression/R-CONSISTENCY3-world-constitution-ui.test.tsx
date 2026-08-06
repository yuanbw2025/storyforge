import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorldConstitutionPanel from '../../src/components/facts/WorldConstitutionPanel'
import { db } from '../../src/lib/db/schema'
import { fingerprintSettingSource } from '../../src/lib/fact-ledger/setting-assertions'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('CONSISTENCY-3 · 世界宪法用户出口', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('展示设定扫描、候选证据及人工确认/否决出口', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'UI',
      genre: '',
      description: '',
      targetWordCount: 0,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const worldviewId = await db.worldviews.add({
      projectId,
      worldOrigin: '魔法源于月亮潮汐。',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    await db.temporalFacts.add({
      projectId,
      subjectWorldGroupId: null,
      subjectName: '默认世界',
      predicate: 'magicSource',
      factKind: 'state',
      value: '月亮潮汐',
      sourceType: 'setting',
      sourceRecordTable: 'worldviews',
      sourceRecordId: worldviewId,
      sourceWorldviewId: worldviewId,
      sourceField: 'worldOrigin',
      sourceFingerprint: fingerprintSettingSource('魔法源于月亮潮汐。'),
      sourceQuote: '魔法源于月亮潮汐',
      status: 'candidate',
      locked: false,
      createdAt: now,
      updatedAt: now,
    })

    await act(async () => {
      root.render(createElement(WorldConstitutionPanel, {
        project: { id: projectId, name: 'UI' } as any,
        onShowFacts: () => undefined,
      }))
    })
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('月亮潮汐'))
    })

    expect(host.textContent).toContain('世界宪法')
    expect(host.textContent).toContain('扫描已登记设定')
    expect(host.textContent).toContain('月亮潮汐')
    expect(host.textContent).toContain('worldviews.worldOrigin')
    expect(host.querySelector('button[title="确认世界宪法"]')).not.toBeNull()
    expect(host.querySelector('button[title="否决"]')).not.toBeNull()
  })
})
