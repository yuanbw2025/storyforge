import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type {
  AdventureContentV2,
  ProductProductionWorldSourceCatalogV2,
  ProductRuntimePackageV1,
  WorldRelease,
} from '../../src/lib/types'
import { createCurrentRuntimePackageFixture } from './current-runtime-package'

export function createTextAdventureFoundationNarrativeV2(): ProductRuntimePackageV1['narrative'] {
  return {
    moduleKind: 'main',
    moduleTitle: '雾潮灯塔',
    entryNodeKey: 'opening',
    nodes: [
      {
        key: 'opening', kind: 'entry', title: '封港之夜',
        summary: '在港区整备并穿过盐沼，找回灯塔透镜。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: ['crossroads'],
      },
      {
        key: 'crossroads', kind: 'choice', title: '灯塔核心',
        summary: '选择把灯火引向求救船，或封闭裂隙保住港城。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending.rescue', 'ending.seal'],
      },
      {
        key: 'ending.rescue', kind: 'ending', title: '海上归灯',
        summary: '求救船循灯归港，裂隙留下了后续代价。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      },
      {
        key: 'ending.seal', kind: 'ending', title: '长夜守门',
        summary: '裂隙被封住，失去引导的船队只能等待天明。',
        conditionJson: '{}', effectsJson: '[]', successorKeys: [],
      },
    ],
    beats: [
      { beatKey: 'beat.opening.1', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '雾潮已经漫过外港石阶，废弃灯塔仍在远处一明一灭。', order: 0 },
      { beatKey: 'beat.opening.2', nodeKey: 'opening', kind: 'system', speakerKey: null, text: '你需要穿过盐沼、找回透镜，并在封港钟响前作出决定。', order: 1 },
      { beatKey: 'beat.crossroads.1', nodeKey: 'crossroads', kind: 'narration', speakerKey: null, text: '新透镜嵌入灯芯。两条互相冲突的光路同时亮起。', order: 0 },
      { beatKey: 'beat.rescue.1', nodeKey: 'ending.rescue', kind: 'narration', speakerKey: null, text: '你把光束推向海面。第一声归航汽笛穿透浓雾。', order: 0 },
      { beatKey: 'beat.seal.1', nodeKey: 'ending.seal', kind: 'narration', speakerKey: null, text: '你扳下封闭闸。裂隙在长鸣中合拢，港城的灯一盏盏重新亮起。', order: 0 },
    ],
    choices: [
      {
        choiceKey: 'choice.enter-core', sourceNodeKey: 'opening', text: '带着透镜进入灯塔核心',
        description: '完成主线任务后进入最终抉择。', unavailableReason: '还没有找回透镜。',
        targetNodeKey: 'crossroads', displayConditionJson: '{}',
        availableConditionJson: JSON.stringify({ path: 'adventure.quests.quest_beacon.status', eq: 'completed' }),
        effectsJson: '[]', tags: ['adventure-action:action.move.core'], order: 0,
      },
      {
        choiceKey: 'choice.rescue', sourceNodeKey: 'crossroads', text: '把灯火引向求救船',
        description: '救回海上的人，但让裂隙继续存在。', unavailableReason: '尚未校准归航光路。',
        targetNodeKey: 'ending.rescue', displayConditionJson: '{}',
        availableConditionJson: JSON.stringify({ path: 'adventure.conditions.condition_route_rescue', exists: true }),
        effectsJson: '[]', tags: [], order: 0,
      },
      {
        choiceKey: 'choice.seal', sourceNodeKey: 'crossroads', text: '封闭裂隙保护港城',
        description: '保住港城，但海上的船要独自熬过长夜。', unavailableReason: '尚未校准封闭光路。',
        targetNodeKey: 'ending.seal', displayConditionJson: '{}',
        availableConditionJson: JSON.stringify({ path: 'adventure.conditions.condition_route_seal', exists: true }),
        effectsJson: '[]', tags: [], order: 1,
      },
    ],
  }
}

