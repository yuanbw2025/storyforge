import { beforeEach, afterEach, expect, it } from "vitest";
import { db } from "../../src/lib/db/schema";
import { createChatDraftV1, readChatDraftV1, saveChatDraftV1, selectChatWorldV1, } from "../../src/lib/character-interaction/draft-service";
import { DEFAULT_CHAT_SETTINGS, } from "../../src/lib/character-interaction/authoring-contract";
import { createMistHarborWorld } from "../../src/lib/world-engine/mist-harbor-preset";
import { exportProjectJSON, importProjectJSON, } from "../../src/lib/export/json-export";
import { deleteWork } from "../../src/lib/workspace/lifecycle";
beforeEach(async () => {
    await db.delete();
    await db.open();
});
afterEach(() => db.close());
it("keeps a pre-world CHAT draft, rejects stale writes, and roundtrips a frozen source without copying mutable canon", async () => {
    const avg = await createChatDraftV1("我的 CHAT");
    let draft = await readChatDraftV1(avg.scope);
    expect(avg.work.kind).toBe("character-interaction");
    expect(draft.worldReleaseId).toBeNull();
    draft = await saveChatDraftV1(avg.scope, 0, {
        ...DEFAULT_CHAT_SETTINGS,
        playerRole: "守灯人",
    });
    await expect(saveChatDraftV1(avg.scope, 0, DEFAULT_CHAT_SETTINGS)).rejects.toThrow("其他页面");
    const source = await createMistHarborWorld();
    draft = await selectChatWorldV1(avg.scope, draft.revision, source.worldReleaseId);
    const frozen = await db.worldReleases.get(draft.worldReleaseId!);
    expect(frozen?.releaseUid).toBe((await db.worldReleases.get(source.worldReleaseId))?.releaseUid);
    expect(frozen?.projectId).toBe(avg.scope.projectId);
    expect(await db.characters.where("projectId").equals(avg.scope.projectId).count()).toBe(0);
    const exported = await exportProjectJSON(avg.scope.projectId);
    const imported = await importProjectJSON(exported);
    const restored = await db.chatAuthoringDrafts
        .where("projectId")
        .equals(imported)
        .first();
    expect(restored?.workId).not.toBe(avg.scope.workId);
    expect((await db.worldReleases.get(restored!.worldReleaseId!))?.releaseUid).toBe(frozen?.releaseUid);
    expect(JSON.parse(restored!.settingsJson).playerRole).toBe("守灯人");
    await deleteWork(restored!.workId);
    expect(await db.chatAuthoringDrafts.where("projectId").equals(imported).count()).toBe(0);
    expect(await db.worldReleases.get(source.worldReleaseId)).toBeDefined();
});

it('archives consultation context without deleting its ledger or settings', async () => {
  const {saveChatConversationV1, archiveChatConversationV1} = await import('../../src/lib/character-interaction/draft-service')
  const {assembleContext} = await import('../../src/lib/registry/assemble-context')
  const owned = await createChatDraftV1('会谈归档')
  const draft = await saveChatConversationV1(owned.scope, 0, {id:'prior',question:'旧讨论标识',answer:'保留记录',settings:null,runId:null,error:'',createdAt:Date.now()})
  const archived = await archiveChatConversationV1(owned.scope, draft.revision)
  expect(JSON.parse(archived.conversationJson)[0]).toMatchObject({archived:true,question:'旧讨论标识'})
  expect(JSON.parse(archived.settingsJson)).toEqual(DEFAULT_CHAT_SETTINGS)
  const context = await assembleContext({projectId:owned.scope.projectId,scope:owned.scope,sourceKeys:['chat.authoring'],inputBudgetMaxTokens:20000})
  expect(context.text).not.toContain('旧讨论标识')
  await expect(archiveChatConversationV1(owned.scope, draft.revision)).rejects.toThrow('变化')
})

it('freezes saved role settings into an authorized production and refuses a foreign source key', async () => {
  const {seedCurrentProductWorld} = await import('../helpers/current-product-world')
  const {loadProductProductionConsultationSourceV2} = await import('../../src/lib/product-production/world-source')
  const {draftProductProductionBriefV3,suggestProductStartingPoints} = await import('../../src/lib/product-production/consultation')
  const {executeProductProductionCommand} = await import('../../src/lib/product-production/commands')
  const source = await seedCurrentProductWorld('角色制作来源')
  const owned = await createChatDraftV1('角色闭环')
  const linked = await selectChatWorldV1(owned.scope,0,source.release.id!)
  const catalog = await loadProductProductionConsultationSourceV2({scope:owned.scope,worldReleaseId:linked.worldReleaseId!})
  const key = catalog.selectionOptions.characters.find(c=>c.label==='林舟')!.resourceKey
  const settings = {...DEFAULT_CHAT_SETTINGS,playerRole:'守灯人',openingSituation:'核对来信',characters:[{sourceKey:key,voiceRules:'简短直接',privateKnowledge:'独自保管的暗号',initialTrust:24}]}
  await saveChatDraftV1(owned.scope,linked.revision,settings)
  const suggestions = await suggestProductStartingPoints({scope:owned.scope,worldReleaseId:linked.worldReleaseId!})
  const input = {scope:owned.scope,worldReleaseId:linked.worldReleaseId!,suggestionKey:suggestions.suggestions[0].suggestionKey,productType:'character-interaction' as const,characterChat:settings,visualLevel:'none' as const,audioLevel:'none' as const,playerRole:settings.playerRole,openingSituation:settings.openingSituation}
  await expect(draftProductProductionBriefV3({...input,characterChat:{...settings,characters:[{...settings.characters[0],sourceKey:'foreign'}]}})).rejects.toThrow('不存在的人物')
  const brief=await draftProductProductionBriefV3(input)
  const created=await executeProductProductionCommand({scope:owned.scope,command:{type:'create-intent',commandId:'chat.intent',productionKey:'chat.closed-loop',productType:'character-interaction',worldReleaseId:linked.worldReleaseId!,userText:'制作角色聊天'}})
  const saved=await executeProductProductionCommand({scope:owned.scope,productionId:created.productionId,command:{type:'save-brief-revision',commandId:'chat.brief',expectedStateRevision:0,parentRevision:null,brief}})
  await executeProductProductionCommand({scope:owned.scope,productionId:created.productionId,command:{type:'authorize-start',commandId:'chat.start',expectedStateRevision:1,briefRevision:1,briefHash:saved.result.briefHash as string,authorizationNonce:'explicit-click'}})
  const frozen = await db.productProductionBriefs.where('productionId').equals(created.productionId).last()
  expect(frozen!.status).toBe('authorized')
  expect(JSON.parse(frozen!.briefJson).characterChat).toEqual(settings)
  expect(frozen!.workId).toBe(owned.scope.workId)
  expect(frozen!.workId).not.toBe(source.scope.workId)
  expect((await db.worldReleases.get(source.release.id!))!.contentHash).toBe(source.release.contentHash)
},30000)
