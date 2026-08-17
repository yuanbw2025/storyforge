import { importAvgMediaAsset } from '../avg/authoring'
import { db } from '../db/schema'
import { addNarrativeNode, createNarrativeModule } from '../narrative/blueprint'
import { adopt } from '../registry/adopt'
import { addNarrativeBeat, addNarrativeChoice, validateStoryGameContent } from '../text-game/content'
import {
  MIST_HARBOR_ROADSHOW_BEATS,
  MIST_HARBOR_ROADSHOW_CHOICES,
  MIST_HARBOR_ROADSHOW_NODES,
} from './mist-harbor-roadshow-story'
import type {
  Character,
  CharacterRelation,
  CodexCategory,
  CodexEntry,
  ImportantLocation,
  StoryArc,
  WorkspaceScope,
} from '../types'
import { readOwnedRows, resolveScope } from './scope'
import { selectWorkNarrativeModule } from './works'

export const MIST_HARBOR_DEMO_MODULE_TITLE = '雾港：失潮钟声（演示世界）'

export interface MistHarborDemoSummary {
  narrativeModuleId: number
  characterCount: number
  relationCount: number
  locationCount: number
  artifactCount: number
  loreEntryCount: number
  mediaAssetCount: number
}

const CHARACTER_ROWS = [
  {
    name: '林澈', role: 'protagonist', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
    shortDescription: '雾港最年轻的守灯人，也是唯一能听懂潮汐钟异响的人。', appearance: '深蓝长风衣、银灰短发，随身提着旧铜灯。',
    personality: '冷静、克制，危急时会选择保护他人。', background: '父亲在十年前的黑潮事故中失踪，她继承了北塔灯室。',
    motivation: '查清失潮真相，让港口在黎明前恢复潮声。', abilities: '辨认潮声、灯塔机械、近岸航行', relationships: '[]',
    arc: '从独自背负守灯职责，到相信同伴并公开港议会隐瞒的真相。', speechStyle: '短句，语气平静；谈及父亲时会停顿。',
  },
  {
    name: '余砚', role: 'supporting', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'lawful',
    shortDescription: '旧档案馆管理员，保存着被港议会封存的潮位记录。', appearance: '灰色长衣、铜制单片护目镜，指尖常沾蓝墨。',
    personality: '谨慎、博学，以证据为先。', background: '曾是潮汐钟校准师，黑潮事故后被调离钟楼。',
    motivation: '让真实记录重新被人看见。', abilities: '古档解读、钟机校准、密码学', relationships: '[]',
    arc: '从守秘者转为真相的公开证人。', speechStyle: '精确、简短，只说自己能够证实的事。',
  },
  {
    name: '顾潮生', role: 'antagonist', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'lawful',
    shortDescription: '港议会巡潮官，奉命阻止任何人接近失声钟楼。', appearance: '黑色防潮制服，肩章像两枚闭合的潮眼。',
    personality: '强硬、务实，并非不在意港民。', background: '亲历黑潮事故，坚信公开真相会引发更大的灾难。',
    motivation: '维持港口秩序，即使必须继续隐瞒。', abilities: '巡潮队指挥、近战、港区通行权', relationships: '[]',
    arc: '根据玩家选择，成为阻拦者、代价承担者或共同守港者。', speechStyle: '命令式语气，很少解释；动摇时会直呼林澈全名。',
  },
] as const

const LOCATION_ROWS = [
  ['雾港码头', ['港口', '海湾'], '浓雾中的青石码头，失潮后搁浅的船只像一排沉默骨架。', '开场地点与调查起点。'],
  ['潮灯集市', ['集市', '港口'], '依靠悬挂潮灯照明的夜市，港民在这里交换消息与禁售零件。', '获得民间证言并遭遇巡潮官。'],
  ['旧档案馆', ['城市', '遗迹'], '半沉入防洪墙的石砌档案馆，封存着十年前的黑潮记录。', '发现失潮机制与父亲留下的校准页。'],
  ['失声钟楼', ['禁地', '港口'], '位于防波堤尽头的巨大铜钟楼，今夜第一次完全停止。', '最终抉择与多结局地点。'],
  ['北塔灯室', ['要塞', '港口'], '俯瞰整座雾港的灯塔顶层，旧铜灯仍按守灯人的节律燃烧。', '角色关系与希望结局的情感锚点。'],
] as const