export function createTextAdventureFoundationContentV2(): AdventureContentV2 {
  return {
    schema: 'storyforge.text-adventure.content',
    version: 2,
    recipeKey: 'recipe.generic-state-adventure.v1',
    playerKey: 'player',
    playerIdentity: { name: '守灯学徒', description: '第一次独自处理雾潮危机的港区守灯人。' },
    capabilities: [
      'space', 'character', 'inventory', 'equipment', 'quests', 'time', 'storylets', 'endings',
    ].map(key => ({ key, version: 1, enabled: true, required: true })),
    regions: [
      { key: 'region.harbor', title: '雾港', description: '受雾潮与封港钟共同支配的海港大区。', areaKeys: ['area.inner-harbor'], tags: ['settlement'] },
      { key: 'region.beacon', title: '外海灯塔带', description: '盐沼、旧塔与海上裂隙组成的危险大区。', areaKeys: ['area.salt-marsh', 'area.old-beacon'], tags: ['frontier'] },
    ],
    areas: [
      { key: 'area.inner-harbor', regionKey: 'region.harbor', title: '内港区', description: '冒险的补给与出发区域。', locationKeys: ['location.harbor'], tags: ['safe'] },
      { key: 'area.salt-marsh', regionKey: 'region.beacon', title: '盐沼区', description: '潮沟会吞没错误的脚印。', locationKeys: ['location.marsh'], tags: ['hazard'] },
      { key: 'area.old-beacon', regionKey: 'region.beacon', title: '旧灯塔区', description: '主线目标和最终抉择所在区域。', locationKeys: ['location.tower', 'location.core'], tags: ['objective'] },
    ],
    initialLocationKey: 'location.harbor',
    locations: [
      { key: 'location.harbor', areaKey: 'area.inner-harbor', title: '封港仓房', description: '油灯、旧披风和潮汐图挤在狭窄的整备间里。', sceneKeys: ['scene.harbor'], tags: ['start'] },
      { key: 'location.marsh', areaKey: 'area.salt-marsh', title: '回声盐沼', description: '每一次落脚都会引来迟半拍的回声。', sceneKeys: ['scene.marsh'], tags: ['hazard'] },
      { key: 'location.tower', areaKey: 'area.old-beacon', title: '灯塔底层', description: '破裂的透镜躺在生锈齿轮之间。', sceneKeys: ['scene.tower'], tags: ['quest'] },
      { key: 'location.core', areaKey: 'area.old-beacon', title: '灯塔核心', description: '两套光路只能选择一套完成校准。', sceneKeys: ['scene.core'], tags: ['finale'] },
    ],
    scenes: [
      { key: 'scene.harbor', locationKey: 'location.harbor', title: '出发整备', description: '装备与补给教学场景。', actionKeys: ['action.look.harbor', 'action.equip.cloak', 'action.move.marsh', 'action.search.cache'], tags: ['onboarding'] },
      { key: 'scene.marsh', locationKey: 'location.marsh', title: '穿越盐沼', description: '确定性失败推进与代价场景。', actionKeys: ['action.find.route', 'action.move.tower'], tags: ['fail-forward'] },
      { key: 'scene.tower', locationKey: 'location.tower', title: '回收透镜', description: '物品、任务与成长结算场景。', actionKeys: ['action.take.lens', 'action.rest.tower', 'action.move.marsh.return', 'action.move.core'], tags: ['quest'] },
      { key: 'scene.core', locationKey: 'location.core', title: '光路抉择', description: '两个互斥价值方向的结局准备场景。', actionKeys: ['action.prepare.rescue', 'action.prepare.seal'], tags: ['ending'] },
    ],
    objects: [
      { key: 'object.chart', locationKey: 'location.harbor', sceneKey: 'scene.harbor', title: '潮汐图', description: '标着盐沼旧路的防水图纸。', tags: ['map'] },
      { key: 'object.echo-post', locationKey: 'location.marsh', sceneKey: 'scene.marsh', title: '回声路标', description: '被雾潮扭曲方向的石质路标。', tags: ['route'] },
      { key: 'object.lens-cradle', locationKey: 'location.tower', sceneKey: 'scene.tower', title: '透镜座', description: '仍卡着一枚完整的备用透镜。', tags: ['quest'] },
      { key: 'object.light-paths', locationKey: 'location.core', sceneKey: 'scene.core', title: '双光路机关', description: '一条通海，一条朝向裂隙。', tags: ['ending'] },
    ],
    equipmentSlots: [
      { key: 'slot.body', title: '身体', acceptsTags: ['armor'] },
      { key: 'slot.hand', title: '主手', acceptsTags: ['tool', 'weapon'] },
    ],
    items: [
      { key: 'item.storm-cloak', title: '守灯披风', description: '厚重但能稳定雾中的感知。', tags: ['armor'], stackable: false, consumable: false, category: 'equipment', equipmentSlotKey: 'slot.body', modifiers: [{ abilityKey: 'ability.perception', delta: 1 }], usableActionKey: 'action.equip.cloak' },
      { key: 'item.beacon-lens', title: '备用透镜', description: '恢复灯塔光路所需的主线物品。', tags: ['quest', 'key'], stackable: false, consumable: false, category: 'quest', equipmentSlotKey: null, modifiers: [], usableActionKey: null },
      { key: 'item.emergency-oil', title: '应急灯油', description: '在危险地点恢复少量体力。', tags: ['consumable'], stackable: true, consumable: true, category: 'consumable', equipmentSlotKey: null, modifiers: [], usableActionKey: 'action.rest.tower' },
      { key: 'item.tide-token', title: '潮汐代币', description: '在隐藏补给箱里发现的小额通货。', tags: ['currency'], stackable: true, consumable: false, category: 'misc', equipmentSlotKey: null, modifiers: [], usableActionKey: null },
    ],
    abilities: [
      { key: 'ability.level', title: '等级', description: '通用角色成长等级。', initial: 1, minimum: 1, maximum: 10, role: 'stat', group: '成长' },
      { key: 'ability.attack', title: '攻击', description: '使用武器和力量解决阻碍。', initial: 2, minimum: 0, maximum: 20, role: 'stat', group: '战斗' },
      { key: 'ability.defense', title: '防御', description: '抵抗伤害与环境风险。', initial: 2, minimum: 0, maximum: 20, role: 'stat', group: '战斗' },
      { key: 'ability.perception', title: '感知', description: '辨认路径、细节与危险。', initial: 2, minimum: 0, maximum: 20, role: 'stat', group: '探索' },
      { key: 'ability.navigation', title: '导航', description: '在复杂空间中寻找稳定路线。', initial: 1, minimum: 0, maximum: 20, role: 'skill', group: '探索' },
    ],
    conditions: [
      { key: 'condition.route-known', title: '已确认盐沼路线', description: '无论成功还是受伤，你都找到了可行道路。', tags: ['fact', 'progress'] },
      { key: 'condition.wounded', title: '负伤', description: '失败推进带来的持久代价。', tags: ['harm'] },
      { key: 'condition.route-rescue', title: '归航光路已校准', description: '可以进入救援结局。', tags: ['ending'] },
      { key: 'condition.route-seal', title: '封闭光路已校准', description: '可以进入守城结局。', tags: ['ending'] },
    ],
    resources: [
      { key: 'resource.health', title: '生命', description: '归零前仍可继续行动。', initial: 10, minimum: 0, maximum: 10, role: 'health' },
      { key: 'resource.mana', title: '法力', description: '通用超自然能力资源。', initial: 6, minimum: 0, maximum: 6, role: 'mana' },
      { key: 'resource.stamina', title: '体力', description: '移动、尝试和休整消耗的资源。', initial: 6, minimum: 0, maximum: 6, role: 'stamina' },
      { key: 'resource.experience', title: '经验', description: '完成目标获得的成长进度。', initial: 0, minimum: 0, maximum: 100, role: 'experience' },
      { key: 'resource.skill-points', title: '技能点', description: '后续能力成长的可分配点数。', initial: 0, minimum: 0, maximum: 20, role: 'skill-points' },
      { key: 'resource.coin', title: '港币', description: '通用交易资源。', initial: 3, minimum: 0, maximum: 99, role: 'currency' },
      { key: 'resource.time', title: '经过时间', description: '从封港钟前开始累计的行动分钟数。', initial: 0, minimum: 0, maximum: 1_440, role: 'clock' },
    ],
    progression: {
      levelAbilityKey: 'ability.level', experienceResourceKey: 'resource.experience',
      skillPointResourceKey: 'resource.skill-points', experienceThresholds: [0, 20, 50, 90],
    },
    clock: { resourceKey: 'resource.time', dayLengthMinutes: 1_440, startLabel: '封港钟前' },
    quests: [{
      key: 'quest.beacon', title: '让灯塔重新发光', description: '穿越盐沼、找回透镜，并进入灯塔核心。',
      initialStatus: 'active', prerequisites: [], category: 'main',
      stages: [
        { key: 'stage.marsh', title: '穿越盐沼', objectiveKeys: ['objective.route'] },
        { key: 'stage.lens', title: '找回透镜', objectiveKeys: ['objective.lens'] },
      ],
      objectives: [
        { key: 'objective.route', title: '确认穿过盐沼的路线', optional: false, stageKey: 'stage.marsh', alternativeActionKeys: ['action.find.route'] },
        { key: 'objective.lens', title: '取得备用透镜', optional: false, stageKey: 'stage.lens', alternativeActionKeys: ['action.take.lens'] },
      ],
      rewardEffects: [
        { op: 'change-resource', resourceKey: 'resource.experience', delta: 20 },
        { op: 'change-resource', resourceKey: 'resource.skill-points', delta: 1 },
      ],
      completionNodeKey: 'crossroads', failureNodeKey: null,
    }],
    actions: [
      {
        key: 'action.look.harbor', kind: 'look', label: '观察仓房', description: '阅读开场环境。', locationKey: 'location.harbor', targetKey: 'object.chart', requirements: [], rule: { kind: 'automatic' }, successEffects: [], costlySuccessEffects: [], failureEffects: [], successText: '潮汐图显示，盐沼的旧路会在雾中移动。', costlySuccessText: '你勉强辨清图纸。', failureText: '图纸一时难以辨认。', unavailableText: '当前无法观察。', repeatable: true, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.equip.cloak', kind: 'use', label: '装备守灯披风', description: '占用身体槽并提高感知。', locationKey: 'location.harbor', targetKey: 'item.storm-cloak', requirements: [{ itemKey: 'item.storm-cloak', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'change-item-state', itemKey: 'item.storm-cloak', state: 'equipped' }], costlySuccessEffects: [], failureEffects: [], successText: '你系紧披风，雾里的声音变得清楚。', costlySuccessText: '披风勉强固定住。', failureText: '披风没有穿好。', unavailableText: '需要先持有守灯披风。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.search.cache', kind: 'inspect', label: '寻找隐藏补给', description: '用于验证种子化随机检查。', locationKey: 'location.harbor', targetKey: 'object.chart', requirements: [], rule: { kind: 'random', abilityKey: 'ability.perception', expression: '1d6', difficulty: 6, costlySuccessFloor: 4 }, successEffects: [{ op: 'gain-item', itemKey: 'item.tide-token', quantity: 1, claimKey: 'claim.tide-token' }], costlySuccessEffects: [{ op: 'change-resource', resourceKey: 'resource.stamina', delta: -1 }], failureEffects: [{ op: 'change-resource', resourceKey: 'resource.stamina', delta: -1 }], successText: '你在墙板后找到了潮汐代币。', costlySuccessText: '你没有找到代币，但及时收手。', failureText: '翻找耗掉了体力，补给箱仍不见踪影。', unavailableText: '补给已经检查过。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.move.marsh', kind: 'move', label: '前往回声盐沼', description: '从安全区进入危险区。', locationKey: 'location.harbor', targetKey: 'location.marsh', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'change-resource', resourceKey: 'resource.stamina', delta: -1 }, { op: 'change-resource', resourceKey: 'resource.time', delta: 15 }, { op: 'enter-location', locationKey: 'location.marsh' }], costlySuccessEffects: [], failureEffects: [], successText: '你离开港区，踏进没膝的盐水。', costlySuccessText: '你绕路进入盐沼。', failureText: '你没能离开港区。', unavailableText: '当前不能前往盐沼。', repeatable: true, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.find.route', kind: 'attempt', label: '辨认稳定路线', description: '失败也推进任务，但付出生命与负伤代价。', locationKey: 'location.marsh', targetKey: 'object.echo-post', requirements: [{ questKey: 'quest.beacon', questStatus: 'active' }], rule: { kind: 'threshold', abilityKey: 'ability.perception', difficulty: 99 }, successEffects: [{ op: 'apply-condition', conditionKey: 'condition.route-known', duration: null }, { op: 'complete-objective', questKey: 'quest.beacon', objectiveKey: 'objective.route' }, { op: 'change-resource', resourceKey: 'resource.time', delta: 15 }], costlySuccessEffects: [], failureEffects: [{ op: 'change-resource', resourceKey: 'resource.health', delta: -2 }, { op: 'apply-condition', conditionKey: 'condition.wounded', duration: null }, { op: 'apply-condition', conditionKey: 'condition.route-known', duration: null }, { op: 'complete-objective', questKey: 'quest.beacon', objectiveKey: 'objective.route' }, { op: 'change-resource', resourceKey: 'resource.time', delta: 30 }], successText: '你读懂回声的延迟，找到一条安全路线。', costlySuccessText: '你付出代价后找到了路线。', failureText: '你跌进潮沟、划伤手臂，但也因此摸到了通往灯塔的石脊。', unavailableText: '路线已经确认，或主线任务未激活。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.move.tower', kind: 'move', label: '沿石脊前往灯塔', description: '只有确认路线后才能移动。', locationKey: 'location.marsh', targetKey: 'location.tower', requirements: [{ conditionKey: 'condition.route-known', conditionPresent: true }], rule: { kind: 'automatic' }, successEffects: [{ op: 'change-resource', resourceKey: 'resource.stamina', delta: -1 }, { op: 'change-resource', resourceKey: 'resource.time', delta: 15 }, { op: 'enter-location', locationKey: 'location.tower' }], costlySuccessEffects: [], failureEffects: [], successText: '你沿石脊抵达灯塔底层。', costlySuccessText: '你绕路抵达灯塔。', failureText: '雾潮迫使你退回。', unavailableText: '必须先确认盐沼路线。', repeatable: true, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.move.marsh.return', kind: 'move', label: '返回盐沼', description: '允许探索回退。', locationKey: 'location.tower', targetKey: 'location.marsh', requirements: [], rule: { kind: 'automatic' }, successEffects: [{ op: 'change-resource', resourceKey: 'resource.time', delta: 10 }, { op: 'enter-location', locationKey: 'location.marsh' }], costlySuccessEffects: [], failureEffects: [], successText: '你返回盐沼石脊。', costlySuccessText: '你绕路返回盐沼。', failureText: '退路暂时被潮水封住。', unavailableText: '当前无法返回。', repeatable: true, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.take.lens', kind: 'take', label: '取下备用透镜', description: '完成主线第二阶段并结算成长奖励。', locationKey: 'location.tower', targetKey: 'object.lens-cradle', requirements: [{ questKey: 'quest.beacon', questStatus: 'active' }], rule: { kind: 'automatic' }, successEffects: [{ op: 'gain-item', itemKey: 'item.beacon-lens', quantity: 1, claimKey: 'claim.beacon-lens' }, { op: 'complete-objective', questKey: 'quest.beacon', objectiveKey: 'objective.lens' }, { op: 'change-resource', resourceKey: 'resource.time', delta: 5 }], costlySuccessEffects: [], failureEffects: [], successText: '你取下备用透镜，主线目标已经完成。', costlySuccessText: '透镜被艰难取下。', failureText: '透镜仍卡在底座中。', unavailableText: '透镜已经取得，或前置目标尚未完成。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.rest.tower', kind: 'rest', label: '使用灯油休整', description: '消耗物品，恢复体力并推进时间。', locationKey: 'location.tower', targetKey: 'item.emergency-oil', requirements: [{ itemKey: 'item.emergency-oil', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'remove-item', itemKey: 'item.emergency-oil', quantity: 1 }, { op: 'change-resource', resourceKey: 'resource.stamina', delta: 2 }, { op: 'change-resource', resourceKey: 'resource.time', delta: 20 }], costlySuccessEffects: [], failureEffects: [], successText: '灯油的热量让你恢复了体力。', costlySuccessText: '你只恢复了少量体力。', failureText: '休整没有奏效。', unavailableText: '背包里没有应急灯油。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.move.core', kind: 'move', label: '进入灯塔核心', description: '通过冻结 Narrative Choice 进入终局。', locationKey: 'location.tower', targetKey: 'location.core', requirements: [{ questKey: 'quest.beacon', questStatus: 'completed' }, { itemKey: 'item.beacon-lens', itemQuantity: 1 }], rule: { kind: 'automatic' }, successEffects: [{ op: 'change-resource', resourceKey: 'resource.time', delta: 5 }, { op: 'enter-location', locationKey: 'location.core' }], costlySuccessEffects: [], failureEffects: [], successText: '备用透镜点亮核心，两套光路等待选择。', costlySuccessText: '核心在震动中亮起。', failureText: '核心没有响应。', unavailableText: '需要先完成主线并取得透镜。', repeatable: false, narrativeChoiceKey: 'choice.enter-core', interaction: null,
      },
      {
        key: 'action.prepare.rescue', kind: 'quest-action', label: '校准归航光路', description: '解锁救援结局。', locationKey: 'location.core', targetKey: 'object.light-paths', requirements: [{ conditionKey: 'condition.route-seal', conditionPresent: false }], rule: { kind: 'resource-payment', resourceKey: 'resource.mana', amount: 2 }, successEffects: [{ op: 'apply-condition', conditionKey: 'condition.route-rescue', duration: null }, { op: 'change-resource', resourceKey: 'resource.time', delta: 10 }], costlySuccessEffects: [], failureEffects: [], successText: '海上的归航光路完成校准。', costlySuccessText: '光路带着损耗亮起。', failureText: '光路拒绝响应。', unavailableText: '法力不足，或另一条光路已经锁定。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
      {
        key: 'action.prepare.seal', kind: 'quest-action', label: '校准封闭光路', description: '解锁守城结局。', locationKey: 'location.core', targetKey: 'object.light-paths', requirements: [{ conditionKey: 'condition.route-rescue', conditionPresent: false }], rule: { kind: 'resource-payment', resourceKey: 'resource.mana', amount: 2 }, successEffects: [{ op: 'apply-condition', conditionKey: 'condition.route-seal', duration: null }, { op: 'change-resource', resourceKey: 'resource.time', delta: 10 }], costlySuccessEffects: [], failureEffects: [], successText: '朝向裂隙的封闭光路完成校准。', costlySuccessText: '光路带着损耗亮起。', failureText: '光路拒绝响应。', unavailableText: '法力不足，或另一条光路已经锁定。', repeatable: false, narrativeChoiceKey: null, interaction: null,
      },
    ],
    initialInventory: [
      { itemKey: 'item.storm-cloak', quantity: 1 },
      { itemKey: 'item.emergency-oil', quantity: 1 },
    ],
    storylets: [
      { key: 'storylet.hidden-cache', title: '仓房里的隐藏补给', actionKeys: ['action.search.cache'], requirements: [], once: true, priority: 10 },
      { key: 'storylet.marsh-fall', title: '失败也会打开道路', actionKeys: ['action.find.route'], requirements: [{ questKey: 'quest.beacon', questStatus: 'active' }], once: true, priority: 20 },
    ],
    endings: [
      { key: 'ending.rescue', title: '海上归灯', narrativeNodeKey: 'ending.rescue', requirements: [{ conditionKey: 'condition.route-rescue', conditionPresent: true }], priority: 10 },
      { key: 'ending.seal', title: '长夜守门', narrativeNodeKey: 'ending.seal', requirements: [{ conditionKey: 'condition.route-seal', conditionPresent: true }], priority: 10 },
    ],
    media: { mode: 'text-only', fallback: 'text-only', assetKeys: [] },
  }
}

export function createTextAdventureFoundationRuntimePackageV2(input: {
  worldRelease: WorldRelease & { id: number }
  sourceCatalog: ProductProductionWorldSourceCatalogV2
}): ProductRuntimePackageV1 {
  const base = createCurrentRuntimePackageFixture({
    productType: 'text-adventure',
    worldRelease: input.worldRelease,
    sourceCatalog: input.sourceCatalog,
  })
  const adventure = createTextAdventureFoundationContentV2()
  const scene = base.interaction?.sceneTemplates[0]
  const profile = base.interaction?.profiles[0]
  const relationshipRule = scene?.relationshipRules[0]
  if (scene && profile && relationshipRule) {
    adventure.actions.push({
      key: 'action.talk.keeper', kind: 'talk', label: `与${profile.name}交谈`,
      description: '通过共享角色互动协议结算关系变化。', locationKey: 'location.harbor',
      targetKey: null, requirements: [], rule: { kind: 'automatic' },
      successEffects: [], costlySuccessEffects: [], failureEffects: [],
      successText: `${profile.name}提醒你：失败并不意味着道路关闭。`,
      costlySuccessText: '这次谈话带来了代价。', failureText: '对方暂时不愿回应。',
      unavailableText: '当前无法交谈。', repeatable: true, narrativeChoiceKey: null,
      interaction: {
        participantKey: profile.participantKey,
        sceneKey: scene.sceneKey,
        ruleKey: relationshipRule.ruleKey,
      },
    })
    adventure.scenes.find(item => item.key === 'scene.harbor')?.actionKeys.push('action.talk.keeper')
  }
  return parseProductRuntimePackageV1({
    ...base,
    definition: {
      ...base.definition,
      productKey: 'foundation.text-adventure.v2',
      title: '雾潮灯塔 · TEXTADV-2 黄金夹具',
      description: '覆盖空间、属性、资源、装备、任务、时间、失败推进、存档分支与双结局。',
      rulesetVersion: 2,
    },
    narrative: createTextAdventureFoundationNarrativeV2(),
    adventure,
  })
}
