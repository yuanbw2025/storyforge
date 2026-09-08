import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type { MotionDramaPromptOverrideV1, MotionDramaPromptStageV1, WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'

export interface MotionDramaPromptDefinitionV1 {
  version: 1
  stage: MotionDramaPromptStageV1
  label: string
  profession: string
  purpose: string
  instruction: string
}

export interface ResolvedMotionDramaPromptV1 {
  definition: MotionDramaPromptDefinitionV1
  instruction: string
  source: 'built-in' | 'work' | 'episode'
  revision: number
  contentHash: string
}

const COMMON = [
  '你正在 StoryForge 漫剧工坊中工作。只完成当前岗位，不越权生成后续阶段，也不把候选当作作者已确认内容。',
  '这是适用于常规商业创作的通用生产流程，不针对任何比赛、活动或单一厂商写作。',
  '忠于冻结小说的因果、人物动机与核心情感；允许为了视听节奏进行外化、压缩与重排，但不得伪造来源事实。',
  '所有画面必须可见、可演、可拍；不要用抽象心理说明替代动作、表情、关系距离、环境变化或声音线索。',
  '稳定 key 只使用 ASCII 字母、数字、点、下划线和连字符，并逐字复用上下文已提供的引用 key。',
  '只输出协议要求的单个 JSON 值，不要 Markdown、注释、代码围栏或额外解释。输出前静默检查字段闭集、顺序、秒数、引用与连续性。',
].join('\n')

function define(stage: MotionDramaPromptStageV1, label: string, profession: string, purpose: string, instruction: string): MotionDramaPromptDefinitionV1 {
  return Object.freeze({ version: 1, stage, label, profession, purpose, instruction: `${COMMON}\n\n${instruction}` })
}

export const MOTION_DRAMA_PROMPT_LIBRARY_V1: Readonly<Record<MotionDramaPromptStageV1, MotionDramaPromptDefinitionV1>> = Object.freeze({
  'series-bible': define('series-bible', '系列圣经', '总编剧 / 系列开发制片人', '锁定整季承诺、人物弧与可持续故事引擎', [
    '把冻结小说转化为一份可执行的漫剧系列圣经。优先识别：观众为什么追下一集、主人公持续面对什么选择、每集如何制造可见冲突、季终兑现什么。',
    'titlePromise 是片名承诺；storyEngine 必须能重复产出冲突而不是一次性梗概；seasonArc、protagonistArc、relationshipArcs 必须有起点、升级与兑现。',
    'episodeArchitecture 写清冷开场、主要升级、反转/兑现、尾钩的节奏模板；hookPatterns 给出可轮换的钩子机制，避免每集同构。',
    'visualLanguage 与 soundLanguage 要能指导后续美术和声音；continuityRules 锁定身份、关系、空间、伤痕、关键物与能力规则；productionConstraints 明确镜头时长、复杂群像、文字入画等限制。',
    '不得逐章复述小说，也不得写镜头或厂商提示词。',
  ].join('\n')),
  'asset-bible': define('asset-bible', '物料圣经', '美术总监 / 角色设定主管 / 声音设计师', '一次建立可复用的角色、服装、场景、道具、风格与声音资产', [
    '建立跨集复用的物料主体库。每个 subject 是一个可独立引用、可版本化的连续性锚点；角色与服装分开，角色身份特征不与某套衣服捆绑。',
    'identity 写不可变身份；appearance 写可观察造型；palette/materials 支撑材质和色彩一致性；continuityLocks 写必须保持；prohibitedChanges 写常见漂移禁区。',
    'basePrompt 是厂商中立的视觉或声音生成基线；negativePrompt 只写需要排除的失败模式；referenceBrief 说明应准备哪些正面、侧面、表情、比例、空间或音色参考。',
    '至少覆盖主要角色、关键服装、常驻场景、剧情道具、统一风格；有对白的主要角色要有 voice，重要环境要有 sound。避免为一次性背景细节制造资产。',
  ].join('\n')),
  'episode-outline': define('episode-outline', '单集节拍', '短剧统筹编剧', '把整季推进压进一集可执行的时间预算', [
    '只设计当前集。开头 3～8 秒必须发生可见异常、承诺或迫近危险；中段每 10～25 秒至少有一次压力升级、信息改变或关系转向；结尾必须形成下一集不可忽略的问题。',
    '每个 beat 只有一个主动作和一个清楚的 turn，targetSeconds 总和接近单集目标秒数。sourceUnitKeys 必须引用冻结来源。',
    'continuityIn 是本集开场必须继承的状态；continuityOut 是下集必须接住的新状态。不得用旁白替代本可演出的关键因果。',
  ].join('\n')),
  'episode-script': define('episode-script', '漫剧剧本', '漫剧编剧 / 分场编剧', '把单集节拍写成可演、可分镜、可配音的专业分场稿', [
    '每场都要有进入状态、场景目的、对抗或阻力、情绪转折和退出状态；没有状态变化的场应合并或删除。',
    'heading 使用“内/外景 + 地点 + 时间”；visibleAction 按屏幕上能看见的动作顺序写，不写摄影机；dialogue 口语化、角色化、短而有潜台词，delivery 只标必要表演。',
    'narration 仅在漫剧叙述策略确有必要时使用；soundCues 用 voice/ambience/sfx/music 区分并给出 timing。各场 estimatedSeconds 总和接近本集目标。',
    'characterKeys、sourceUnitKeys 只能使用合法引用键。场景 order 从 0 连续，sceneNumber 从 1 连续。',
  ].join('\n')),
  'shot-design': define('shot-design', '分镜设计', '分镜导演 / 动画预演导演', '把剧本拆成单一镜头意图与连续可生成动作', [
    '一个 shot 只承载一个清楚的视觉意图和一段连续动作。用景别、机位、构图、表演、光线、镜头运动与转场共同服务 narrativeFunction。',
    '镜头通常 2～8 秒；复杂动作拆镜，不在一个短镜头中堆叠多次换景、多人连续事件或不可能的摄影机路径。静态对白也要用反应、遮挡、前后景和关系距离制造变化。',
    '保持轴线、视线、动作方向、人物站位、服装、道具和光源连续。subjectKeys 必须绑定物料库；sceneKey/sourceUnitKeys 必须逐字引用当前集合法 key。',
    '本阶段 imagePrompt/videoPrompt 等 IR 字段先输出空字符串，避免把镜头设计和厂商提示词混成一步。shot order 从 0 连续，shotNumber 从 1 连续。',
  ].join('\n')),
  'image-prompts': define('image-prompts', '画面提示词 IR', '视觉开发 / 关键帧提示词设计师', '为每镜建立一致的起始、关键和结束画面', [
    '为当前集每个已确认镜头写厂商中立 Image Prompt IR。顺序建议：作品画风与媒介 → 角色/服装/场景/道具身份锁 → 精确时刻与可见动作 → 表情姿态 → 景别机位构图 → 光线色彩材质 → 画幅与质量。',
    'imagePrompt 描述代表性定帧；firstFramePrompt、keyFramePrompt、lastFramePrompt 分别描述动作起点、决定性中间状态和动作终点，三帧应形成可插值的连续变化，不是三个不同场景。',
    'negativeImagePrompt 排除身份漂移、额外肢体、服装变化、空间翻转、文字水印、错误人数、糊脸和风格漂移，不要堆无关质量词。expectedRevision 必须等于上下文镜头 revision。',
  ].join('\n')),
  'video-prompts': define('video-prompts', '视频提示词 IR', '动画导演 / 运动提示词设计师', '把分镜变成动作、摄影机、节奏、声音都明确的视频指令', [
    '为当前集每个已确认镜头写厂商中立 Video Prompt IR。优先描述“初始状态 → 主体动作 → 环境响应 → 摄影机运动 → 结束状态”，避免重新描写参考图已经锁定的静态身份。',
    '动作要物理可执行，有速度、幅度、方向和停点；摄影机只保留一个主要运动，必要时加一个轻微次运动；写清谁不动以及背景应保持什么。',
    '对白镜头描述口型/呼吸/视线和微表演；动作镜头描述重心、惯性、碰撞与环境反馈。negativeVideoPrompt 排除抽搐、融化、身份切换、穿模、瞬移、镜头乱摆、口型漂移和循环动作。expectedRevision 必须匹配。',
  ].join('\n')),
  'quality-review': define('quality-review', '生产审查', '总导演 / 连续性主管 / AI 视频技术导演', '在导出前发现故事、连续性、可生成性与权利风险', [
    '逐项检查：开场与尾钩、因果与人物动机、单集秒数、场景状态变化、对白可演性、镜头职责、轴线和空间、角色/服装/道具连续性、首尾帧可插值性、动作复杂度、视频提示词可执行性、声音计划、参考图和商用权利、目标厂商能力。',
    '只报告能定位、能举证、能修复的问题。critical 会阻止发布；major 会显著降低成片质量；minor 是润色。没有问题时输出 []，不得为了显得认真而虚构问题。',
  ].join('\n')),
})

export function getMotionDramaPromptDefinitionV1(stage: MotionDramaPromptStageV1): MotionDramaPromptDefinitionV1 {
  return MOTION_DRAMA_PROMPT_LIBRARY_V1[stage]
}

export async function listMotionDramaPromptOverridesV1(scopeInput: WorkspaceScope): Promise<MotionDramaPromptOverrideV1[]> {
  const scope = await resolveScope({ scope: scopeInput })
  return db.motionDramaPromptOverrides.where('workId').equals(scope.workId).sortBy('updatedAt')
}

export async function resolveMotionDramaPromptV1(scopeInput: WorkspaceScope, stage: MotionDramaPromptStageV1, episodeNumber: number): Promise<ResolvedMotionDramaPromptV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const rows = await db.motionDramaPromptOverrides.where('workId').equals(scope.workId).filter(row => row.stage === stage).toArray()
  const episode = rows.find(row => row.scope === 'episode' && row.episodeNumber === episodeNumber)
  const work = rows.find(row => row.scope === 'work' && row.episodeNumber === null)
  const selected = episode ?? work
  const definition = getMotionDramaPromptDefinitionV1(stage)
  const instruction = selected?.instruction.trim() || definition.instruction
  return { definition, instruction, source: selected?.scope ?? 'built-in', revision: selected?.revision ?? 1, contentHash: await hashCanonicalValue({ stage, instruction, source: selected?.scope ?? 'built-in', revision: selected?.revision ?? 1 }) }
}