const ARTIFACT_ROWS = [
  ['黄铜潮汐钥匙', '能重新咬合潮汐钟主轴的校准钥匙。', '钥匙齿纹对应旧档案最后一页的潮位曲线。'],
  ['守灯人徽章', '允许持有者在封港时进入灯塔与钟楼。', '徽章背面刻着雾港旧誓词：灯未熄，港未沉。'],
  ['黑潮记录页', '被港议会从公共档案中抽走的一页原始记录。', '它证明十年前的黑潮并非天灾，而是一次错误的钟机试验。'],
] as const

const LORE_ROWS = [
  ['黑潮事故', '十年前导致雾港封锁与潮汐钟停摆的钟机试验事故。', '公开记录称它是极端天气，原始潮位页却证明议会曾强行提高钟机共振。'],
  ['守灯人旧誓', '雾港守灯人世代相传的公共誓词。', '“灯未熄，港未沉。”它不是血统宣言，而是任何愿意守灯者都可承担的职责。'],
] as const

const STORY_ARC_STAGES = [
  {
    id: 'mist-act-one', title: '第一幕 · 失潮之夜',
    description: '午夜潮汐迟到十三分钟，港民姓名从登记册和记忆里消失。林澈必须先追查旧档案，或先保护潮灯集市里的失名者。',
    keyEvents: ['码头失潮与姓名褪色', '档案馆蓝灯暗号', '潮灯集市公共证词', '黑潮事故的十三分钟'],
    turningPoint: '确认潮汐钟正在以城市记忆为代价重新充能',
  },
  {
    id: 'mist-act-two', title: '第二幕 · 城市的潮心',
    description: '调查路线在地下泵站汇合。林澈可修复机械旁路争取安全窗口，或找回四十七名遇难者姓名；随后在北塔选择父亲记录或议会封缄令。',
    keyEvents: ['逆转泵轮或沉没者名录', '顾潮生承认哥哥之死', '父亲第七码或议会封缄令', '三方共同取得钟楼接管权'],
    turningPoint: '三人得知重启、限流与断钟都必须承担不可撤销的代价',
  },
  {
    id: 'mist-act-three', title: '第三幕 · 失声钟楼',
    description: '黑潮抵达前，林澈在公开全部记录、签下七日公开之约和彻底断钟驶向潮源之间作出最终选择。',
    keyEvents: ['真相之钟', '守灯人的黎明', '向黑潮航行'],
    turningPoint: '雾港不再寻找无代价的答案，而是公开记录自己选择承担的代价',
  },
]

const STORY_ARC_DESCRIPTION = '三幕多结局主线：从失潮与失名异象出发，揭开潮汐钟以集体记忆维持秩序的黑潮旧案，并在真相、撤离安全与远航追源之间作出选择。所有可玩路线都会跨越三幕，并在钟楼收束为三种明确结局。'

function backgroundSvg(key: string, sky: string, glow: string, variant: number): Blob {
  const towers = Array.from({ length: 8 }, (_, index) => {
    const x = 40 + index * 170
    const height = 130 + ((index * 53 + variant * 31) % 210)
    return `<rect x="${x}" y="${540 - height}" width="95" height="${height}" rx="4" fill="#0b1c29" opacity=".92"/><rect x="${x + 18}" y="${510 - height}" width="12" height="12" fill="${glow}" opacity=".7"/>`
  }).join('')
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="#091824"/></linearGradient><radialGradient id="g"><stop stop-color="${glow}" stop-opacity=".72"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient><filter id="f"><feGaussianBlur stdDeviation="24"/></filter></defs><rect width="1280" height="720" fill="url(#s)"/><circle cx="${180 + variant * 190}" cy="150" r="170" fill="url(#g)" filter="url(#f)"/>${towers}<path d="M0 585 Q230 545 430 590 T820 575 T1280 600 V720 H0Z" fill="#07131d"/><path d="M0 625 Q260 590 520 635 T980 610 T1280 645" fill="none" stroke="${glow}" stroke-opacity=".35" stroke-width="5"/><g fill="#d8c78e">${Array.from({ length: 16 }, (_, i) => `<circle cx="${60 + i * 78}" cy="${570 + (i % 3) * 18}" r="3" opacity=".${4 + i % 5}"/>`).join('')}</g><title>${key}</title></svg>`], { type: 'image/svg+xml' })
}

function portraitSvg(name: string, coat: string, light: string, variant: number): Blob {
  return new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1080" viewBox="0 0 720 1080"><defs><linearGradient id="c"><stop stop-color="${coat}"/><stop offset="1" stop-color="#09131e"/></linearGradient><radialGradient id="l"><stop stop-color="${light}" stop-opacity=".8"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient></defs><ellipse cx="360" cy="930" rx="300" ry="100" fill="url(#l)"/><path d="M155 1040 Q170 610 360 570 Q550 610 565 1040Z" fill="url(#c)"/><path d="M252 337 Q265 175 360 155 Q470 178 476 345 L455 500 Q420 580 360 592 Q295 572 265 495Z" fill="#d4aa91"/><path d="M245 350 Q220 160 362 125 Q505 170 478 380 Q445 260 365 245 Q300 300 245 350Z" fill="#162231"/><path d="M280 395 Q318 ${380 + variant * 5} 346 402" fill="none" stroke="#182433" stroke-width="12" stroke-linecap="round"/><path d="M378 402 Q420 ${378 - variant * 4} 450 397" fill="none" stroke="#182433" stroke-width="12" stroke-linecap="round"/><path d="M325 488 Q360 ${500 + variant * 6} 402 483" fill="none" stroke="#8b4f54" stroke-width="8" stroke-linecap="round"/><path d="M360 590 L305 680 L360 765 L420 680Z" fill="${light}" opacity=".72"/><circle cx="520" cy="810" r="125" fill="url(#l)"/><circle cx="520" cy="810" r="34" fill="${light}" opacity=".85"/><title>${name}</title></svg>`], { type: 'image/svg+xml' })
}

