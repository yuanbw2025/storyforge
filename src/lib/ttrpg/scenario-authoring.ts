import type { RulePackV1, TtrpgCampaignContentV1, TtrpgCharacterTemplateV1, TtrpgProductionBriefV2 } from '../types'
import { createCompleteTtrpgCharacterSheetV2 } from './character-sheet'
import { evaluateRuleNumberExpressionV1 } from './rule-pack'
import { assertTtrpgNoRestrictedTextV1 } from './information-boundary'

export interface TtrpgAuthoredScenarioV1 {
  schema: 'storyforge.ttrpg-authored-scenario'
  version: 1
  characters: Array<{ key: string; seatKey: string | null; name: string; description: string; appearance: string;
    background: string; goal: string; secret: string; portrayal: string; leverage: string;
    strengthAttributeKey: string; weaknessAttributeKey: string }>
  scenes: Array<{ nodeKey: string; description: string; gmTruth: string; failureForward: string; participantKeys: string[] }>
  clues: Array<{ key: string; title: string; description: string; conclusionKey: string; required: boolean;
    visibility: 'public' | 'discoverable'; paths: Array<{ nodeKey: string; actionKey: string; failForward: string }> }>
  quests: Array<{ key: string; title: string; objective: string; requiredConclusionKeys: string[] }>
  endings: Array<{ nodeKey: string; title: string; epilogue: string; requiredConclusionKeys: string[]; forbiddenConclusionKeys: string[] }>
}
function fail(message: string): never { throw new Error(`[ttrpg-scenario] ${message}`) }
function object(value: unknown, fields: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须为对象`)
  const row = value as Record<string, unknown>
  const missing = fields.filter(key => !Object.prototype.hasOwnProperty.call(row, key))
  const unknown = Object.keys(row).filter(key => !fields.includes(key))
  if (missing.length || unknown.length) fail(`${label} 字段不精确 missing=${missing.join(',')} unknown=${unknown.join(',')}`)
  return row
}
function text(value: unknown, label: string, maximum = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) fail(`${label} 文本无效`)
  return value.trim().normalize('NFC')
}
function key(value: unknown) { const result = text(value, 'key', 200); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) fail('key 必须是 ASCII 标识：字母、数字、点、下划线、冒号或连字符；中文姓名只放 name'); return result }
function list(value: unknown, maximum: number, minimum = 1): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail('内容数量不符合边界')
  return value
}
function keys(value: unknown, minimum = 0) { const rows = list(value, 80, minimum).map(key); if (new Set(rows).size !== rows.length) fail('引用重复'); return rows }
export function parseTtrpgAuthoredScenarioV1(value: unknown): TtrpgAuthoredScenarioV1 {
  const row = object(value, ['schema', 'version', 'characters', 'scenes', 'clues', 'quests', 'endings'], 'scenario')
  if (row.schema !== 'storyforge.ttrpg-authored-scenario' || row.version !== 1) fail('schema 不支持')
  const characters = list(row.characters, 20, 2).map(value => {
    const actor = object(value, ['key', 'seatKey', 'name', 'description', 'appearance', 'background', 'goal', 'secret', 'portrayal', 'leverage', 'strengthAttributeKey', 'weaknessAttributeKey'], 'character')
    return { key: key(actor.key), seatKey: actor.seatKey == null ? null : key(actor.seatKey), name: text(actor.name, 'name', 100),
      description: text(actor.description, 'description', 1200), appearance: text(actor.appearance, 'appearance', 800), background: text(actor.background, 'background'),
      goal: text(actor.goal, 'goal', 1000), secret: text(actor.secret, 'secret', 1200), portrayal: text(actor.portrayal, 'portrayal', 800), leverage: text(actor.leverage, 'leverage', 1000),
      strengthAttributeKey: key(actor.strengthAttributeKey), weaknessAttributeKey: key(actor.weaknessAttributeKey) }
  })
  if (new Set(characters.map(actor => actor.key)).size !== characters.length || !characters.some(actor => actor.seatKey == null)) fail('角色身份重复或缺少 NPC')
  const scenes = list(row.scenes, 80, 3).map(value => {
    const scene = object(value, ['nodeKey', 'description', 'gmTruth', 'failureForward', 'participantKeys'], 'scene')
    return { nodeKey: key(scene.nodeKey), description: text(scene.description, '场景可见描述', 4000), gmTruth: text(scene.gmTruth, '场景真相'),
      failureForward: text(scene.failureForward, '失败推进', 1200), participantKeys: keys(scene.participantKeys, 1) }
  })
  const clues = list(row.clues, 80, 3).map(value => {
    const clue = object(value, ['key', 'title', 'description', 'conclusionKey', 'required', 'visibility', 'paths'], 'clue')
    if (typeof clue.required !== 'boolean' || !['public', 'discoverable'].includes(String(clue.visibility))) fail('线索可见性或必要性无效')
    return { key: key(clue.key), title: text(clue.title, '线索标题', 200), description: text(clue.description, '线索内容'), conclusionKey: key(clue.conclusionKey),
      required: clue.required, visibility: clue.visibility as 'public' | 'discoverable', paths: list(clue.paths, 12, clue.required ? 2 : 1).map(value => {
        const path = object(value, ['nodeKey', 'actionKey', 'failForward'], 'path')
        return { nodeKey: key(path.nodeKey), actionKey: key(path.actionKey), failForward: text(path.failForward, '线索失败推进', 1000) }
      }) }
  })
  const quests = list(row.quests, 12).map(value => {
    const quest = object(value, ['key', 'title', 'objective', 'requiredConclusionKeys'], 'quest')
    return { key: key(quest.key), title: text(quest.title, '任务名', 200), objective: text(quest.objective, '任务目标', 1200), requiredConclusionKeys: keys(quest.requiredConclusionKeys, 1) }
  })
  const endings = list(row.endings, 8).map(value => {
    const ending = object(value, ['nodeKey', 'title', 'epilogue', 'requiredConclusionKeys', 'forbiddenConclusionKeys'], 'ending')
    return { nodeKey: key(ending.nodeKey), title: text(ending.title, '结局名', 200), epilogue: text(ending.epilogue, '尾声', 5000),
      requiredConclusionKeys: keys(ending.requiredConclusionKeys), forbiddenConclusionKeys: keys(ending.forbiddenConclusionKeys) }
  })
  for (const ids of [scenes.map(scene => scene.nodeKey), clues.map(clue => clue.key), quests.map(quest => quest.key), endings.map(ending => ending.nodeKey)])
    if (new Set(ids).size !== ids.length) fail('场景、线索、任务或结局重复')
  for (const clue of clues) if (new Set(clue.paths.map(path => `${path.nodeKey}:${path.actionKey}`)).size !== clue.paths.length)
    fail('同一场景和行动重复列出，不能算作两条线索发现路径')
  if (!endings.some(ending => ending.requiredConclusionKeys.length === 0 && ending.forbiddenConclusionKeys.length === 0))
    fail('至少需要一个不依赖线索的退场结局，避免调查失败后无路可走')
  const secrets = [...characters.map(actor => actor.secret), ...scenes.map(scene => scene.gmTruth),
    ...clues.filter(clue => clue.visibility === 'discoverable').map(clue => clue.description)]
  const playerSecrets = characters.filter(actor => actor.seatKey != null).map(actor => actor.secret)
  const checkPublic = (value: string, label: string, authorized: string[] = []) => {
    try {
      assertTtrpgNoRestrictedTextV1(value, playerSecrets)
      assertTtrpgNoRestrictedTextV1(value, secrets, authorized)
    } catch (error) { fail(`${label}: ${error instanceof Error ? error.message : '私密信息校验失败'}`) }
  }
  for (const actor of characters) checkPublic(actor.description, `character:${actor.key}.description`)
  for (const clue of clues) assertTtrpgNoRestrictedTextV1(clue.description, playerSecrets)
  for (const scene of scenes) {
    const ending = endings.find(item => item.nodeKey === scene.nodeKey)
    // A gated ending may repeat evidence it requires, but never a player's private history.
    const authorized = ending ? clues.filter(clue => ending.requiredConclusionKeys.includes(clue.conclusionKey))
      .map(clue => clue.description) : []
    checkPublic(scene.description, `scene:${scene.nodeKey}.description`, authorized)
    if (ending) checkPublic(ending.epilogue, `ending:${ending.nodeKey}.epilogue`, authorized)
  }
  return { schema: 'storyforge.ttrpg-authored-scenario', version: 1, characters, scenes, clues, quests, endings }
}

/** Replace compiler scaffolding with reviewed model-authored content; mechanics stay deterministic. */
export function applyTtrpgAuthoredScenarioV1(base: TtrpgCampaignContentV1, value: TtrpgAuthoredScenarioV1, rulePack: RulePackV1, brief: TtrpgProductionBriefV2): TtrpgCampaignContentV1 {
  const scenario = parseTtrpgAuthoredScenarioV1(value), campaign = structuredClone(base)
  const selectedSeats = brief.table.seats.map(seat => seat.seatKey).sort()
  const authoredSeats = scenario.characters.flatMap(actor => actor.seatKey == null ? [] : [actor.seatKey]).sort()
  if (JSON.stringify(selectedSeats) !== JSON.stringify(authoredSeats)) fail('AI 角色卡没有逐一覆盖冻结玩家席位')
  if (scenario.scenes.length !== base.scenes.length || scenario.scenes.some(scene => !base.scenes.some(item => item.sceneKey === scene.nodeKey))) fail('场景没有覆盖已验收的叙事图')
  const npcBase = base.characterTemplates.find(actor => actor.role === 'npc') ?? fail('基础 NPC 规则映射缺失')
  const refs = base.bible.sourceRefs
  const alias = new Map<string, string>()
  const characters = scenario.characters.map((actor, index): TtrpgCharacterTemplateV1 => {
    const original = actor.seatKey == null ? npcBase : base.characterTemplates.find(item => item.seatKey === actor.seatKey) ?? fail('玩家席位缺失')
    const characterKey = actor.seatKey == null ? `npc.authored.${index + 1}` : original.characterKey
    alias.set(actor.key, characterKey)
    const frozenName = actor.seatKey == null ? '' : brief.table.seats.find(seat => seat.seatKey === actor.seatKey)?.characterName
    if (frozenName && frozenName !== actor.name) fail(`模型改写了已确认角色姓名:${frozenName}`)
    const strength = rulePack.attributes.find(item => item.key === actor.strengthAttributeKey)
    const weakness = rulePack.attributes.find(item => item.key === actor.weaknessAttributeKey)
    if (!strength || !weakness || strength.key === weakness.key) fail('角色强弱项必须使用不同的冻结属性')
    const attributes = { ...original.attributes }
    // Preserve the base point total, including at attribute caps. No model-supplied numeric fields.
    const shift = Math.min(1, strength.maximum - attributes[strength.key], attributes[weakness.key] - weakness.minimum)
    attributes[strength.key] += shift; attributes[weakness.key] -= shift
    const sourceRefs = actor.seatKey == null ? [...refs] : [...original.sourceRefs]
    const template: Omit<TtrpgCharacterTemplateV1, 'characterSheet'> = { ...original, characterKey, name: actor.name, description: actor.description,
      attributes, sourceRefs, portraitAssetKey: null,
      attributeMappings: Object.fromEntries(rulePack.attributes.map(attribute => [attribute.key, { value: attributes[attribute.key],
        derivationRule: `依据角色已确认的强项 ${strength.name} 与弱项 ${weakness.name}，在冻结 RulePack 边界内等额调整。`, sourceRefs, authorConfirmed: brief.confirmations.numericMappings }])),
      resources: Object.fromEntries(rulePack.resources.map(resource => [resource.key, resource.initialMode === 'maximum' ? evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes) : resource.minimum])),
      playerProfile: actor.seatKey == null ? null : { privateGoal: actor.goal, secret: actor.secret, portrayal: actor.portrayal },
      gmProfile: actor.seatKey == null ? { objective: actor.goal, secret: actor.secret, portrayal: actor.portrayal, leverage: actor.leverage,
        escalation: '只依据已知事实采取行动；不改骰、不夺走真人玩家选择、不越过冻结揭示路径。' } : null,
    }
    return { ...template, characterSheet: createCompleteTtrpgCharacterSheetV2({ template, rulePack, authoringMode: 'ai',
      identity: { name: actor.name, appearance: actor.appearance, background: actor.background, shortTermGoal: actor.goal, desires: [actor.goal] },
      progression: original.characterSheet!.rules.progression }) }
  })
  const sceneKeys = new Set(base.scenes.map(scene => scene.sceneKey)), actionKeys = new Set(rulePack.actions.map(action => action.key))
  campaign.characterTemplates = characters
  campaign.clues = scenario.clues.map(clue => ({ clueKey: clue.key, title: clue.title, description: clue.description, conclusionKey: clue.conclusionKey,
    required: clue.required, visibility: clue.visibility, sourceRefs: [...refs], discoveryPaths: clue.paths.map((path, index) => {
      if (!sceneKeys.has(path.nodeKey) || !actionKeys.has(path.actionKey)) fail('发现路径引用了未冻结的场景或行动')
      return { pathKey: `${clue.key}.path.${index + 1}`, sceneKey: path.nodeKey, actionKey: path.actionKey, failForward: path.failForward }
    }) }))
  campaign.scenes = base.scenes.map(scene => {
    const authored = scenario.scenes.find(item => item.nodeKey === scene.sceneKey)!
    const participantKeys = authored.participantKeys.map(key => alias.get(key) ?? fail(`场景角色引用不存在:${key}`))
    if (characters.some(actor => actor.role === 'player' && !participantKeys.includes(actor.characterKey)))
      fail('当前共同场景主持要求所有已选择玩家在场，不能生成无人接手的分队场景')
    return { ...scene, description: authored.description, gmSecret: authored.gmTruth, failureForward: authored.failureForward, participantKeys,
      clueKeys: campaign.clues.filter(clue => clue.discoveryPaths.some(path => path.sceneKey === scene.sceneKey)).map(clue => clue.clueKey) }
  })
  campaign.quests = scenario.quests.map(quest => ({ questKey: quest.key, title: quest.title, objective: quest.objective,
    requiredConclusionKeys: quest.requiredConclusionKeys, failureForward: '失败保留证据，通过冻结的其他发现路径继续调查。' }))
  campaign.endings = scenario.endings.map((ending, index) => ({ endingKey: `ending.authored.${index + 1}`, title: ending.title,
    requirements: [`玩家到达 ${ending.nodeKey} 并满足证据条件`], epilogue: ending.epilogue,
    trigger: { sceneKey: ending.nodeKey, requiredConclusionKeys: ending.requiredConclusionKeys, forbiddenConclusionKeys: ending.forbiddenConclusionKeys } }))
  const terminals = base.scenes.filter(scene => scene.nextSceneKeys.length === 0).map(scene => scene.sceneKey).sort()
  if (JSON.stringify(terminals) !== JSON.stringify(scenario.endings.map(ending => ending.nodeKey).sort())) fail('每个叙事终点必须有且只有一个可结算结局')
  campaign.handouts = campaign.clues.map(clue => ({ handoutKey: `handout.${clue.clueKey}`, title: clue.title, body: clue.description,
    fallbackText: clue.description, revealClueKey: clue.clueKey, assetKey: null }))
  campaign.advancementMilestones = campaign.quests.map((quest, index) => ({ milestoneKey: `milestone.${index + 1}`, title: `完成：${quest.title}`, award: rulePack.advancement.awardPerMilestone }))
  // Secrets are tied to actual model-authored evidence, never an unrelated generic clue.
  campaign.secrets = campaign.secrets.map((secret, index) => ({ ...secret,
    holderKeys: characters.filter(actor => actor.role === 'npc').map(actor => actor.characterKey),
    relatedClueKeys: campaign.clues.slice(index, index + 1).map(clue => clue.clueKey) }))
  campaign.fronts = campaign.fronts.map(front => ({ ...front, participantKeys: characters.filter(actor => actor.role === 'npc').map(actor => actor.characterKey) }))
  const characterKeys = new Set(characters.map(actor => actor.characterKey))
  if (campaign.tabletop) {
    for (const map of campaign.tabletop.maps) map.tokens = map.tokens.filter(token => characterKeys.has(token.entityKey))
  }
  if (campaign.visualBible) campaign.visualBible.characters = characters.map(actor => ({
    characterKey: actor.characterKey, identityPrompt: `${actor.name}。${actor.characterSheet!.identity.appearance}`,
    silhouette: actor.characterSheet!.identity.appearance, attire: actor.characterSheet!.identity.occupation || '符合角色身份的服装',
    markers: [], colorPalette: ['#23313b', '#d8bc83', '#8ca3ac'], expressionBaselines: [{ expressionKey: 'neutral', prompt: '自然专注' }], referenceAssetKeys: [],
  }))
  if (campaign.mediaManifest) {
    const originalSlots = base.mediaManifest!.slots
    const changedKinds = new Set(['character-portrait', 'character-expression', 'token', 'handout'])
    const slots = originalSlots.filter(slot => !changedKinds.has(slot.kind)).map(slot => {
      const scene = campaign.scenes.find(scene => slot.kind === 'scene' && scene.sceneKey === slot.targetRef)
      return scene ? { ...slot, assetKey: null, fallbackText: scene.description, promptTemplate: `场景：${scene.title}。${scene.description}` } : slot
    })
    for (const actor of characters) {
      for (const kind of ['character-portrait', 'character-expression', 'token'] as const) {
        const template = originalSlots.find(slot => slot.kind === kind)
        if (!template) continue
        const appearance = actor.characterSheet!.identity.appearance
        slots.push({ ...template, slotKey: `${kind}.${actor.characterKey}`, targetRef: actor.characterKey, assetKey: null,
          fallbackText: kind === 'token' ? actor.name : appearance, altText: `${actor.name}：${appearance}`,
          promptTemplate: `${actor.name}。${appearance}。${kind === 'token' ? '透明背景的桌面角色标记' : '自然专注的角色肖像'}` })
      }
    }
    const handoutTemplate = originalSlots.find(slot => slot.kind === 'handout')
    if (handoutTemplate) for (const handout of campaign.handouts) slots.push({ ...handoutTemplate,
      slotKey: `handout.${handout.handoutKey}`, targetRef: handout.handoutKey, assetKey: null,
      fallbackText: handout.fallbackText, altText: handout.title, promptTemplate: `调查手记：${handout.title}。${handout.body}` })
    campaign.mediaManifest.slots = slots
  }
  campaign.tags = [...new Set([...campaign.tags, 'model-authored-scenario-v1'])]
  return campaign
}