export async function saveMotionDramaPromptOverrideV1(input: { scope: WorkspaceScope; stage: MotionDramaPromptStageV1; overrideScope: 'work' | 'episode'; episodeNumber: number; instruction: string }): Promise<MotionDramaPromptOverrideV1> {
  const scope = await resolveScope({ scope: input.scope })
  const instruction = input.instruction.trim()
  if (!instruction || instruction.length > 40_000) throw new Error('[motion-drama-prompt] 覆盖提示词必须为 1～40000 字符')
  const episodeNumber = input.overrideScope === 'episode' ? input.episodeNumber : null
  if (episodeNumber != null && (!Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 200)) throw new Error('[motion-drama-prompt] 集号非法')
  return db.transaction('rw', scopeTransactionTables(db.motionDramaPromptOverrides, db.motionDramaPromptPacks, db.motionDramaProductions), async () => {
    const [existing, production] = await Promise.all([
      db.motionDramaPromptOverrides.where('workId').equals(scope.workId).filter(row => row.stage === input.stage && row.scope === input.overrideScope && row.episodeNumber === episodeNumber).first(),
      db.motionDramaProductions.where('workId').equals(scope.workId).first(),
    ])
    if (!production?.id) throw new Error('[motion-drama-prompt] 漫剧生产根不存在')
    const now = Date.now()
    const row: MotionDramaPromptOverrideV1 = stampNewRecord(scope, 'motionDramaPromptOverrides', {
      ...(existing?.id ? { id: existing.id } : {}), projectId: scope.projectId, workId: scope.workId, stage: input.stage,
      scope: input.overrideScope, episodeNumber, instruction, revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    }, { owner: 'work' })
    const id = await db.motionDramaPromptOverrides.put(row) as number
    const packs = await db.motionDramaPromptPacks.where('workId').equals(scope.workId).filter(pack => episodeNumber == null || pack.episodeNumber === episodeNumber).toArray()
    await db.motionDramaPromptPacks.bulkDelete(packs.flatMap(pack => pack.id == null ? [] : [pack.id]))
    await db.motionDramaProductions.update(production.id, { revision: production.revision + 1, updatedAt: now })
    return { ...row, id }
  })
}

