import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adoptRestoredWorldGameCandidateV1,
  prepareWorldGameCopilotV1,
} from '../../src/lib/agent/world-game-copilot'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { selectAgentSkillIdV1 } from '../../src/lib/agent/workflow-catalog'
import { db } from '../../src/lib/db/schema'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { publishStoryGameDraft } from '../../src/lib/text-game/authoring'
import {
  parseWorldGameNarrativeCandidateV1,
  type WorldGameAuthoringProductV1,
  type WorldGameAuthoringRequestV1,
} from '../../src/lib/text-game/agent-contract'
import { validateStoryGameContent } from '../../src/lib/text-game/content'
import { loadWorldGameSourceCatalog } from '../../src/lib/text-game/world-generation'
import type { Project } from '../../src/lib/types'
import { createStoryGameInstance } from '../../src/lib/world-engine/instances'
import { installMistHarborDemoWorld } from '../../src/lib/world-engine/mist-harbor-demo'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'

async function fixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: '雾港 AI 游戏链路',
    genre: 'mystery',
    genres: ['mystery'],
    description: '',
    status: 'drafting',
    targetWordCount: 20_000,
    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const demo = await installMistHarborDemoWorld({ scope: owned.scope })
  const revision = await createWorldRevision({
    scope: owned.scope,
    label: '雾港 AI 创作源',
    selectedNarrativeModuleIds: [demo.narrativeModuleId],
  })
  const release = await publishWorldRevision(revision.id!)
  const catalog = await loadWorldGameSourceCatalog({
    scope: owned.scope,
    worldReleaseId: release.id!,
  })
  return { ...owned, release, catalog }
}

function requestFor(
  source: Awaited<ReturnType<typeof fixture>>,
  productType: WorldGameAuthoringProductV1,
): WorldGameAuthoringRequestV1 {
  const characters = new Set(source.catalog.characters.map(item => item.exportId))
  return {
    schema: 'storyforge.world-game-authoring-request',
    version: 1,
    productType,
    worldReleaseId: source.release.id!,
    worldContentHash: source.release.contentHash,
    narrativeModuleExportId: source.catalog.narrativeModules[0].exportId,
    characterExportIds: [...characters],
    characterRelationExportIds: source.catalog.relationships
      .filter(item => characters.has(item.fromCharacterExportId) && characters.has(item.toCharacterExportId))
      .map(item => item.exportId),
    importantLocationExportIds: source.catalog.locations.map(item => item.exportId),
    artifactExportIds: source.catalog.artifacts.map(item => item.exportId),
    codexEntryExportIds: source.catalog.loreEntries.map(item => item.exportId),
    storyArcExportIds: source.catalog.storyArcs.map(item => item.exportId),
    avgMediaAssetExportIds: source.catalog.mediaAssets.map(item => item.exportId),
    creativeBrief: '不要复刻失潮钟声原剧情；让港民突然遗忘自己的名字，玩家必须决定保存个人记忆还是恢复全港潮声。',
  }
}

