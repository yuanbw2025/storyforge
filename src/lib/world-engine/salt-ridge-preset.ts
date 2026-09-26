import { db } from '../db/schema'
import { adopt as governedAdopt } from '../registry/adopt'
import { createWorldRevision, publishWorldRevision } from './releases'
import { createWorkspace } from '../workspace/create-workspace'
import { readOwnedRows, stampNewRecord } from '../workspace/scope'
import { resolveWorkspaceScope } from '../workspace/ownership'
import type { CodexCategory } from '../types'

async function adopt(input: Parameters<typeof governedAdopt>[0]) {
  const result = await governedAdopt(input)
  if (result.typeErrors.length || result.unknown.length || result.fkErrors.length
    || result.skipped.length || !result.written.length) {
    throw new Error(`盐脊来源采纳失败：${input.target} ${JSON.stringify({
      unknown: result.unknown,
      typeErrors: result.typeErrors,
      fkErrors: result.fkErrors,
      skipped: result.skipped,
    })}`)
  }
  return result
}

/**
 * Canonical semantic source for the G7 vertical acceptance world.
 *
 * This helper deliberately writes only world-owned semantic material and then
 * freezes it through the public WorldRelease APIs. Enemies, skills, rewards,
 * recipes, executable quests, media and runtime state remain product-owned and
 * must be created by the text-open-world production pipeline.
 */
