import { expect, test } from '@playwright/test'

test('AVG rule confirmation verifies actual crypto evidence after refresh and backup remapping', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const seeded = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [fixture, authorFixture, { readAvgSystemPlanForCompilationV1 }, { db }] = await Promise.all([
      load('/storyforge/tests/helpers/avg-author-system-fixture.ts'), load('/storyforge/tests/helpers/avg-author-artifact-fixture.ts'),
      load('/storyforge/src/lib/avg/author-artifacts.ts'), load('/storyforge/src/lib/db/schema.ts'),
    ])
    const s = await fixture.seedAvgAuthorSystem()
    const candidate = await fixture.stageAvgAuthorSystem(s)
    const build = await db.productBuilds.get(s.buildId)
    let pendingError = ''
    try { await readAvgSystemPlanForCompilationV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }) }
    catch (error) { pendingError = String(error) }
    return { scope: s.scope, productionId: s.productionId, buildId: s.buildId, candidateId: candidate.id,
      payloadJson: candidate.payloadJson, contentHash: candidate.contentHash, pendingError,
      candidateVersion: JSON.parse(candidate.metadataJson).version,
      command: await authorFixture.authorFixtureCommand(s, candidate, 'browser.system.confirm') }
  })
  expect(seeded.candidateVersion).toBe(2)
  expect(seeded.pendingError).toContain('未采用')
  await page.reload()
  const confirmed = await page.evaluate(async s => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ executeProductProductionCommand }, author, compiler, { db }] = await Promise.all([
      load('/storyforge/src/lib/product-production/commands.ts'), load('/storyforge/src/lib/avg/author-artifacts.ts'),
      load('/storyforge/src/lib/avg/system-compiler.ts'), load('/storyforge/src/lib/db/schema.ts'),
    ])
    const result = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: s.command })
    if (!result.ok) throw new Error(JSON.stringify(result.result))
    const replay = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: s.command })
    const build = await db.productBuilds.get(s.buildId)
    const source = await author.readAvgSystemPlanForCompilationV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch })
    const preview = await compiler.simulateAvgSystemPlanV1({ plan: source.plan, actionKeys: ['inspect','share'] })
    return { ok: result.ok, replayed: replay.replayed, validation: source.validation, authorReceiptHash: source.authorReceiptHash,
      actualReceiptHash: result.result.authorReceiptHash, completed: preview.completed, visited: preview.steps.at(-1).visitedNodeKeys,
      runs: await db.agentRuns.count(), sessions: await db.productRuntimeSessions.count() }
  }, seeded)
  expect(confirmed).toMatchObject({ ok: true, replayed: true, completed: true, visited: ['desk','desk','handover'], runs: 0, sessions: 0 })
  expect(confirmed.validation).toMatchObject({ coverage: 'structure-and-entry', planHash: seeded.contentHash })
  expect(confirmed.authorReceiptHash).toBe(confirmed.actualReceiptHash)
  await page.reload()
  const restored = await page.evaluate(async s => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, backups, author, { deleteWork }] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/avg/author-artifacts.ts'), load('/storyforge/src/lib/workspace/lifecycle.ts'),
    ])
    const importedId = await backups.importProjectJSON(await backups.exportProjectJSON(s.scope.projectId))
    const build = await db.productBuilds.where('projectId').equals(importedId).first()
    const scope = { projectId: importedId, worldId: build.worldId, workId: build.workId }
    const request = { scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
    const compiled = await author.readAvgSystemPlanForCompilationV1(request)
    const artifact = await db.productBuildArtifacts.where('buildId').equals(build.id).filter((row: any) => row.artifactKey === 'avg.system.plan').first()
    const bytesPreserved = artifact.payloadJson === s.payloadJson
    await db.productBuildArtifacts.update(artifact.id, { payloadJson: JSON.stringify({ ...compiled.plan, title: '篡改的规则' }) })
    let tamperError = ''
    try { await author.readAvgSystemPlanForCompilationV1(request) } catch (error) { tamperError = String(error) }
    await deleteWork(importedId, build.workId)
    const original = await db.productBuildArtifacts.get(s.candidateId)
    return { remapped: build.id !== s.buildId && build.workId !== s.scope.workId, bytesPreserved,
      validation: compiled.validation, tamperError, restoredDeleted: !await db.productBuilds.get(build.id),
      originalPreserved: original.status === 'accepted' && original.payloadJson === s.payloadJson,
      runs: await db.agentRuns.count(), blobs: await db.mediaBlobObjects.count(), sessions: await db.productRuntimeSessions.count() }
  }, seeded)
  expect(restored).toMatchObject({ remapped: true, bytesPreserved: true, validation: confirmed.validation, restoredDeleted: true,
    originalPreserved: true, runs: 0, blobs: 0, sessions: 0 })
  expect(restored.tamperError).toContain('stale')
})