function candidate(source: Awaited<ReturnType<typeof fixture>>, title = '雾港：无名潮汐') {
  const speaker = source.catalog.characters[0].exportId
  return {
    version: 1,
    title,
    description: '潮汐钟再次启动后，雾港居民开始遗忘姓名；玩家需要追查新危机并选择记忆的归属。',
    moduleKind: 'main',
    entryNodeKey: 'entry',
    nodes: [
      {
        key: 'entry', kind: 'entry', title: '无名者上岸', summary: '一个说不出姓名的孩子带来正在扩散的新危机。',
        beats: [{ beatKey: 'entry.1', kind: 'narration', speakerCharacterExportId: null, text: '晨潮送来一只空白名牌，整条街的人同时忘记了彼此。' }],
        choices: [
          { choiceKey: 'entry.archive', text: '去档案馆查失名记录', description: '优先寻找证据，但会错过救助码头居民。', targetNodeKey: 'archive' },
          { choiceKey: 'entry.harbor', text: '留在码头保护居民', description: '先稳定现场，但记录可能被人销毁。', targetNodeKey: 'harbor' },
        ],
      },
      {
        key: 'archive', kind: 'scene', title: '会消失的墨迹', summary: '档案揭示潮汐钟正在以姓名换取稳定潮位。',
        beats: [{ beatKey: 'archive.1', kind: 'dialogue', speakerCharacterExportId: speaker, text: '这不是十年前的旧事故。有人把钟改成了记忆的容器。' }],
        choices: [{ choiceKey: 'archive.core', text: '带上空白记录前往钟楼', description: '掌握真相后直面钟机。', targetNodeKey: 'core' }],
      },
      {
        key: 'harbor', kind: 'scene', title: '互相陌生的人群', summary: '玩家用守灯誓词让居民暂时重新建立信任。',
        beats: [{ beatKey: 'harbor.1', kind: 'action', speakerCharacterExportId: null, text: '你逐一点亮潮灯，让人们以灯的位置代替忘记的姓名。' }],
        choices: [{ choiceKey: 'harbor.core', text: '循着熄灭顺序追到钟楼', description: '用现场规律定位危机源头。', targetNodeKey: 'core' }],
      },
      {
        key: 'core', kind: 'choice', title: '姓名钟芯', summary: '钟机能够恢复潮声，但必须永久保存或释放全港姓名。',
        beats: [{ beatKey: 'core.1', kind: 'system', speakerCharacterExportId: null, text: '黄铜钟芯刻满刚刚消失的名字，下一次摆动即将开始。' }],
        choices: [
          { choiceKey: 'core.release', text: '释放全部姓名，让潮汐自行退去', description: '城市取回记忆，却失去可控潮汐。', targetNodeKey: 'ending-memory' },
          { choiceKey: 'core.bind', text: '把自己的姓名留在钟芯中', description: '保住城市与他人的记忆，代价是无人再记得你。', targetNodeKey: 'ending-sacrifice' },
        ],
      },
      {
        key: 'ending-memory', kind: 'ending', title: '每个人的名字', summary: '港民重新叫出彼此，雾港开始学习面对不可控的海。',
        beats: [{ beatKey: 'ending-memory.1', kind: 'narration', speakerCharacterExportId: null, text: '千万个名字从钟里飞回街巷，潮水则第一次不听任何人的命令。' }],
        choices: [],
      },
      {
        key: 'ending-sacrifice', kind: 'ending', title: '无人记得的守灯人', summary: '城市与潮汐恢复正常，玩家成为只存在于旧铜灯反光中的陌生人。',
        beats: [{ beatKey: 'ending-sacrifice.1', kind: 'narration', speakerCharacterExportId: null, text: '所有人都想起了自己的名字，却没有一个人能再叫出你的名字。' }],
        choices: [],
      },
    ],
  }
}