async function ensureCharacters(scope: WorkspaceScope): Promise<Map<string, number>> {
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'characters',
    mode: 'add-many',
    data: CHARACTER_ROWS.map(row => ({ ...row })),
  })
  const current = await readOwnedRows<Character>(scope, 'characters')
  const ids = new Map<string, number>()
  for (const row of CHARACTER_ROWS) {
    const existing = current.find(item => item.name === row.name)
    if (!existing?.id) throw new Error(`[mist-harbor] 角色采纳失败:${row.name}`)
    ids.set(row.name, existing.id)
  }
  return ids
}

async function ensureWorldAssets(scope: WorkspaceScope, characters: Map<string, number>): Promise<void> {
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'importantLocations',
    mode: 'add-many',
    data: LOCATION_ROWS.map(([name, tags, description, significance], sortOrder) => ({
      name, tags, description, significance, parentId: null, sortOrder,
    })),
  })
  let loreCategory = (await readOwnedRows<CodexCategory>(scope, 'codexCategories'))
    .find(item => item.builtInKey === 'humEvent')
  if (!loreCategory) {
    await adopt({
      projectId: scope.projectId,
      scope,
      target: 'codexCategories',
      mode: 'add',
      data: { domain: 'humanity', parentId: null, name: '世界事件', builtInKey: 'humEvent', fieldSchema: [], hidden: false, order: 1, worldGroupId: null },
    })
    loreCategory = (await readOwnedRows<CodexCategory>(scope, 'codexCategories'))
      .find(item => item.builtInKey === 'humEvent')
  }
  if (!loreCategory?.id) throw new Error('[mist-harbor] 世界事件分类采纳失败')
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'codexEntries',
    mode: 'add-many',
    data: LORE_ROWS.map(([name, summary, description], order) => ({
      categoryId: loreCategory!.id!, name, summary, description, fields: {}, refs: {},
      tags: ['雾港', '世界知识'], importance: 5 - order, order, worldGroupId: null,
    })),
  })
  let category = (await readOwnedRows<CodexCategory>(scope, 'codexCategories'))
    .find(item => item.builtInKey === 'artifact')
  if (!category) {
    await adopt({
      projectId: scope.projectId,
      scope,
      target: 'codexCategories',
      mode: 'add',
      data: { domain: 'humanity', parentId: null, name: '人工器物', builtInKey: 'artifact', fieldSchema: [], hidden: false, order: 0, worldGroupId: null },
    })
    category = (await readOwnedRows<CodexCategory>(scope, 'codexCategories'))
      .find(item => item.builtInKey === 'artifact')
  }
  if (!category?.id) throw new Error('[mist-harbor] artifact 分类采纳失败')
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'codexEntries',
    mode: 'add-many',
    data: ARTIFACT_ROWS.map(([name, summary, description], order) => ({
      categoryId: category!.id!, name, summary, description, fields: {}, refs: {},
      tags: ['雾港', '关键道具'], importance: 5 - order, order, worldGroupId: null,
    })),
  })
  const relationRows = [
    ['林澈', '余砚', 'ally', '真相同盟', '余砚掌握记录，林澈拥有进入钟楼的资格；两人需要彼此才能完成调查。', true],
    ['林澈', '顾潮生', 'rival', '守港理念冲突', '两人都想保护雾港，却对公开真相与维持秩序有相反判断。', true],
  ] as const
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'characterRelations',
    mode: 'add-many',
    data: relationRows.map(([from, to, relationType, label, description, isBidirectional]) => ({
      fromCharacterId: characters.get(from)!, toCharacterId: characters.get(to)!, relationType,
      label, description, isBidirectional,
    })),
  })
  const arc = (await readOwnedRows<StoryArc>(scope, 'storyArcs'))
    .find(item => item.name === '失潮钟声主线')
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'storyArcs',
    ...(arc?.id ? { recordId: arc.id } : {}),
    mode: arc?.id ? 'replace' : 'add',
    data: {
      name: '失潮钟声主线', type: 'main', stages: STORY_ARC_STAGES,
      description: STORY_ARC_DESCRIPTION,
    },
  })
}

