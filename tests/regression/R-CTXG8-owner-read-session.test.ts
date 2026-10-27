import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import type { ContextResourceProviderV1 } from '../../src/lib/registry/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { createContextAccessPolicyFromSkillV1 } from '../../src/lib/context-gateway/skill-policy'
import { createContextGatewayToolSessionV1, isContextGatewayResourceAllowedV1 } from '../../src/lib/context-gateway/tool-session'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'

const source = CONTEXT_SOURCES.find(row => row.key === 'ragSelection')!
const originalProvider = source.resources!, originalAllowList = source.requiresResourceKeyAllowList
const skill = () => getAgentSkillV1('world-origin.worldview-field')
async function fixture() {
  const f = await seedCurrentWorkspace('owner-scoped read session')
  await db.worldviews.add(stampNewRecord(f.scope,'worldviews',{
    projectId:f.scope.projectId,worldGroupId:null,races:'潮民以潮汐记历，镜裔不直呼真名。',cultureOverview:'誓言由潮钟见证。',createdAt:1,updatedAt:1,
  },{owner:'world'}))
  return f.scope
}
function execute(scope: Awaited<ReturnType<typeof fixture>>) {
  return executeContextGatewayV1({ skill:skill(),scope,worldGroupId:null,query:'扩写种族与民族',additionalReadsEnabled:false })
}
describe('CTXG-8 owner read sessions and transactional exact evidence', () => {
  beforeEach(async () => { await db.delete();await db.open() })
  afterEach(() => { source.resources=originalProvider;source.requiresResourceKeyAllowList=originalAllowList;db.close() })
  it('opens a fresh owner view per execution and checks it after actual reads', async () => {
    const scope = await fixture();let opened=0,checked=0,reads=0
    source.resources={...originalProvider,openReadSession:async () => {
      opened++
      return {provider:{...originalProvider,read:async input => { reads++;return originalProvider.read(input) }},assertCurrent:async () => { checked++ }}
    }}
    const first=await execute(scope),second=await execute(scope)
    expect(first.contextPacket.content).toContain('潮民');expect(second.contextPacket.content).toBe(first.contextPacket.content)
    expect(opened).toBe(2);expect(checked).toBe(2);expect(reads).toBeGreaterThan(0)
  })
  it('returns no prompt packet when the owner changes during asynchronous source reads', async () => {
    const scope=await fixture();let revision=1,reads=0
    source.resources={...originalProvider,openReadSession:async () => {
      const frozen=revision
      return {provider:{...originalProvider,read:async input => { const result=await originalProvider.read(input);reads++;revision++;return result }},
        assertCurrent:async () => { if(frozen!==revision) throw new Error('owner revision changed') }}
    }}
    await expect(execute(scope)).rejects.toThrow('owner revision changed');expect(reads).toBeGreaterThan(0)
  })
  it.each(['providerId','providerVersion'] as const)('refuses an owner view that changes registered %s', async field => {
    const scope=await fixture()
    source.resources={...originalProvider,openReadSession:async () => ({provider:{...originalProvider,[field]:'forged-owner-view'} as ContextResourceProviderV1,assertCurrent:async () => {}})}
    await expect(execute(scope)).rejects.toThrow(/不能替换登记来源/)
  })
  it('requires an explicit resource list for an owner that forbids broad reads; an empty list grants nothing', async () => {
    const scope=await fixture(),policy=createContextAccessPolicyFromSkillV1(skill())
    source.requiresResourceKeyAllowList=true
    await expect(createContextGatewayToolSessionV1({scope:{...scope,worldGroupId:null},policy,freezeProviderReads:true})).rejects.toThrow(/明确资源 allow-list/)
    const session=await createContextGatewayToolSessionV1({scope:{...scope,worldGroupId:null},policy,freezeProviderReads:true,allowedResourceKeys:[]})
    expect(isContextGatewayResourceAllowedV1(session,'worldview.races')).toBe(false)
  })
  it('rejects a role POV without an exact instance before reading any provider', async () => {
    const scope=await fixture()
    await expect(executeContextGatewayV1({skill:skill(),scope,resourceScope:{...scope,runtimeActorKey:'actor.other'},query:'族群',additionalReadsEnabled:false})).rejects.toThrow(/runtimeActorKey 必须绑定明确 instance/)
  })
  it.each(['available','tampered'] as const)('keeps a caller-owned IndexedDB transaction alive while checking %s exact bytes', async mode => {
    const scope=await fixture()
    const run=await createAgentRunV1({scope,contract:{version:1,objective:'exact bytes in existing transaction',workflowKind:'read-only-audit',runtimeBindingHash:'a'.repeat(64),
      scope:{projectId:scope.projectId,worldGroupId:null},permissions:{contextSourceKeys:['chapterContent'],writeTargets:[]},
      budget:{maxModelCalls:1,maxToolCalls:0,maxInputTokens:1000,maxOutputTokens:100,maxAttemptsPerStep:1},acceptance:[{id:'result',kind:'output-present',required:true}],
      verificationPlan:[{id:'terminal',kind:'terminal',verifier:'ctxg-exact-tx',criterionIds:['result']}],failurePolicy:{onProtocolError:'fail',onVerificationFailure:'fail',onStaleInput:'pause-for-author'}}})
    const content='原始证据\n第二行',record=await recordAgentRunArtifactV1({scope,runId:run.run.id,artifactKind:'source-snapshot',content})
    await db.transaction('rw',db.agentRunArtifacts,async () => {
      if(mode==='tampered') await db.agentRunArtifacts.update(record.artifact.id!,{content:'changed'})
      if(mode==='available') expect(await readAgentRunArtifactExactV1({projectId:scope.projectId,artifactKind:'source-snapshot',contentHash:record.artifact.contentHash})).toBe(content)
      else await expect(readAgentRunArtifactExactV1({projectId:scope.projectId,artifactKind:'source-snapshot',contentHash:record.artifact.contentHash})).rejects.toMatchObject({code:'corrupt'})
      expect((await db.agentRunArtifacts.get(record.artifact.id!))!.content).toBe(mode==='available'?content:'changed')
    })
  })
})