describe.sequential('R-WORLDGAME5 · 主 Agent 从冻结世界演化可玩文字游戏', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('注册为主 Agent 大纲领域 Skill，并拒绝断链、死路和循环候选', async () => {
    const source = await fixture()
    expect(selectAgentSkillIdV1('outline', '把这个世界生成一款分支互动叙事游戏')).toBe('outline.world-game')
    expect(getAgentSkillV1('outline.world-game')).toMatchObject({
      executionMode: 'world-game',
      contextSourceKeys: ['worldGameAuthoring'],
    })
    const broken = candidate(source)
    broken.nodes[0].choices[0].targetNodeKey = 'missing'
    expect(() => parseWorldGameNarrativeCandidateV1(JSON.stringify(broken), requestFor(source, 'storygame')))
      .toThrow('指向不存在节点')
  }, 30_000)

  it('模型只生成候选，作者确认后才写入；新剧情可发布并立即创建试玩实例', async () => {
    const source = await fixture()
    const request = requestFor(source, 'storygame')
    const runAI = vi.fn(async () => JSON.stringify(candidate(source)))
    const prepared = await prepareWorldGameCopilotV1({
      projectId: source.scope.projectId,
      scope: source.scope,
      authorRequest: request.creativeBrief,
    }, { runAI })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(prepared.contextSources).toEqual(['worldGameAuthoring'])
    expect(prepared.prepared.messages.map(message => message.content).join('\n')).toContain('不是要求逐字复刻')
    expect(await db.gameDefinitions.where('workId').equals(source.scope.workId).count()).toBe(0)

    const definition = await adoptRestoredWorldGameCandidateV1({
      scope: source.scope,
      snapshot: { request },
      draft: JSON.stringify(generated.output),
    })
    expect(definition).toMatchObject({ productType: 'storygame', title: '雾港：无名潮汐' })
    const nodes = await db.narrativeNodes.where('moduleId').equals(definition.narrativeModuleId).toArray()
    expect(nodes.map(node => node.title)).toContain('无名者上岸')
    expect(nodes.map(node => node.title)).not.toContain('失潮之夜')
    expect(await validateStoryGameContent(source.scope, definition.narrativeModuleId)).toMatchObject({ valid: true })

    const publication = await publishStoryGameDraft({
      scope: source.scope,
      gameDefinitionId: definition.id!,
      label: '评审演示 · AI 无名潮汐',
    })
    const session = await createStoryGameInstance({
      scope: source.scope,
      gameReleaseId: publication.gameRelease.id!,
      title: '现场试玩',
    })
    expect(session.gameReleaseId).toBe(publication.gameRelease.id)
  }, 30_000)

  it('主 Agent durable Run 能冻结候选、恢复采纳并通过正式业务终态核验', async () => {
    const source = await fixture()
    const output = candidate(source, '雾港：主 Agent 无名潮汐')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 200, completion_tokens: 500, total_tokens: 700 },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const conversation = await getOrCreateAgentConversation({
      projectId: source.scope.projectId,
      worldGroupId: null,
      scope: source.scope,
    })
    const durable = await runDurableMasterAgentPlanV1({
      scope: source.scope,
      worldGroupId: null,
      conversationId: conversation.id!,
      plan: {
        summary: '从冻结世界演化一个新的分支游戏。',
        tasks: [{
          id: 'world-game-1',
          agentId: 'outline',
          skillId: 'outline.world-game',
          instruction: '把这个冻结世界演化成新的分支互动叙事游戏，不要复刻原剧情。',
          dependsOn: [],
        }],
        workflow: {
          version: 1,
          workflowId: 'single-domain-direct',
          reasonCodes: ['single-explicit-domain'],
        },
      },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(durable.candidates).toHaveLength(1)
    expect(durable.candidates[0].payload).toMatchObject({
      skillId: 'outline.world-game',
      contextSources: ['worldGameAuthoring'],
      runId: durable.runId,
    })
    expect(await db.gameDefinitions.where('workId').equals(source.scope.workId).count()).toBe(0)

    await commitMasterAgentCandidateAdoptionV1({
      scope: source.scope,
      runId: durable.runId,
      candidateEventId: durable.candidates[0].event.id!,
      runtime: durable.candidates[0].runtime,
    })
    expect(await verifyMasterAgentRunV1({ scope: source.scope, runId: durable.runId }))
      .toMatchObject({ accepted: true })
    expect(await db.gameDefinitions.where('workId').equals(source.scope.workId)
      .filter(item => item.productType === 'storygame' && item.title === output.title).count()).toBe(1)
  }, 40_000)

  it.each(['text-adventure', 'avg'] as const)('同一 AI 剧情候选确定性生成可校验的 %s 产品', async productType => {
    const source = await fixture()
    const request = requestFor(source, productType)
    const definition = await adoptRestoredWorldGameCandidateV1({
      scope: source.scope,
      snapshot: { request },
      draft: JSON.stringify(candidate(source, productType === 'avg' ? '雾港：无名潮汐 AVG' : '雾港：无名潮汐冒险')),
    })
    expect(definition.productType).toBe(productType)
    expect(definition.sourceWorldContentHash).toBe(source.release.contentHash)
    expect(await validateStoryGameContent(source.scope, definition.narrativeModuleId)).toMatchObject({ valid: true })
    if (productType === 'text-adventure') {
      expect(await db.adventureModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(1)
    } else {
      expect(await db.avgPresentationModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(1)
    }
  }, 40_000)
})
