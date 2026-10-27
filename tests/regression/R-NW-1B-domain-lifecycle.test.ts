import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { adopt } from '../../src/lib/registry/adopt'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { inspectProjectBackup, normalizeProjectBackup } from '../../src/lib/export/backup-trust'
import { buildWorldReleaseManifest } from '../../src/lib/world-engine/releases'
import { portableNarrativeDomainFieldJsonV1 } from '../../src/lib/narrative-domain/references'
import { useCharacterStore } from '../../src/stores/character'
import { cascadeDeleteChapterRecords } from '../../src/lib/chapters/lifecycle'
import { seedNarrativeFamily } from '../helpers/narrative-world-evaluation'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { applyCharacterReferenceRemap } from '../../src/lib/registry/character-references'
import { transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } from '../../src/lib/world-engine/narrative-domain-capture'
import { confirmNarrativeDomainAnnotationsV1 } from '../../src/lib/world-engine/narrative-domain-authoring'

async function fixture() {
  const seeded = await seedNarrativeFamily(corpus.families[0]!)
  const characterId = seeded.localIds.get(`${corpus.families[0]!.id}:character-a`)!
  const character = (await db.characters.get(characterId))!
  const chapterId = seeded.localIds.get(`${corpus.families[0]!.id}:chapter-1`)!
  const chapter = (await db.chapters.get(chapterId))!
  const factId = seeded.factIds.get('superseded')!
  const fact = (await db.temporalFacts.get(factId))! as any
  const locationId = await db.importantLocations.add(stampNewRecord(seeded.scope, 'importantLocations', {
    projectId: seeded.scope.projectId, name: '隔离驿站', description: '北方驿站', parentId: null,
    type: 'town', order: 0, createdAt: 1, updatedAt: 1,
  } as never, { owner: 'world' })) as number
  const location = (await db.importantLocations.get(locationId))!
  const actor = { characterId, sourceUid: character.ragDocumentId! }
  const annotation = {
    eventType: 'communication' as const, participants: [{ entity: actor, role: 'sender' }],
    locations: [{ locationId, sourceUid: location.ragDocumentId! }],
    propositions: [{ kind: 'assertion' as const, source: { factId, sourceUid: fact.ragDocumentId! }, subKey: 'root' }],
    effects: [], communication: { sender: actor, recipients: [actor], channel: '信件' }, observer: null, before: [],
  }
  const eventId = await db.storyTimelineEvents.add(stampNewRecord(seeded.scope, 'storyTimelineEvents', {
    projectId: seeded.scope.projectId, title: '交付信件', description: '将信件交给守卫', importance: 2,
    order: 0, createdAt: 1, narrativeEventV1: annotation,
    narrativeTimeV1: { occurred: null, valid: null, acquiredAt: null, disclosedAt: [],
      narratedAt: { chapter: { chapterId, sourceUid: chapter.ragDocumentId! }, spanStart: 0 } },
  } as never, { owner: 'work' })) as number
  return { ...seeded, characterId, chapterId, factId, locationId, eventId, annotation }
}

