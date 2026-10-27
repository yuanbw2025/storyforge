import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CURRENT_BACKUP_VERSION, inspectProjectBackup, normalizeProjectBackup } from '../../src/lib/export/backup-trust'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { recordTtrpgOpenNarrativeMemoryV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'

async function setup(withMemory = true) {
  const f = await readyOpenTtrpgSessionV1('memory storage boundary')
  const session = (await db.productRuntimeSessions.get(f.sessionId))!
  const draft = { revisionKey: 'fixture-memory.1',
    observerKey: 'hero', reliability: 'belief' as const, audience: 'private' as const, knownBy: ['hero'], summary: '角色认为灯塔里还有人。',
    fromEventSequence: 1, toEventSequence: session.runtimeHeadSequence }
  if (withMemory) await recordTtrpgOpenNarrativeMemoryV1({ ...await openEnvelopeV1(f.sessionId, 'fixture.memory.confirm'), viewerKey: OPEN_HUMAN_VIEWER, draft })
  const memory = (await db.ttrpgNarrativeMemories.where('sessionId').equals(f.sessionId).toArray())[0]
  return { ...f, memory }
}
describe('R-TTRPGOPEN8 unique memory storage foundation', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('roundtrips the closed memory shape with remapped instance/World/Work while preserving private reliability and evidence hash', async () => {
    const f = await setup(), backup = await exportProjectJSON(f.scope.projectId)
    expect(backup.version).toBe(CURRENT_BACKUP_VERSION)
    expect(backup.ttrpgNarrativeMemories).toHaveLength(1)
    expect(backup.ttrpgNarrativeMemories[0]).not.toHaveProperty('sessionId')
    const projectId = await importProjectJSON(backup)
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const rows = await db.ttrpgNarrativeMemories.where('projectId').equals(projectId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ...f.memory, id: rows[0].id, projectId, sessionId: session.id,
      worldId: session.worldId, workId: session.workId })
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(f.sessionId).count()).toBe(1)
    await expect(db.ttrpgNarrativeMemories.add({ ...rows[0], id: undefined })).rejects.toThrow()
    await deleteProductRuntimeSession(session.id!)
    expect(await db.ttrpgNarrativeMemories.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(f.sessionId).count()).toBe(1)
  })
  it.each([14, 15])('explicitly converts complete v%i backups by adding only newly introduced empty tables', async version => {
    const f = await setup(false), backup = await exportProjectJSON(f.scope.projectId) as unknown as Record<string, unknown> & { version: number }
    backup.version = version
    for (const spec of PROJECT_TABLES.filter(spec => spec.exportable && (spec.introducedBackupVersion ?? 1) > version)) delete backup[spec.name]
    const before = structuredClone(backup)
    expect(inspectProjectBackup(backup).valid).toBe(true)
    const converted = normalizeProjectBackup(backup)
    expect(converted.version).toBe(CURRENT_BACKUP_VERSION)
    expect(converted.ttrpgNarrativeMemories).toEqual([])
    expect(backup).toEqual(before)
    await importProjectJSON(converted as any)
    const injected = { ...backup, ttrpgNarrativeMemories: [] }
    expect(inspectProjectBackup(injected).valid).toBe(false)
    delete backup.characters
    expect(() => normalizeProjectBackup(backup)).toThrow(/缺少/)
  })
  it.each(['unknown-field', 'missing-observer', 'future-event', 'wrong-instance', 'duplicate'])('rejects %s before importing any project', async mode => {
    const f = await setup(), backup = await exportProjectJSON(f.scope.projectId)
    const row = backup.ttrpgNarrativeMemories[0] as any
    if (mode === 'unknown-field') row.unregisteredAuthority = true
    if (mode === 'missing-observer') row.observerKey = null
    if (mode === 'future-event') row.toEventSequence = 9000
    if (mode === 'wrong-instance') row._productRuntimeSessionExportId = 8000
    if (mode === 'duplicate') backup.ttrpgNarrativeMemories.push({ ...row, _exportId: 1 })
    const projects = await db.projects.count()
    await expect(importProjectJSON(backup)).rejects.toThrow()
    expect(await db.projects.count()).toBe(projects)
    expect(await db.ttrpgNarrativeMemories.where('sessionId').equals(f.sessionId).count()).toBe(1)
  })
})