export async function createSaltRidgeWorldV1(name = '盐脊 · 断流之夜') {
  const workspaceUid = 'WS-5942cf5a-0dca-5ca2-b6de-e59863c8a9ef'
  const existing = await db.projects.filter(row => row.workspaceUid === workspaceUid).first()
  if (existing) {
    const scope = await resolveWorkspaceScope(existing.id!)
    const frozen = await db.worldReleases.where('worldId').equals(scope.worldId).first()
    if (frozen) return { scope, worldReleaseId: frozen.id! }
    const revision = await createWorldRevision({ scope, label: `${name} · 内置展示世界 v1` })
    const release = await publishWorldRevision(revision.id!)
    return { scope, worldReleaseId: release.id! }
  }
  const created = await createWorkspace({
    workspaceUid,
    name,
    genres: ['border-fantasy', 'investigation-adventure'],
    status: 'drafting',
    description: '盐脊首个纵向验收世界的纯语义来源。',
    targetWordCount: 30_000,
    enableMultiWorld: false,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()

  await db.worldviews.add(stampNewRecord(created.scope, 'worldviews', {
    projectId: created.scope.projectId,
    summary: '退潮后裸露的白色高地由地下潮脉、潮井与旧引潮机维系，两地正因水源衰竭走向冲突。',
    worldOrigin: '古老潮汐在盐层下刻出潮脉，先民以潮井和引潮机把周期水流导向聚落。',
    politicsOverview: '盐脊港由盐灯商会主导贸易，沉钟盆地由拾潮民议会维持共同事务。',
    cultureOverview: '居民以测潮刻度、盐灯和井钟记录季节，也把共享水源视为不可轻弃的公共承诺。',
    economyOverview: '盐业、商路、修井与拾潮维持两地生计，水源分配直接改变价格和迁徙。',
    races: '盐脊居民、拾潮民与往来商旅',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'world' }))
  await adopt({
    projectId: created.scope.projectId,
    scope: created.scope,
    target: 'geographies',
    mode: 'replace',
    data: {
    overview: '盐脊港与沉钟盆地隔着风蚀仓道、北潮门和旧盐路相连，共有十个命名地点。',
    locations: [
      { region: '盐脊港', places: ['白盐码头', '测潮所', '盐灯集市', '风蚀仓道', '北潮门'] },
      { region: '沉钟盆地', places: ['沉钟村', '拾潮营地', '枯井群', '旧引潮机', '南井台'] },
    ],
    worldMapData: '',
  } })
  await adopt({
    projectId: created.scope.projectId,
    scope: created.scope,
    target: 'histories',
    mode: 'replace',
    data: {
    overview: '旧引潮机曾以抽干盆地支井为代价保障港口，真相被商路繁荣掩盖；如今人为操控让旧伤重新显现。',
    eraSystem: '以潮脉重启前后纪年',
    events: [
      { title: '中央引潮机启用', consequence: '港口繁荣，盆地支井衰弱。' },
      { title: '测潮师失踪', consequence: '潮脉衰竭的关键证据被分散在两地。' },
    ],
  } })
  await adopt({
    projectId: created.scope.projectId,
    scope: created.scope,
    target: 'worldRulesProfiles',
    mode: 'replace',
    data: {
    entries: {
      tideVein: '潮脉在昼夜间推动含盐水穿过古老潮井。',
      wells: '潮井、支井和中央引潮机彼此影响，集中抽水会转移而不是消除代价。',
      governance: '可持续供水必须同时保住盐脊港与沉钟盆地的生存条件。',
    },
    customNodes: [],
    globalNote: '潮脉是可调查、可维修但不能凭空创造水源的物理规则。',
  } })

  const storyCoreId = await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
    projectId: created.scope.projectId,
    theme: '共同生存、历史责任与可持续治理',
    centralConflict: '盐脊港想集中修复引潮机保住贸易，沉钟盆地担心旧方案再次抽干支井。',
    plotPattern: '来信—调查—两地见证—揭露操控—决战—治理抉择',
    logline: '一名受失踪测潮师来信吸引的旅人，必须查明潮脉衰竭并为两地找到不以牺牲一方为代价的供水方案。',
    concept: '在完整开放地图中逐步展开的边境奇幻调查冒险。',
    mainPlot: '追查潮脉衰竭、揭露盐枭白口对潮门的操控，并在共潮议约与分井新路之间完成治理选择。',
    subPlots: '守井人苒秋面对家族真相；盐灯商会与拾潮民议会争夺盐路规则。',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number

  const characterSpecs = [
    ['旅人澜砂', 'main', '受迟砾来信指引抵达盐脊的调查者', '能在两地之间行动、战斗并承担治理选择。', '来自盐脊之外，尚未被任何一方的旧立场绑住。', '谨慎、好奇且愿意承担后果'],
    ['测潮师迟砾', 'main', '失踪测潮师与核心证据来源', '留下潮脉异常的测量记录与求助来信。', '发现人为操控后被迫藏匿。', '严谨、克制且不愿牺牲任何一地'],
    ['守井人苒秋', 'secondary', '沉钟盆地的年轻守井人', '守护正在盐化的支井，也是个人故事线的中心。', '家族曾参与旧引潮机的维护与隐瞒。', '坚韧、直率又害怕真相伤害共同体'],
    ['商会执秤人陆衡', 'secondary', '盐灯商会的秤务负责人', '代表港口贸易秩序和集中维修立场。', '掌握价格、仓储和部分旧账册。', '务实、守序且习惯以成本衡量决定'],
    ['拾潮议长苏弦', 'secondary', '拾潮民议会的协调者', '代表盆地居民争取水源与盐路话语权。', '保存被港口档案忽略的口述历史。', '沉着、强硬但愿意接受可验证的公平方案'],
    ['旧机匠乌迟', 'secondary', '仍能维修引潮设施的老工匠', '提供分流配方、维修知识和主线关键解释。', '年轻时参与过集中抽水方案。', '寡言、负疚且尊重实际证据'],
    ['盐枭白口', 'main', '操控潮门牟利的盐枭首领', '通过制造短缺和道路恐慌扩大黑市控制。', '利用了旧设施和两地长期不信任。', '冷酷、算计且善于把灾难伪装成天意'],
  ] as const
  const characterIds = await db.characters.bulkAdd(characterSpecs.map(([
    characterName, roleWeight, identity, shortDescription, background, personality,
  ], index) => stampNewRecord(created.scope, 'characters', {
    projectId: created.scope.projectId,
    name: characterName,
    roleWeight,
    moralAxis: characterName === '盐枭白口' ? 'evil' : 'neutral',
    orderAxis: characterName === '盐枭白口' ? 'chaotic' : 'neutral',
    identity,
    shortDescription,
    background,
    personality,
    createdAt: now + index,
    updatedAt: now + index,
  } as never, { owner: 'world' })), { allKeys: true }) as number[]

  await db.characterRelations.bulkAdd([
    ['测潮师迟砾', '旧机匠乌迟', 'ally', '证据同盟', '共同追查旧引潮机异常，但迟砾失踪后联系中断。'],
    ['守井人苒秋', '拾潮议长苏弦', 'ally', '守井责任', '苏弦保护苒秋，也要求她面对家族留下的旧账。'],
    ['商会执秤人陆衡', '拾潮议长苏弦', 'rival', '盐路争议', '双方在贸易与水源分配上对立，但仍保留谈判渠道。'],
  ].map(([from, to, relationType, label, description], index) => stampNewRecord(created.scope, 'characterRelations', {
    projectId: created.scope.projectId,
    fromCharacterId: characterIds[characterSpecs.findIndex(row => row[0] === from)]!,
    toCharacterId: characterIds[characterSpecs.findIndex(row => row[0] === to)]!,
    relationType,
    label,
    description,
    isBidirectional: true,
    createdAt: now + index,
    updatedAt: now + index,
  } as never, { owner: 'world' })))

  const locationSpecs = [
    ['白盐码头', 'harbor', '盐脊港的抵达点，商旅、普通商店和传闻在此汇集。'],
    ['测潮所', 'archive', '保存水尺、测潮档案和迟砾工作痕迹的主线调查地点。'],
    ['盐灯集市', 'market', '可交易、制作，也会发生偷窃与欺骗反馈的港口集市。'],
    ['风蚀仓道', 'road', '连接仓库与北潮门的危险道路，盐蜥和可采材料出没。'],
    ['北潮门', 'gate', '盐脊港地区出口及到访后可解锁的快速旅行点。'],
    ['沉钟村', 'village', '盆地服务中心，居民围绕盐化水井维持日常生活。'],
    ['拾潮营地', 'camp', '拾潮民议会活动与势力故事展开的公共营地。'],
    ['枯井群', 'ruins', '散布旧井、环境线索、材料和随机事件的调查区。'],
    ['旧引潮机', 'machine-ruin', '主线中后段的核心设施与关键战斗地点。'],
    ['南井台', 'well-platform', '第二快速旅行点和两个治理结局的现场。'],
  ] as const
  await db.importantLocations.bulkAdd(locationSpecs.map(([locationName, type, description], index) => (
    stampNewRecord(created.scope, 'importantLocations', {
      projectId: created.scope.projectId,
      parentId: null,
      name: locationName,
      type,
      description,
      createdAt: now + index,
      updatedAt: now + index,
    } as never, { owner: 'world' })
  )))

  await adopt({
    projectId: created.scope.projectId,
    scope: created.scope,
    target: 'codexCategories',
    mode: 'add',
    data: {
      domain: 'humanity', parentId: null, name: '盐脊地方知识', builtInKey: 'humEvent',
      fieldSchema: [], hidden: false, order: 0,
    },
  })
  const category = (await readOwnedRows<CodexCategory>(created.scope, 'codexCategories'))
    .find(row => row.builtInKey === 'humEvent')
  if (!category?.id) throw new Error('盐脊地方知识分类采纳失败')
  const categoryId = category.id
  const codexSpecs = [
    ['潮脉与潮井', '潮脉在昼夜间推水，中央机与支井共享同一地下水路。', ['世界规则']],
    ['旧引潮机', '集中抽水能短期恢复港口供水，也可能再次压低盆地支井。', ['设施', '主线']],
    ['盐灯商会', '掌握港口仓储、秤务和大部分盐路贸易。', ['势力']],
    ['拾潮民议会', '由盆地居民共同议事，维护支井、旧盐路和地方记忆。', ['势力']],
    ['迟砾的测潮尺', '记录异常潮位与人为开闭潮门痕迹的关键证物。', ['关键道具']],
    ['分流阀芯图', '乌迟保存的支井分流配方基础，不能直接作为成品使用。', ['关键道具', '配方素材']],
    ['井钟礼', '盆地居民在换班时敲钟通报水位，来客回礼表示尊重共享水源。', ['地方习俗']],
  ] as const
  await db.codexEntries.bulkAdd(codexSpecs.map(([entryName, summary, tags], index) => (
    stampNewRecord(created.scope, 'codexEntries', {
      projectId: created.scope.projectId,
      categoryId,
      name: entryName,
      summary,
      description: summary,
      fields: '{}',
      refs: '{}',
      tags: JSON.stringify(tags),
      importance: (tags as readonly string[]).includes('关键道具') ? 5 : 3,
      order: index,
      worldGroupId: null,
      createdAt: now + index,
      updatedAt: now + index,
    } as never, { owner: 'world' })
  )))

  await db.storyArcs.bulkAdd([
    {
      name: '潮脉衰竭调查',
      type: 'main',
      description: '从迟砾来信开始，调查两地水源、揭露白口操控并完成可持续供水选择。',
      stages: ['来信与低潮', '空白水尺', '两地的水', '旧机之下', '谁动了潮门', '引潮机决战', '新的潮线'],
    },
    {
      name: '不再守空井',
      type: 'character',
      description: '苒秋面对家族证物、守井责任和说出真相的代价。',
      stages: ['井边旧物', '家族证词', '守井人的新职责'],
    },
    {
      name: '盐路归谁',
      type: 'side',
      description: '盐灯商会与拾潮民议会围绕账册、旧盐路和共同治理发生群体冲突。',
      stages: ['价格与封路', '公开旧账', '盐路新规'],
    },
  ].map((arc, index) => stampNewRecord(created.scope, 'storyArcs', {
    projectId: created.scope.projectId,
    name: arc.name,
    type: arc.type,
    stages: JSON.stringify(arc.stages.map((title, stageIndex) => ({
      id: `${index + 1}.${stageIndex + 1}`,
      title,
      description: `${title}阶段。`,
      keyEvents: [title],
    }))),
    description: arc.description,
    origin: 'manual',
    status: 'active',
    sourceStoryCoreId: storyCoreId,
    createdAt: now + index,
    updatedAt: now + index,
  } as never, { owner: 'work' })))

  const revision = await createWorldRevision({
    scope: created.scope,
    label: `${name} · G7语义冻结`,
  })
  const release = await publishWorldRevision(revision.id!)
  return { ...created, revision, release, characterIds, worldReleaseId: release.id! }
}

/** Historical name retained for production-pipeline regression suites. */
export const seedSaltRidgeWorldV1 = createSaltRidgeWorldV1