describe('NW-1B · 实际备份与领域引用生命周期', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('注册表派生字段、重映射和删除声明，模型不能直接确认注释', async () => {
    const source = await fixture()
    for (const spec of PROJECT_TABLES.filter(item => item.worldSemantic?.projector)) {
      expect(spec.worldSemantic!.publishPolicy).toBe('reviewed-narrative-v1')
      for (const field of spec.worldSemantic!.projector!.annotationFields) {
        expect(spec.refs).toContainEqual(expect.objectContaining({ kind: 'narrative-source-refs-v1', field }))
        expect(spec.exportRefRemap).toContainEqual(expect.objectContaining({ kind: 'narrative-source-refs-v1', field }))
        expect(FIELD_BY_TARGET.get(spec.name)?.find(item => item.field === field)?.adoptionPolicy)
          .toBe(field === 'narrativeAuthorityV1' ? undefined : 'narrative-annotation-v1')
      }
    }
    const before = await db.storyTimelineEvents.get(source.eventId)
    const result = await adopt({ projectId: source.scope.projectId, scope: source.scope,
      target: 'storyTimelineEvents', recordId: source.eventId, mode: 'replace', data: {
        title: '模型自行生效', narrativeAuthorityV1: { mode: 'author-declaration' },
      } })
    expect(result.written).toHaveLength(0)
    expect(result.skipped[0]!.reason).toContain('模型不能自行')
    expect(await db.storyTimelineEvents.get(source.eventId)).toEqual(before)
  })

  it('一个事件的多种引用经完整备份重映射，历史 superseded 和冻结 v3 原字节保留', async () => {
    const source = await fixture()
    const backup = await deriveExportProjectJSON(source.scope.projectId) as any
    expect(backup.version).toBe(17)
    const exported = backup.storyTimelineEvents.find((row: any) => row.title === '交付信件')
    expect(exported.narrativeEventV1).toBeUndefined()
    expect(exported._narrativeEventV1Portable.participants[0].entity.characterId).toBe(0)
    expect(inspectProjectBackup(backup).errors).toEqual([])
    const restoredProject = await deriveImportProjectJSON(backup)
    const restored = (await db.storyTimelineEvents.where('projectId').equals(restoredProject).toArray())
      .find(row => row.title === '交付信件')!
    const annotation = restored.narrativeEventV1!
    expect(annotation.participants[0]!.entity.characterId).not.toBe(source.characterId)
    expect(annotation.locations[0]!.locationId).not.toBe(source.locationId)
    const historical = await db.temporalFacts.get((annotation.propositions[0]!.source as any).factId)
    expect(historical?.status).toBe('superseded')
    expect(portableNarrativeDomainFieldJsonV1('narrativeEventV1', annotation))
      .toBe(portableNarrativeDomainFieldJsonV1('narrativeEventV1', source.annotation))
    expect((await db.worldReleases.get(source.release.id!))!.manifestJson).toBe(source.release.manifestJson)
    const importedRelease = await db.worldReleases.where('projectId').equals(restoredProject).first()
    expect(importedRelease!.manifestJson).toBe(source.release.manifestJson)
  })

  it('本地编号复用、跨作品引用和便携缺失目标均失败且不留下半导入项目', async () => {
    const source = await fixture()
    const backup = await deriveExportProjectJSON(source.scope.projectId) as any
    const before = await db.projects.count()
    const row = backup.storyTimelineEvents.find((item: any) => item.title === '交付信件')
    row._narrativeEventV1Portable.participants[0].entity.characterId = 99999
    await expect(deriveImportProjectJSON(backup)).rejects.toThrow('便携来源不存在')
    expect(await db.projects.count()).toBe(before)
    const bad = structuredClone(source.annotation)
    bad.participants[0]!.entity.sourceUid = 'res:v1:character:00000000-0000-4000-8000-000000000001'
    await db.storyTimelineEvents.update(source.eventId, { narrativeEventV1: bad })
    await expect(deriveExportProjectJSON(source.scope.projectId)).rejects.toThrow('UID 与编号不一致')
    await db.storyTimelineEvents.update(source.eventId, { narrativeEventV1: source.annotation })
    const foreign = (await db.chapters.get(source.foreignChapterId))!
    await db.storyTimelineEvents.update(source.eventId, { narrativeTimeV1: {
      occurred: null, valid: null, acquiredAt: null, disclosedAt: [],
      narratedAt: { chapter: { chapterId: foreign.id!, sourceUid: foreign.ragDocumentId! }, spanStart: 0 },
    } })
    await expect(deriveExportProjectJSON(source.scope.projectId)).rejects.toThrow('跨 World/Work')
  })

  it('真实删除入口将角色和章节引用变成保留 UID 的墓碑，随后仍可备份恢复', async () => {
    const source = await fixture()
    await useCharacterStore.getState().deleteCharacter(source.characterId)
    await cascadeDeleteChapterRecords([source.chapterId])
    const event = (await db.storyTimelineEvents.get(source.eventId))!
    expect(event.narrativeEventV1!.participants[0]!.entity).toEqual({
      characterId: null, sourceUid: source.annotation.participants[0]!.entity.sourceUid,
    })
    expect(event.narrativeTimeV1!.narratedAt!.chapter.chapterId).toBeNull()
    const backup = await deriveExportProjectJSON(source.scope.projectId)
    expect(inspectProjectBackup(backup).errors).toEqual([])
    const restoredProject = await deriveImportProjectJSON(backup)
    const restored = await db.storyTimelineEvents.where('projectId').equals(restoredProject).first()
    expect(restored!.narrativeEventV1!.participants[0]!.entity).toEqual(event.narrativeEventV1!.participants[0]!.entity)
  })

  it('旧 v15 只转换版本，不补确认；禁止将新注释伪装成旧备份或旧 v3', async () => {
    const source = await fixture()
    await expect(buildWorldReleaseManifest({ scope: source.scope })).rejects.toThrow('需要 v4')
    const current = await deriveExportProjectJSON(source.scope.projectId) as any
    expect(inspectProjectBackup({ ...current, version: 15 }).valid).toBe(false)
    for (const row of current.storyTimelineEvents) {
      delete row._narrativeEventV1Portable; delete row._narrativeTimeV1Portable
    }
    const old = { ...current, version: 15 }
    for (const spec of PROJECT_TABLES) if (spec.exportable && (spec.introducedBackupVersion ?? 1) > 15) delete old[spec.name]
    const converted = normalizeProjectBackup(old)
    expect(converted.version).toBe(17)
    expect(old.version).toBe(15)
    expect(converted.storyTimelineEvents).toEqual(old.storyTimelineEvents)
    expect(JSON.stringify(converted)).not.toContain('narrativeAuthorityV1')
    expect((await db.worldReleases.get(source.release.id!))!.manifestJson).toBe(source.release.manifestJson)
  })

  it('自动合并不能丢失已确认身份或其证据引用，跨 owner 合并也在写入前拒绝', async () => {
    const source = await fixture(), work = (await db.works.get(source.scope.workId))!
    const from = (await db.characters.get(source.characterId))!
    const to = (await db.characters.where('projectId').equals(source.scope.projectId).toArray()).find(row => row.id !== from.id)!
    const snapshot = await captureNarrativeDomainV1({ scope: source.scope, owner: { kind: 'work', workCode: work.code } })
    const event = snapshot.rows.get('storyTimelineEvents')!.find(row => row.id === source.eventId)!
    await confirmNarrativeDomainAnnotationsV1({ scope: source.scope, table: 'storyTimelineEvents', recordId: source.eventId,
      expectedSourceHash: await hashNarrativeDomainSourceV1(snapshot, 'storyTimelineEvents', event), annotations: {} })
    const before = await db.storyTimelineEvents.get(source.eventId)
    const merge = () => db.transaction('rw', transactionTablesFor('importProject'), () => applyCharacterReferenceRemap({
      projectId: source.scope.projectId, fromCharacterId: from.id!, fromName: from.name, toCharacterId: to.id!, toName: to.name,
    }))
    await expect(merge()).rejects.toThrow('合并会改变已确认注释')
    expect(await db.storyTimelineEvents.get(source.eventId)).toEqual(before)
    expect(await db.characters.get(from.id!)).toEqual(from)
    await db.characters.update(to.id!, { worldId: source.scope.worldId + 1000 })
    await expect(merge()).rejects.toThrow('不能跨 World/Work')
    expect(await db.storyTimelineEvents.get(source.eventId)).toEqual(before)
  })
})