export async function deleteMotionDramaPromptOverrideV1(input: { scope: WorkspaceScope; stage: MotionDramaPromptStageV1; overrideScope: 'work' | 'episode'; episodeNumber: number }): Promise<void> {
  const scope = await resolveScope({ scope: input.scope })
  const episodeNumber = input.overrideScope === 'episode' ? input.episodeNumber : null
  await db.transaction('rw', scopeTransactionTables(db.motionDramaPromptOverrides, db.motionDramaPromptPacks, db.motionDramaProductions), async () => {
    const [row, production] = await Promise.all([
      db.motionDramaPromptOverrides.where('workId').equals(scope.workId).filter(item => item.stage === input.stage && item.scope === input.overrideScope && item.episodeNumber === episodeNumber).first(),
      db.motionDramaProductions.where('workId').equals(scope.workId).first(),
    ])
    if (!row?.id) return
    if (!production?.id) throw new Error('[motion-drama-prompt] 漫剧生产根不存在')
    await db.motionDramaPromptOverrides.delete(row.id)
    const packs = await db.motionDramaPromptPacks.where('workId').equals(scope.workId).filter(pack => episodeNumber == null || pack.episodeNumber === episodeNumber).toArray()
    await db.motionDramaPromptPacks.bulkDelete(packs.flatMap(pack => pack.id == null ? [] : [pack.id]))
    await db.motionDramaProductions.update(production.id, { revision: production.revision + 1, updatedAt: Date.now() })
  })
}
