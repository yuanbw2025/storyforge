import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires explicit isolated preview flag'))
for (const interrupted of [false,true]) test(`native imported KP can be replaced by its real human with recoverable evidence interruption=${interrupted}`, async ({ page }, testInfo) => {
  test.setTimeout(120000)
  let sends = 0
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider:'ollama',baseUrl:'https://human-import.invalid/v1',model:'isolated-no-network',apiKey:'',maxTokens:800,contextWindow:65536 })))
  await page.route('https://human-import.invalid/**', async route => { sends++;await route.abort() })
  await page.goto('./')
  const f = await page.evaluate(async interrupted => {
    const importer = new Function('p','return import(p)') as (p: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-checks.ts'), env = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'),io = await importer('/storyforge/src/lib/export/json-export.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts'),{ resolveScope } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const source = await helper.setupChecksFixtureV1({ ai:true, maximumCalls:1 });await api.resumeTtrpgOpenPlayV1(source.command)
    const interruptCheckpoint = () => { throw new Error('native candidate checkpoint interrupted') }
    db.agentRunCheckpoints.hook('creating', interruptCheckpoint)
    try { await api.generateTtrpgOpenKpCandidateV1({ ...await env.openEnvelopeV1(source.command.sessionId,'native.import.kp'),scope:source.f.scope,viewerKey:source.command.viewerKey,
      rawInput:'只根据本次实际结算',maximumOutputTokens:800,maximumCostUsd:0.1,runAI:async () => JSON.stringify({ paragraphs:[{text:'原模型记录的调查结果。',sourceKeys:['action.receipt']}] }) })
      throw new Error('expected a real checkpoint storage failure')
    } catch (error) { if (!(error instanceof Error) || !error.message.includes('native candidate checkpoint interrupted')) throw error }
    finally { db.agentRunCheckpoints.hook('creating').unsubscribe(interruptCheckpoint) }
    const original = await api.readProductRuntimeState(source.command.sessionId), projectId = await io.importProjectJSON(await io.exportProjectJSON(source.f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({scope:{projectId,worldId:session.worldId,workId:session.workId}})
    const call = original.ttrpg.openRun.coordination.calls.find((c:any) => c.skillId==='prose.ttrpg-open-kp')
    const raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([projectId,'raw-response',call.responseArtifactHash]).first()
    if(interrupted) await db.agentRunArtifacts.delete(raw.id)
    return { scope,sessionId:session.id,viewerKey:source.command.viewerKey,operationKey:source.command.operationKey,sourceSessionId:source.command.sessionId,original,raw,requestKey:call.requestKey }
  }, interrupted)
  async function enter() {
    await page.getByLabel('我的角色',{exact:true}).selectOption(f.viewerKey)
    await page.getByRole('button',{name:'确认身份并进入',exact:true}).click()
  }
  await page.goto(`./play/session/${f.sessionId}`);await enter()
  await expect(page.getByLabel('待确认候选',{exact:true})).toHaveCount(0)
  await page.getByText('改由真人主持补写叙述',{exact:true}).click()
  await page.getByLabel('补写原因',{exact:true}).selectOption('replace-candidate')
  await page.getByLabel('人工叙述',{exact:true}).fill('我已复核当前结算，明确由真人补写本次调查结果。')
  await page.getByRole('button',{name:'确认保存人工叙述',exact:true}).click()
  if(interrupted) {
    await expect(page.locator('body')).toContainText('人工叙述已保存')
    await expect(page.getByRole('button',{name:'补齐人工叙述回执',exact:true})).toBeVisible()
    await page.reload();await enter()
    await expect(page.getByRole('button',{name:'补齐人工叙述回执',exact:true})).toBeVisible()
    await page.screenshot({path:testInfo.outputPath('import-human-repair-pending.png'),fullPage:true})
    await page.evaluate(async raw => {
      const importer = new Function('p','return import(p)') as (p:string)=>Promise<any>
      await (await importer('/storyforge/src/lib/db/schema.ts')).db.agentRunArtifacts.put(raw)
    }, f.raw)
    await page.getByRole('button',{name:'补齐人工叙述回执',exact:true}).click()
  }
  await expect(page.getByRole('button',{name:'补齐人工叙述回执',exact:true})).toHaveCount(0)
  await expect(page.locator('body')).toContainText('真人主持补写')
  await page.getByRole('button',{name:'继续结算已确认的行动',exact:true}).click()
  await expect(page.getByRole('button',{name:'结束本轮主持，准备下一次行动',exact:true})).toBeVisible()
  const result = await page.evaluate(async f => {
    const importer = new Function('p','return import(p)') as (p:string)=>Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const proof = await (await importer('/storyforge/src/lib/ttrpg/open-run-portability.ts')).readTtrpgOpenImportedCallOwnerV1(f)
    const snapshot = await (await importer('/storyforge/src/lib/agent/run/event-store.ts')).readInstanceAgentRunV1(f.scope,proof.runId)
    return {source:await api.readProductRuntimeState(f.sourceSessionId),copy:await api.readProductRuntimeState(f.sessionId),terminal:snapshot.projection.state,confirmation:snapshot.projection.steps['ttrpg.open.kp'].confirmation}
  },f)
  expect(result.source).toEqual(f.original);expect(result.copy.entities).toEqual(f.original.entities)
  expect(result.copy.ttrpg.openRun.coordination.calls).toEqual(f.original.ttrpg.openRun.coordination.calls)
  expect(result.terminal).toBe('failed');expect(result.confirmation).toBe('reject');expect(sends).toBe(0)
})
