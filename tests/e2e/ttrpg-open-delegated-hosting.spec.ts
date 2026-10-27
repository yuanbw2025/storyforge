import { expect,test } from '@playwright/test'

/** Real native DB/source/adoption owners with an explicit simulated provider; no continuous UI or human-play acceptance. */
test('one prior delegation survives reload across human and two actual safe companion settlements',async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'),helpers = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const f = await (await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts')).setupChecksFixtureV1({ cooperative: true })
    await api.resumeTtrpgOpenPlayV1(f.command)
    const epoch = (await api.readProductRuntimeState(f.command.sessionId)).ttrpg.openRun.coordination.epochs[0]
    await api.delegateTtrpgOpenHostingV1({ ...await helpers.openEnvelopeV1(f.command.sessionId,'native.delegation'),viewerKey: f.command.viewerKey,
      epochKey: epoch.epochKey,maximumCostUsdPerCall: 0.1,decision: 'delegate-this-epoch' })
    const permission = (await api.readProductRuntimeState(f.command.sessionId)).ttrpg.openRun.coordination.epochs[0].hostingDelegation
    return { scope: f.f.scope,command: f.command,permission }
  })
  let command = initial.command
  for (const actorKey of ['human','companion.1','companion.2']) {
    await page.reload()
    const result = await page.evaluate(async ({ initial,command,actorKey }) => {
      const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
      const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'),helpers = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
      const operation = await importer('/storyforge/tests/helpers/open-ttrpg-branch-recovery.ts'),sessionId = command.sessionId
      const model = { scope: initial.scope,viewerKey: command.viewerKey,maximumOutputTokens: 800,maximumCostUsd: 0.1,hostingDelegationRef: initial.permission.sourceRef }
      if (actorKey !== 'human') {
        const generated = await api.generateTtrpgOpenCompanionCandidateV1({ ...await helpers.openEnvelopeV1(sessionId,`native.proposal.${actorKey}`),...model,actorKey,
          rawInput: '只依据自己的已知资料协作观察',runAI: async () => JSON.stringify({ goal: '观察港口',method: '调查',targetRefs: [],declaredResources: [],declaredAssumptions: [],requestedOutcome: null }) })
        const candidate = { runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash }
        await api.startTtrpgOpenDelegatedCompanionOperationV1({ ...await helpers.openEnvelopeV1(sessionId,`native.admit.${actorKey}`),...model,...candidate })
        const op = (await api.readProductRuntimeState(sessionId)).ttrpg.openRun.operations.at(-1)
        command = { sessionId,operationKey: op.operationKey,frozenPlanHash: op.planHash,viewerKey: command.viewerKey }
        await api.preauthorizeTtrpgOpenCompanionV1({ ...await operation.operationInput(sessionId,op.operationKey,'preauthorization'),...candidate,hostingDelegationRef: initial.permission.sourceRef })
      }
      const settled = await api.resumeTtrpgOpenPlayV1(command)
      if (settled.status !== 'awaiting-narration') throw new Error(`actual settlement stopped: ${JSON.stringify(settled)}`)
      const kp = await api.generateTtrpgOpenKpCandidateV1({ ...await helpers.openEnvelopeV1(sessionId,`native.kp.${actorKey}`),...model,
        rawInput: '依据实际结算叙述',runAI: async () => JSON.stringify({ paragraphs: [{ text: '你们看清了本次行动留下的结果。',sourceKeys: ['action.receipt'] }] }) })
      const adopt = { ...await operation.operationInput(sessionId,command.operationKey,'narration'),runId: kp.prepared.runId,
        requestKey: kp.prepared.requestKey,candidateHash: kp.candidate.candidateHash,hostingDelegationRef: initial.permission.sourceRef }
      const receipt = await api.acceptTtrpgOpenDelegatedKpNarrationV1(adopt)
      const repeated = await api.acceptTtrpgOpenDelegatedKpNarrationV1(adopt)
      const finished = await api.resumeTtrpgOpenPlayV1(command)
      return { command,finished,sameReceipt: receipt.sequence === repeated.sequence }
    },{ initial,command,actorKey })
    command = result.command
    expect(result.sameReceipt).toBe(true);expect(result.finished.status).toBe('completed')
    expect(result.finished.handoff).toEqual(actorKey === 'human' ? { kind: 'companion-ready',actorKey: 'companion.1' }
      : actorKey === 'companion.1' ? { kind: 'companion-ready',actorKey: 'companion.2' } : { kind: 'budget',actorKey: null })
  }
  await page.reload()
  const final = await page.evaluate(async command => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'),core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'),state = await api.readProductRuntimeState(command.sessionId),row = await db.productRuntimeSessions.get(command.sessionId)
    const replayed = core.replayProductRuntimeEvents(core.parseProductRuntimeState(row.initialStateJson),await db.productRuntimeEvents.where('sessionId').equals(command.sessionId).sortBy('sequence'))
    await api.resumeTtrpgOpenPlayV1(command)
    return { state,replayed: JSON.stringify(replayed) === JSON.stringify(state),unchanged: JSON.stringify(state) === JSON.stringify(await api.readProductRuntimeState(command.sessionId)) }
  },command)
  const run = final.state.ttrpg.openRun
  expect(run.operations.map((o: any) => o.status)).toEqual(['completed','completed','completed'])
  expect(run.operations.slice(1).every((o: any) => o.approvals.length === 0 && o.intentEvidence.hostingDelegationRef && o.preauthorization.hostingDelegationRef)).toBe(true)
  expect(run.worldTime.worldTurn).toBe(3);expect(run.narrations).toHaveLength(3);expect(run.narrations.every((n: any) => n.hostingDelegationRef)).toBe(true)
  expect(run.coordination.calls).toHaveLength(5);expect(run.coordination.calls.every((c: any) => c.status === 'succeeded' && c.hostingDelegationRef)).toBe(true)
  expect(run.coordination.epochs).toHaveLength(1);expect(run.coordination.epochs[0].successfulActorKeys).toEqual(['companion.1','companion.2'])
  expect(final.replayed).toBe(true);expect(final.unchanged).toBe(true)
})