async function ensureNarrative(scope: WorkspaceScope, characters: Map<string, number>): Promise<number> {
  let module = await db.narrativeModules.where('projectId').equals(scope.projectId)
    .filter(item => item.worldId === scope.worldId && item.title === MIST_HARBOR_DEMO_MODULE_TITLE).first()
  if (!module) {
    module = await createNarrativeModule({
      scope, owner: 'world', kind: 'main', title: MIST_HARBOR_DEMO_MODULE_TITLE,
      description: '由正式世界角色、地点、道具和主线构成，可投影为分支叙事、文字冒险与 AVG。',
    })
  }
  const [nodes, beats, choices] = await Promise.all([
    db.narrativeNodes.where('moduleId').equals(module.id!).toArray(),
    db.narrativeBeats.where('moduleId').equals(module.id!).toArray(),
    db.narrativeChoices.where('moduleId').equals(module.id!).toArray(),
  ])
  const desiredNodeKeys = new Set(MIST_HARBOR_ROADSHOW_NODES.map(item => item.key))
  const desiredBeatKeys = new Set(MIST_HARBOR_ROADSHOW_BEATS.map(item => item.beatKey))
  const desiredChoiceKeys = new Set(MIST_HARBOR_ROADSHOW_CHOICES.map(item => item.choiceKey))
  await db.narrativeChoices.bulkDelete(choices.filter(item => !desiredChoiceKeys.has(item.choiceKey)).flatMap(item => item.id ?? []))
  await db.narrativeBeats.bulkDelete(beats.filter(item => !desiredBeatKeys.has(item.beatKey)).flatMap(item => item.id ?? []))
  await db.narrativeNodes.bulkDelete(nodes.filter(item => !desiredNodeKeys.has(item.key)).flatMap(item => item.id ?? []))
  for (const [order, node] of MIST_HARBOR_ROADSHOW_NODES.entries()) {
    const existing = nodes.find(item => item.key === node.key)
    if (existing?.id) {
      await db.narrativeNodes.update(existing.id, {
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        conditionJson: '{}',
        effectsJson: '[]',
        successorKeysJson: JSON.stringify(node.successors),
        order,
        updatedAt: Date.now(),
      })
    } else {
      await addNarrativeNode({
        scope, moduleId: module.id!, key: node.key, kind: node.kind, title: node.title,
        summary: node.summary, successorKeys: node.successors, order,
      })
    }
  }
  await db.narrativeModules.update(module.id!, {
    entryNodeKey: 'entry',
    description: '三幕路演分支剧情：失潮、失名与黑潮旧案在钟楼汇成真相、七日之约与远航三结局。',
    updatedAt: Date.now(),
  })
  for (const [order, beat] of MIST_HARBOR_ROADSHOW_BEATS.entries()) {
    const speakerCharacterId = beat.speaker ? characters.get(beat.speaker) : null
    const existing = beats.find(item => item.beatKey === beat.beatKey)
    if (existing?.id) {
      await db.narrativeBeats.update(existing.id, {
        nodeKey: beat.nodeKey,
        kind: beat.kind,
        speakerCharacterId,
        text: beat.text,
        order,
        updatedAt: Date.now(),
      })
    } else {
      await addNarrativeBeat({
        scope, moduleId: module.id!, nodeKey: beat.nodeKey, beatKey: beat.beatKey,
        kind: beat.kind, speakerCharacterId,
        text: beat.text, order,
      })
    }
  }
  for (const [order, choice] of MIST_HARBOR_ROADSHOW_CHOICES.entries()) {
    const existing = choices.find(item => item.choiceKey === choice.choiceKey)
    if (existing?.id) {
      await db.narrativeChoices.update(existing.id, {
        sourceNodeKey: choice.sourceNodeKey,
        text: choice.text,
        description: choice.description,
        unavailableReason: '',
        targetNodeKey: choice.targetNodeKey,
        displayConditionJson: '{}',
        availableConditionJson: '{}',
        effectsJson: choice.effectsJson ?? '[]',
        tagsJson: JSON.stringify(choice.targetNodeKey === 'truth' || choice.targetNodeKey === 'home' || choice.targetNodeKey === 'sea' ? ['ending'] : []),
        order,
        updatedAt: Date.now(),
      })
    } else {
      await addNarrativeChoice({
        scope,
        moduleId: module.id!,
        sourceNodeKey: choice.sourceNodeKey,
        choiceKey: choice.choiceKey,
        text: choice.text,
        description: choice.description,
        targetNodeKey: choice.targetNodeKey,
        effectsJson: choice.effectsJson,
        tags: choice.targetNodeKey === 'truth' || choice.targetNodeKey === 'home' || choice.targetNodeKey === 'sea' ? ['ending'] : [],
        order,
      })
    }
  }
  const report = await validateStoryGameContent(scope, module.id!)
  if (!report.valid) throw new Error(`[mist-harbor] 演示叙事校验失败:${report.errors.join('；')}`)
  await selectWorkNarrativeModule(scope, module.id!)
  return module.id!
}

