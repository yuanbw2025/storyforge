import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { completedAgentRunEvidencePrefixV1 } from '../../src/lib/agent/run/projection'
import { assertTrustedProjectBackup } from '../../src/lib/export/backup-trust'
import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../../src/lib/export/json-export'
import legacy from '../fixtures/quality-freshness/legacy-chat-consult-v1-20261031.json'

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No real network in historical fixture verification') }))
})
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled()
  vi.unstubAllGlobals(); db.close()
})

it('removes the unused active chat v1 skill while retaining its real frozen historical contract and candidate', async () => {
  expect(() => getAgentSkillV1('chat.consult.v1')).toThrow('未知 Agent Skill')
  expect(getAgentSkillV1('chat.consult.v2').id).toBe('chat.consult.v2')
  const original = JSON.stringify(legacy)
  // Generated once by the unchanged production exporter and a synthetic runAI.
  // JSON modules widen discriminants; the normal backup trust gate still runs.
  const backup = structuredClone(legacy) as unknown as ProjectExportData
  assertTrustedProjectBackup(backup)
  const originalBindings = JSON.parse(backup.agentRuns[0]!.contractJson).executionBindings
  const originalPayload = backup.agentRunCheckpoints[0]!.resumePayloadJson
  const importedRunIds: number[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const projectId = await importProjectJSON(structuredClone(backup))
    const run = await db.agentRuns.where('projectId').equals(projectId).first()
    const work = run?.workId == null ? undefined : await db.works.get(run.workId)
    if (!run || !work) throw new Error('The actual imported historical owner is missing')
    importedRunIds.push(run.id!)
    const scope = { projectId, worldId: work.worldId, workId: work.id! }
    const snapshot = await readAgentRunV1(scope, run.id!)
    expect(snapshot.projection.errors).toEqual([])
    const prefix = completedAgentRunEvidencePrefixV1(snapshot.events)
    expect(prefix?.state).toBe('completed')
    expect(prefix?.terminalReceiptHash).toBeTruthy()
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(JSON.parse(run.contractJson).executionBindings).toEqual(originalBindings)
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, run.id!)
    expect(checkpoint?.resumePayload).toMatchObject({ answer: 'Synthetic retained legacy response', settings: { playerRole: 'Synthetic archive owner' } })
    const draft = await db.chatAuthoringDrafts.where('projectId').equals(projectId).first()
    expect(JSON.parse(draft!.settingsJson).playerRole).toBe('')
    const exported = await exportProjectJSON(projectId)
    expect(exported.agentRunCheckpoints[0]!.resumePayloadJson).toBe(originalPayload)
    expect(JSON.parse(exported.agentRuns[0]!.contractJson).executionBindings).toEqual(originalBindings)
  }
  expect(new Set(importedRunIds).size).toBe(2)
  expect(JSON.stringify(legacy)).toBe(original)
})
