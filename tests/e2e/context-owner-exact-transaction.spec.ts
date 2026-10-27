import { expect, test } from '@playwright/test'
/** Generic foundation proof in real IndexedDB; no model or product runtime is created. */
test('exact evidence can be read and checked within the caller transaction, including corruption rejection', async ({ page }) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const importer = new Function('p','return import(p)') as (p:string)=>Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { seedCurrentWorkspace } = await importer('/storyforge/tests/helpers/current-workspace.ts')
    const { createAgentRunV1 } = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const { recordAgentRunArtifactV1,readAgentRunArtifactExactV1 } = await importer('/storyforge/src/lib/memory/artifact-store.ts')
    const f=await seedCurrentWorkspace('native exact evidence transaction'),scope=f.scope
    const run=await createAgentRunV1({scope,contract:{version:1,objective:'native exact bytes',workflowKind:'read-only-audit',runtimeBindingHash:'a'.repeat(64),
      scope:{projectId:scope.projectId,worldGroupId:null},permissions:{contextSourceKeys:['chapterContent'],writeTargets:[]},
      budget:{maxModelCalls:1,maxToolCalls:0,maxInputTokens:1000,maxOutputTokens:100,maxAttemptsPerStep:1},acceptance:[{id:'result',kind:'output-present',required:true}],
      verificationPlan:[{id:'terminal',kind:'terminal',verifier:'ctxg-native-exact',criterionIds:['result']}],failurePolicy:{onProtocolError:'fail',onVerificationFailure:'fail',onStaleInput:'pause-for-author'}}})
    const content='需要逐字保留的原始证据\n'.repeat(20000)
    const stored=await recordAgentRunArtifactV1({scope,runId:run.run.id,artifactKind:'source-snapshot',content})
    const request={projectId:scope.projectId,artifactKind:'source-snapshot',contentHash:stored.artifact.contentHash}
    const available=await db.transaction('r',db.agentRunArtifacts,async () => {
      const body=await readAgentRunArtifactExactV1(request),after=await db.agentRunArtifacts.get(stored.artifact.id)
      return body===content && after.content===content && after.byteLength===new TextEncoder().encode(content).byteLength
    })
    await db.agentRunArtifacts.update(stored.artifact.id,{content:'changed'})
    const rejected=await db.transaction('r',db.agentRunArtifacts,async () => {
      let code=null
      try { await readAgentRunArtifactExactV1(request) } catch(error) { code=(error as any).code }
      const after=await db.agentRunArtifacts.get(stored.artifact.id)
      return {code,transactionStillUsable:after.content==='changed'}
    })
    return {available,rejected,count:await db.agentRunArtifacts.where('projectId').equals(scope.projectId).count()}
  })
  expect(result).toEqual({available:true,rejected:{code:'corrupt',transactionStillUsable:true},count:1})
})