async function ensureMedia(scope: WorkspaceScope): Promise<void> {
  const source = 'StoryForge 雾港路演美术包（项目作者提供，ChatGPT 辅助生成）'
  const license = 'StoryForge 项目内演示与产品使用'
  const loadRoadshowImage = async (fileName: string, fallback: () => Blob): Promise<Blob> => {
    if (import.meta.env.MODE === 'test') return fallback()
    try {
      const baseUrl = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
      const response = await fetch(`${baseUrl}demo-assets/mist-harbor/${fileName}`)
      if (!response.ok) return fallback()
      const blob = await response.blob()
      return blob.size > 0 && blob.type.startsWith('image/') ? blob : fallback()
    } catch {
      // Unit tests and offline/misconfigured deployments retain the deterministic
      // generated fixture instead of making the demo installation fail.
      return fallback()
    }
  }
  const scenes = [
    ['mist.bg.harbor', '雾港码头', 'mist-bg-harbor.webp', '#18384d', '#d1b36a', 0, 'entry'],
    ['mist.bg.archive', '旧档案馆', 'mist-bg-archive.webp', '#283042', '#72a6b3', 1, 'archive'],
    ['mist.bg.market', '潮灯集市', 'mist-bg-market.webp', '#392742', '#e7a856', 2, 'market'],
    ['mist.bg.bell', '失声钟楼', 'mist-bg-bell.webp', '#142936', '#b6d3c6', 3, 'bell'],
    ['mist.bg.lighthouse', '北塔灯室', 'mist-bg-lighthouse.webp', '#415777', '#f2c77e', 4, 'lighthouse'],
  ] as const
  for (const [assetKey, name, fileName, sky, glow, variant, sceneTag] of scenes) {
    await importAvgMediaAsset({
      scope, assetKey, kind: 'background', name,
      blob: await loadRoadshowImage(fileName, () => backgroundSvg(name, sky, glow, variant)),
      altText: `${name}的雾港宽幅场景`, source, license, sceneTag, width: 1672, height: 941,
    })
  }
  const portraits = [
    ['mist.actor.lin', '林澈·冷静观察', 'mist-actor-lin-neutral.webp', '#203d59', '#e0be6b', 0, '林澈', 'entry'],
    ['mist.actor.lin.tense', '林澈·警觉紧张', 'mist-actor-lin-tense.webp', '#203d59', '#e0be6b', 1, '林澈', 'scene'],
    ['mist.actor.lin.resolve', '林澈·下定决心', 'mist-actor-lin-resolve.webp', '#203d59', '#e0be6b', 2, '林澈', 'choice'],
    ['mist.actor.yu', '余砚·谨慎陈述', 'mist-actor-yu-neutral.webp', '#394052', '#7cb6bd', 1, '余砚', 'entry'],
    ['mist.actor.yu.alarm', '余砚·发现真相', 'mist-actor-yu-alarm.webp', '#394052', '#7cb6bd', 2, '余砚', 'scene'],
    ['mist.actor.yu.resolve', '余砚·决定公开', 'mist-actor-yu-resolve.webp', '#394052', '#7cb6bd', 3, '余砚', 'ending'],
    ['mist.actor.gu', '顾潮生·威严阻拦', 'mist-actor-gu-neutral.webp', '#322b38', '#d27b63', 2, '顾潮生', 'scene'],
    ['mist.actor.gu.anger', '顾潮生·强硬命令', 'mist-actor-gu-anger.webp', '#322b38', '#d27b63', 3, '顾潮生', 'choice'],
    ['mist.actor.gu.conflict', '顾潮生·内心动摇', 'mist-actor-gu-conflict.webp', '#322b38', '#d27b63', 4, '顾潮生', 'ending'],
  ] as const
  for (const [assetKey, name, fileName, coat, light, variant, characterTag, sceneTag] of portraits) {
    await importAvgMediaAsset({
      scope, assetKey, kind: assetKey.includes('.') && !['mist.actor.lin', 'mist.actor.yu', 'mist.actor.gu'].includes(assetKey) ? 'character-expression' : 'character-pose', name,
      blob: await loadRoadshowImage(fileName, () => portraitSvg(name, coat, light, variant)),
      altText: `${characterTag}${name.split('·')[1] ?? ''}全身立绘`, source, license, characterTag, sceneTag, width: 1024, height: 1536,
    })
  }
  const endings = [
    ['mist.cg.truth', '真相之钟', 'mist-cg-truth.webp', '#874a42', '#f5d986', 4, 'truth'],
    ['mist.cg.home', '守灯人的黎明', 'mist-cg-home.webp', '#415777', '#f2c77e', 5, 'home'],
    ['mist.cg.sea', '向黑潮航行', 'mist-cg-sea.webp', '#172a48', '#8eb8cb', 6, 'sea'],
  ] as const
  for (const [assetKey, name, fileName, sky, glow, variant, sceneTag] of endings) {
    await importAvgMediaAsset({
      scope, assetKey, kind: 'cg', name,
      blob: await loadRoadshowImage(fileName, () => backgroundSvg(name, sky, glow, variant)),
      altText: `${name}结局插画`, source, license, sceneTag, width: 1672, height: 941,
    })
  }
}

