import { afterAll, beforeAll, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  confirmTextOpenWorldCreatorArtifactEditIntentV1,
  createTextOpenWorldCreatorDirectEditOperationsV1,
  generateTextOpenWorldCreatorArtifactEditCandidateV1,
  prepareTextOpenWorldCreatorArtifactEditV1,
} from '../../src/lib/open-world/creator-artifact-edit'
import capture from '../helpers/fixtures/sfqa105-authorized-protagonist-v17.json'
import { seedSfqa105GovernedBuild } from '../helpers/sfqa105-creator-source-refs'

let build: Awaited<ReturnType<typeof seedSfqa105GovernedBuild>>

beforeAll(async () => {
  await db.delete()
  await db.open()
  build = await seedSfqa105GovernedBuild({ capture, includeComparisonHashes: false })
}, 120_000)

afterAll(() => db.close())

it('retains the author-selected frozen protagonist and permits an explicit edit after v17 recovery', async () => {
  expect(build.backupVersion).toBe(17)
  const selection = {
    scope: build.scope, productionId: build.productionId, buildId: build.buildId,
    expectedSnapshotHash: build.governanceSnapshotHash, artifactKey: build.artifactKey, entityIdentity: build.entityIdentity,
  }
  const context = await prepareTextOpenWorldCreatorArtifactEditV1(selection)
  const field = context.editableFields.find(row => row.jsonPointer === build.pointer)
  if (!field) throw new Error('Restored v17 author field is missing')
  const operations = await createTextOpenWorldCreatorDirectEditOperationsV1({
    context, values: { [field.fieldId]: '作者从已明确授权的 v17 作品恢复后修订小传。' },
  })
  const fresh = await generateTextOpenWorldCreatorArtifactEditCandidateV1({ selection, mode: 'direct', operations })
  const accepted = await confirmTextOpenWorldCreatorArtifactEditIntentV1({
    selection, runId: fresh.snapshot.run.id, warningAcknowledgementCodes: [],
  })
  expect(accepted.snapshot.projection.state).toBe('completed')
  expect(accepted.intent.candidateHash).toBe(fresh.candidate.candidateHash)
  expect(accepted.snapshot.projection.terminalReceiptHash).toBeTruthy()
}, 120_000)
