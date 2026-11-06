import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { db } from '../../src/lib/db/schema'
import { currentNarrativeDomainRegistryV1 } from '../../src/lib/world-engine/narrative-domain-registry'
import { seedConfirmedNarrativeDomainV1 } from '../helpers/narrative-domain-fixture'
import { captureNarrativeDomainV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { projectNarrativeDomainCaptureV1 } from '../../src/lib/world-engine/narrative-domain-projection'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import type { NarrativeDomainRegistryV1 } from '../../src/lib/types/narrative-domain-registry'
import { compileNarrativeIndexV1 } from '../../src/lib/world-engine/narrative-index'
import { hashNarrativeValueV1 } from '../../src/lib/world-engine/narrative-json'

const path = 'src/lib/world-engine/semantic-registry-v4.json'

describe('NW-2A · v4 封存解释规则', () => {
  beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_900_000_000_000); await db.delete(); await db.open() })
  afterEach(() => { db.close(); vi.useRealTimers() })

  it('首次捕获当前注册合同；后续扩展必须选择新的 wire 版本', () => {
    const current = currentNarrativeDomainRegistryV1()
    if (process.env.NW_CAPTURE_V4_REGISTRY === '1') writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' })
    const frozen = JSON.parse(readFileSync(path, 'utf8')) as NarrativeDomainRegistryV1
    expect(frozen).toEqual(current)
    expect(frozen.tables.every(spec => !('table' in spec))).toBe(true)
    expect(frozen.tables.filter(spec => spec.worldSemantic?.projector)).toHaveLength(13)
  })

  it('备份准入和待复核本地坐标不改封存解释，真实语义引用变更仍可见', () => {
    const spec = PROJECT_TABLES.find(item => item.name === 'chapters')!
    const original = spec.exportRemap!
    const before = currentNarrativeDomainRegistryV1()
    try {
      spec.exportRemap = [
        ...original.map(ref => ({ ...ref, requiredOnImport: true as const, sameWorkOnImport: true as const })),
        { field: 'localReviewChapterId', remapVia: 'chapters', exportAs: '_localReviewChapterExportId', reviewLocal: 'chapter' },
      ]
      expect(currentNarrativeDomainRegistryV1()).toEqual(before)
      spec.exportRemap = original.map((ref, index) => index === 0 ? { ...ref, remapVia: 'characters' } : ref)
      expect(currentNarrativeDomainRegistryV1()).not.toEqual(before)
    } finally { spec.exportRemap = original }
    expect(currentNarrativeDomainRegistryV1()).toEqual(before)
  })

  it('当前注册表增加或更改领域时，已捕获合同的投影和索引字节不漂移', async () => {
    const fixture = await seedConfirmedNarrativeDomainV1()
    const capture = await captureNarrativeDomainV1(fixture.input)
    capture.registry = JSON.parse(readFileSync(path, 'utf8')) as NarrativeDomainRegistryV1
    const before = await projectNarrativeDomainCaptureV1(capture, fixture.input)
    expect(before.bundle.records.length).toBeGreaterThan(8)
    const spec = PROJECT_TABLES.find(item => item.name === 'characters')!
    const previous = spec.worldSemantic
    try {
      spec.worldSemantic = { version: 1, resourceKind: 'future-character', area: 'entities', canonPolicy: 'confirmed-rows-only', statusField: 'futureStatus' }
      const after = await projectNarrativeDomainCaptureV1(capture, fixture.input)
      expect(after).toEqual(before)
      const indexInput = { inputRootHash: await hashNarrativeValueV1(before), predicates: capture.registry.predicates }
      expect(await compileNarrativeIndexV1({ ...indexInput, projection: after }))
        .toEqual(await compileNarrativeIndexV1({ ...indexInput, projection: before }))
    } finally { spec.worldSemantic = previous }
  })
})