/** Seeds formal governed world records only; publishing and game projection remain explicit normal workflow steps. */
export async function installMistHarborDemoWorld(input: { scope: WorkspaceScope }): Promise<MistHarborDemoSummary> {
  const scope = await resolveScope({ scope: input.scope })
  const characters = await ensureCharacters(scope)
  await ensureWorldAssets(scope, characters)
  const narrativeModuleId = await ensureNarrative(scope, characters)
  await ensureMedia(scope)
  const [relations, locations, categories, entries, mediaAssets] = await Promise.all([
    readOwnedRows<CharacterRelation>(scope, 'characterRelations'),
    readOwnedRows<ImportantLocation>(scope, 'importantLocations'),
    readOwnedRows<CodexCategory>(scope, 'codexCategories'),
    readOwnedRows<CodexEntry>(scope, 'codexEntries'),
    db.avgMediaAssets.where('workId').equals(scope.workId).toArray(),
  ])
  const demoCharacterIds = new Set(characters.values())
  const relationCount = relations.filter(item => demoCharacterIds.has(item.fromCharacterId)
    && demoCharacterIds.has(item.toCharacterId)
    && ['真相同盟', '守港理念冲突'].includes(item.label)).length
  const locationNames = new Set<string>(LOCATION_ROWS.map(item => item[0]))
  const locationCount = locations.filter(item => locationNames.has(item.name)).length
  const artifactCategory = categories.find(item => item.builtInKey === 'artifact')
  const loreCategory = categories.find(item => item.builtInKey === 'humEvent')
  const artifactNames = new Set<string>(ARTIFACT_ROWS.map(item => item[0]))
  const loreNames = new Set<string>(LORE_ROWS.map(item => item[0]))
  const artifactCount = entries.filter(item => item.categoryId === artifactCategory?.id && artifactNames.has(item.name)).length
  const loreEntryCount = entries.filter(item => item.categoryId === loreCategory?.id && loreNames.has(item.name)).length
  const mediaAssetCount = new Set(mediaAssets.filter(item => item.assetKey.startsWith('mist.')).map(item => item.assetKey)).size
  return {
    narrativeModuleId,
    characterCount: characters.size,
    relationCount,
    locationCount,
    artifactCount,
    loreEntryCount,
    mediaAssetCount,
  }
}
