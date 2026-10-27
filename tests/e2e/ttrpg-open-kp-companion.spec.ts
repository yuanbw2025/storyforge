import { expect, test } from '@playwright/test'

/** Native isolated DB/real runtime API; deterministic provider fixture, not live-model acceptance. */
test('KP candidate survives reload, adopts once and hands off without a new model call, action or epoch', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await helper.setupChecksFixtureV1({ ai: true })
    const paused = await api.resumeTtrpgOpenPlayV1(f.command)
    const envelope = await (await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')).openEnvelopeV1(f.command.sessionId, 'browser.kp')
    const generated = await api.generateTtrpgOpenKpCandidateV1({ ...envelope, scope: f.f.scope, viewerKey: f.command.viewerKey,
      maximumOutputTokens: 800, maximumCostUsd: 0.1, rawInput: 'NEVER-SHARE-PRIVATE-HUMAN-THOUGHT',
      runAI: async () => JSON.stringify({ paragraphs: [{ text: '你们看清了本次行动留下的结果。', sourceKeys: ['action.receipt'] }] }) })
    return { command: f.command, scope: f.f.scope, paused, runId: generated.prepared.runId, requestKey: generated.prepared.requestKey,
      candidateHash: generated.candidate.candidateHash, state: await api.readProductRuntimeState(f.command.sessionId) }
  })
  expect(initial.paused).toEqual({ status: 'awaiting-narration', nextStepKey: 'narration' })
  await page.reload()
  const result = await page.evaluate(async f => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), helper = await importer('/storyforge/tests/helpers/open-ttrpg-branch-recovery.ts')
    const proof = { scope: f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey, runId: f.runId, requestKey: f.requestKey }
    const candidate = await api.readTtrpgOpenKpCandidateV1(proof)
    const command = { ...await helper.operationInput(f.command.sessionId, f.command.operationKey, 'narration'), ...proof, candidateHash: f.candidateHash }
    await api.acceptTtrpgOpenKpNarrationV1(command)
    const first = await api.resumeTtrpgOpenPlayV1(f.command), state = await api.readProductRuntimeState(f.command.sessionId)
    const repeated = await api.resumeTtrpgOpenPlayV1(f.command)
    return { candidateHash: candidate.candidateHash, first, repeated, state, unchanged: JSON.stringify(state) === JSON.stringify(await api.readProductRuntimeState(f.command.sessionId)) }
  }, initial)
  expect(result.candidateHash).toBe(initial.candidateHash)
  expect(result.first).toEqual({ status: 'completed', nextStepKey: null, handoff: { kind: 'companion-ready', actorKey: 'companion.1' } })
  expect(result.repeated).toEqual(result.first);expect(result.unchanged).toBe(true)
  expect(result.state.entities).toEqual(initial.state.entities)
  expect(result.state.ttrpg.openRun.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
  expect(result.state.ttrpg.openRun.coordination).toEqual(initial.state.ttrpg.openRun.coordination)
  expect(result.state.ttrpg.openRun.narrations).toHaveLength(1)
})
