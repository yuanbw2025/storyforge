import type {
  LongConsistencyEvalTaskV1,
  LongConsistencyIntentClassificationV1,
  LongConsistencyReportSourceInputV1,
  LongConsistencySeverityV1,
} from './report-types'
import {
  LONG_CONSISTENCY_SUBTYPES_V1,
  type LongConsistencySubtypeV1,
} from './taxonomy'
import type { EvalSplit } from './types'

export const H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1 = 'h4-synthetic-zh-60-v1'
export const H4_LONG_CONSISTENCY_MIN_CHARS_V1 = 8_000
export const H4_LONG_CONSISTENCY_MAX_CHARS_V1 = 12_000

export type H4EvidencePlacementV1 = 'middle' | 'distant'

export interface H4LongConsistencyExpectedIssueV1 {
  id: string
  subtype: LongConsistencySubtypeV1
  severity: LongConsistencySeverityV1
  intentClassification: LongConsistencyIntentClassificationV1
  summary: string
  factEvidence: { sourceId: string; quote: string }
  contradictionEvidence: { sourceId: string; quote: string }
}

export interface H4LongConsistencyFixtureV1 {
  schemaVersion: 1
  fixtureVersion: typeof H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1
  id: string
  split: EvalSplit
  task: LongConsistencyEvalTaskV1
  title: string
  modelInput: {
    instruction: string
    targetChineseChars: { min: number; max: number }
  }
  sources: LongConsistencyReportSourceInputV1[]
  hiddenLabels: {
    cleanControl: boolean
    evidencePlacement: H4EvidencePlacementV1
    expectedIssues: H4LongConsistencyExpectedIssueV1[]
    factPositionRatio: number | null
    contradictionPositionRatio: number | null
    evidenceDistanceRatio: number | null
  }
}

export type H4LongConsistencyModelVisibleFixtureV1 = Omit<H4LongConsistencyFixtureV1, 'hiddenLabels'>

interface CaseContext {
  index: number
  protagonist: string
  ally: string
  place: string
  destination: string
  artifact: string
}

interface ConflictSeed {
  factQuote: string
  contradictionQuote: string
  summary: string
}

const PROTAGONISTS = ['苏禾', '林砚', '周弦', '叶闻', '祁照', '沈遥', '顾岑', '许澜', '孟川', '陆停'] as const
const ALLIES = ['白榆', '宁朔', '闻秋', '简青', '唐雾', '秦川', '乔音', '段星', '温徊', '楚岚'] as const
const PLACES = ['月井城', '雾港', '雨档库', '盐脊关', '潮门镇', '镜湖堡', '风塔郡', '灰桥城', '星砂原', '雪钟岛'] as const
const DESTINATIONS = ['北塔', '南港', '旧王庭', '沉舟湾', '白石驿', '赤藤谷', '西海门', '东岸台', '地下档库', '高墙议厅'] as const
const ARTIFACTS = ['青铜铃', '月井钥', '黑盐牌', '旧星图', '双层铜环', '雨纹匣', '白瓷杯', '赤铜楔', '折纸鸟', '青玉签'] as const

function contextFor(index: number): CaseContext {
  return {
    index,
    protagonist: PROTAGONISTS[index % PROTAGONISTS.length],
    ally: ALLIES[(index * 3 + 1) % ALLIES.length],
    place: PLACES[(index * 7 + 2) % PLACES.length],
    destination: DESTINATIONS[(index * 5 + 3) % DESTINATIONS.length],
    artifact: ARTIFACTS[(index * 3 + 4) % ARTIFACTS.length],
  }
}

const CONFLICT_BUILDERS: Record<LongConsistencySubtypeV1, (context: CaseContext) => ConflictSeed> = {
  'absolute-time-contradiction': context => ({
    factQuote: `${context.artifact}的启封日被定在霜月十二日`,
    contradictionQuote: `守门日志却写着${context.artifact}已在霜月十日完成启封`,
    summary: '同一事件的绝对日期前后冲突。',
  }),
  'duration-contradiction': context => ({
    factQuote: `从${context.place}到${context.destination}至少需要连续航行七天`,
    contradictionQuote: `${context.protagonist}清晨才离开${context.place}，当晚便抵达了${context.destination}`,
    summary: '明确的最短航程与实际耗时冲突。',
  }),
  'simultaneity-contradiction': context => ({
    factQuote: `正午钟响时，${context.protagonist}正在${context.destination}独自值守`,
    contradictionQuote: `同一记正午钟声里，${context.protagonist}亲自在${context.place}主持了宣誓`,
    summary: '同一角色在同一时刻出现在两个地点。',
  }),
  'causeless-effect': context => ({
    factQuote: `石门只有嵌入${context.artifact}才会开启`,
    contradictionQuote: `无人靠近石门，${context.artifact}也仍在匣中，门扇却自行敞开`,
    summary: '结果在唯一必要原因未发生时出现。',
  }),
  'causal-logic-violation': context => ({
    factQuote: `只有点燃北塔烽火，${context.place}的警钟才会鸣响`,
    contradictionQuote: `${context.place}的警钟先响遍全城，半个时辰后${context.protagonist}才点燃北塔烽火`,
    summary: '结果先于其声明的唯一原因发生。',
  }),
  'abandoned-plot-element': context => ({
    factQuote: `${context.protagonist}必须在三夜内归还${context.artifact}，否则海墙会沉没`,
    contradictionQuote: `第十夜过去，${context.artifact}仍未归还，众人却再也没有提起海墙的期限`,
    summary: '具有明确后果与期限的情节要素被无解释遗弃。',
  }),
  'memory-contradiction': context => ({
    factQuote: `${context.protagonist}清楚记得${context.ally}在旧王庭交给自己的暗号`,
    contradictionQuote: `${context.protagonist}随后断言自己从未听过${context.ally}的暗号`,
    summary: '角色对同一已记忆信息作出相反陈述。',
  }),
  'knowledge-contradiction': context => ({
    factQuote: `密令只告诉了${context.protagonist}，${context.ally}尚未得到任何线索`,
    contradictionQuote: `无人传话之前，${context.ally}已经逐字说出了那道密令`,
    summary: '角色在没有信息来源时掌握了受限知识。',
  }),
  'skill-fluctuation': context => ({
    factQuote: `${context.protagonist}自幼不会游水，落水后只能依靠别人救援`,
    contradictionQuote: `没有训练或外力帮助，${context.protagonist}独自游过了湍急的镜河`,
    summary: '角色技能无发展依据地发生反转。',
  }),
  'forgotten-ability': context => ({
    factQuote: `${context.protagonist}已经熟练掌握听风术，能隔墙辨认脚步`,
    contradictionQuote: `隔墙脚步逼近时，${context.protagonist}表示自己没有任何办法判断来者`,
    summary: '既有能力在关键场景中被无解释遗忘。',
  }),
  'core-rules-violation': context => ({
    factQuote: `${context.place}的铁律规定太阳升起后任何人都无法使用影渡`,
    contradictionQuote: `正午阳光最盛时，${context.protagonist}踏入影子完成了一次影渡`,
    summary: '行动直接违反已建立的世界核心规则。',
  }),
  'social-norms-violation': context => ({
    factQuote: `${context.place}的臣民面见议长必须摘下面具，否则会被立即驱逐`,
    contradictionQuote: `${context.protagonist}戴着完整面具走进议厅，卫士和议长都视若无睹`,
    summary: '明确且强制的社会规范被无解释忽略。',
  }),
  'geographical-contradiction': context => ({
    factQuote: `${context.destination}位于${context.place}正西方，沿落日方向才能抵达`,
    contradictionQuote: `${context.protagonist}从${context.place}一路向东，最终抵达了${context.destination}`,
    summary: '稳定地理方位与实际行进方向冲突。',
  }),
  'appearance-mismatch': context => ({
    factQuote: `${context.ally}的左眼是蓝色，右眼是金色`,
    contradictionQuote: `${context.protagonist}看见${context.ally}抬起一双漆黑的眼睛`,
    summary: '同一角色的稳定外貌细节前后冲突。',
  }),
  'nomenclature-confusion': context => ({
    factQuote: `${context.artifact}是那艘渡船的名字，而${context.destination}是岸上的堡垒`,
    contradictionQuote: `${context.protagonist}登上名为${context.destination}的渡船，把岸边堡垒称作${context.artifact}`,
    summary: '两个已定义专名的指代被互换。',
  }),
  'quantitative-mismatch': context => ({
    factQuote: `${context.protagonist}出发时只带了三瓶蓝药`,
    contradictionQuote: `${context.protagonist}用掉第四瓶蓝药后，袋中还剩一瓶`,
    summary: '物品初始数量与消耗后的数量不可能同时成立。',
  }),
  'perspective-confusion': context => ({
    factQuote: `我把${context.artifact}藏进衣袖，决定不让任何人知道`,
    contradictionQuote: `${context.protagonist}并不知道，此刻${context.ally}心里正盘算着背叛他的计划`,
    summary: '第一人称限制视角无过渡地切入他人内心。',
  }),
  'tone-inconsistency': _context => ({
    factQuote: `送葬全程保持克制肃穆，没有人说笑或喧哗`,
    contradictionQuote: `棺木尚未落地，众人便用夸张笑话互相取乐，场面像一出滑稽闹剧`,
    summary: '同一场景的基调无叙事依据地突变。',
  }),
  'style-shift': context => ({
    factQuote: `叙述始终使用完整的过去时散文，细致描写${context.place}的潮湿空气`,
    contradictionQuote: `场景：${context.destination}。人物：${context.protagonist}。动作：举起${context.artifact}。切黑。`,
    summary: '正文无说明地从散文切换成剧本提要格式。',
  }),
}

const FILLER_BUILDERS = [
  (context: CaseContext, index: number) => `${context.protagonist}沿着潮湿的石阶继续前行。第${index + 1}段路旁的灯罩积着薄盐，守夜人只核对通行签，没有谈论远方的传闻。${context.ally}把沿途见闻记在纸边，提醒同伴先完成眼前的交接，再讨论尚未发生的计划。`,
  (context: CaseContext, index: number) => `${context.place}的清晨从低沉钟声开始。第${index + 1}次回声越过屋脊时，摊贩依次支起雨棚，巡守按旧路线检查门锁。${context.protagonist}观察人群的去向，却没有据此猜测任何人的秘密，只把亲眼所见写进当天记录。`,
  (context: CaseContext, index: number) => `风从${context.destination}方向吹来，携着木屑和水汽。${context.ally}在第${index + 1}页地图上补了一条普通街巷，确认道路仍可通行。两人商量下一处落脚点，所有决定都依据已经获得的消息，没有提前知道后续安排。`,
  (context: CaseContext, index: number) => `${context.protagonist}在驿站停留片刻，检查随身衣物和封好的食盒。第${index + 1}班驿车按时离开，车夫只谈天气与路况。关于${context.artifact}的保管方式没有变化，同行者也没有擅自触碰它。`,
  (context: CaseContext, index: number) => `傍晚的市场逐渐安静，铺面把账册收进木柜。${context.ally}完成第${index + 1}项寻常采购后回到约定地点，向${context.protagonist}复述公开告示。两人的认知都没有超出现场信息，行动顺序也与当天日程一致。`,
  (context: CaseContext, index: number) => `雨水顺着${context.place}的檐角落下，石板路反射出稳定的灯光。第${index + 1}轮巡逻经过时，${context.protagonist}侧身让路，随后继续整理旧档。页码、署名和封蜡都保持原状，没有出现需要额外解释的变化。`,
  (context: CaseContext, index: number) => `${context.destination}外的河面平缓，渡船依照公告靠岸。${context.ally}数到第${index + 1}根系船桩后停下，等待守门人确认。${context.protagonist}没有越过封锁，也没有使用尚未获得的工具，片刻后两人按原路返回。`,
  (context: CaseContext, index: number) => `夜色加深时，${context.protagonist}把当天发生的事情按先后写成第${index + 1}则记录。文字只涉及已经见到的人和已经到达的地点。${context.ally}核对后补充一处天气细节，没有改动人物身份、时间、数量或既定规则。`,
] as const

function fillerParagraph(context: CaseContext, index: number): string {
  return FILLER_BUILDERS[index % FILLER_BUILDERS.length](context, index)
}

function intentFor(split: EvalSplit, subtype: LongConsistencySubtypeV1, round: number) {
  if (split === 'development' && round === 1 && subtype === 'perspective-confusion') return 'intentional' as const
  if (split === 'development' && round === 1 && subtype === 'memory-contradiction') return 'ambiguous' as const
  if (split === 'held-out' && subtype === 'tone-inconsistency') return 'intentional' as const
  if (split === 'held-out' && subtype === 'knowledge-contradiction') return 'ambiguous' as const
  return 'unintentional' as const
}

function authorIntentSource(
  fixtureId: string,
  intent: LongConsistencyIntentClassificationV1,
  subtype: LongConsistencySubtypeV1,
): LongConsistencyReportSourceInputV1 | null {
  if (intent === 'intentional') {
    return {
      id: `author-intent:${fixtureId}`,
      kind: 'author-intent',
      content: subtype === 'perspective-confusion'
        ? '作者说明：这里会短暂切换到全知旁白，让读者先于第一人称叙述者知道背叛计划，这是有意设计的戏剧性反差。'
        : '作者说明：送葬段落故意转为荒诞黑色幽默，用突兀笑声表现人物对死亡的逃避，并非遗漏前文基调。',
    }
  }
  if (intent === 'ambiguous') {
    return {
      id: `author-intent:${fixtureId}`,
      kind: 'author-intent',
      content: '作者批注：此处可能是角色撒谎、记忆受损或另有未揭示的信息来源，也可能是写作遗漏；当前证据不足，尚未决定。',
    }
  }
  return null
}

function buildLongNarrative(input: {
  context: CaseContext
  seed?: ConflictSeed
  placement: H4EvidencePlacementV1
  cleanControl: boolean
}): { content: string; factRatio: number | null; contradictionRatio: number | null; distanceRatio: number | null } {
  const totalSlots = 84
  const factSlot = 8
  const contradictionSlot = input.placement === 'middle' ? 43 : 78
  const paragraphs: string[] = []
  for (let index = 0; index < totalSlots; index += 1) {
    if (!input.cleanControl && input.seed && index === factSlot) {
      paragraphs.push(`${input.context.ally}在整理旧档时读出一条已经确认的记录：${input.seed.factQuote}。${input.context.protagonist}复核封印与署名后，把它当作后续行动的共同前提。`)
    } else if (!input.cleanControl && input.seed && index === contradictionSlot) {
      paragraphs.push(`队伍继续推进后，现场记录出现了新的明确叙述：${input.seed.contradictionQuote}。在场者没有提出伪装、梦境、转述错误或规则例外，叙事也没有给出修正说明。`)
    } else {
      paragraphs.push(fillerParagraph(input.context, index))
    }
  }
  if (input.cleanControl) {
    paragraphs.splice(factSlot, 0, `${input.context.ally}确认${input.context.artifact}一直封存在内袋中，${input.context.protagonist}只在清点时隔着布料检查封口。`)
    paragraphs.splice(contradictionSlot, 0, `抵达${input.context.destination}后，${input.context.protagonist}再次检查内袋，封口、数量和保管人都与出发时一致。`)
  }
  let content = paragraphs.join('\n\n')
  let fillerIndex = totalSlots
  while (content.length < H4_LONG_CONSISTENCY_MIN_CHARS_V1 + 300) {
    content += `\n\n${fillerParagraph(input.context, fillerIndex)}`
    fillerIndex += 1
  }
  const factOffset = input.seed ? content.indexOf(input.seed.factQuote) : -1
  const contradictionOffset = input.seed ? content.indexOf(input.seed.contradictionQuote) : -1
  return {
    content,
    factRatio: factOffset < 0 ? null : factOffset / content.length,
    contradictionRatio: contradictionOffset < 0 ? null : contradictionOffset / content.length,
    distanceRatio: factOffset < 0 || contradictionOffset < 0
      ? null
      : Math.abs(contradictionOffset - factOffset) / content.length,
  }
}

function taskInstruction(task: LongConsistencyEvalTaskV1, context: CaseContext): string {
  const shared = `保持人物认知、时序、地理、物品数量、世界规则和叙事视角一致，目标为 8,000 至 12,000 个中文字符。`
  if (task === 'generation') return `以${context.place}的档案交接为起点，创作一篇完整故事。${shared}`
  if (task === 'continuation') return `续写${context.protagonist}与${context.ally}进入${context.place}后的故事，形成完整后续。${shared}`
  if (task === 'expansion') return `把“二人护送${context.artifact}前往${context.destination}”扩展成长篇故事。${shared}`
  return `补全${context.protagonist}从${context.place}出发到抵达${context.destination}之间的故事，不改动既定开头与结局。${shared}`
}

function buildConflictFixture(input: {
  split: EvalSplit
  subtype: LongConsistencySubtypeV1
  round: number
  splitIndex: number
}): H4LongConsistencyFixtureV1 {
  const globalIndex = (input.split === 'development' ? 0 : 40) + input.splitIndex
  const context = contextFor(globalIndex)
  const task = ['generation', 'continuation', 'expansion', 'completion'][input.splitIndex % 4] as LongConsistencyEvalTaskV1
  const placement: H4EvidencePlacementV1 = input.splitIndex % 2 === 0 ? 'middle' : 'distant'
  const intentClassification = intentFor(input.split, input.subtype, input.round)
  const seed = CONFLICT_BUILDERS[input.subtype](context)
  const id = `h4-${input.split === 'development' ? 'dev' : 'held'}-${String(input.splitIndex + 1).padStart(2, '0')}`
  const narrative = buildLongNarrative({ context, seed, placement, cleanControl: false })
  const narrativeSourceId = `narrative:${id}`
  const intentSource = authorIntentSource(id, intentClassification, input.subtype)
  return {
    schemaVersion: 1,
    fixtureVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    id,
    split: input.split,
    task,
    title: `${context.place}档案：${context.artifact}`,
    modelInput: {
      instruction: taskInstruction(task, context),
      targetChineseChars: {
        min: H4_LONG_CONSISTENCY_MIN_CHARS_V1,
        max: H4_LONG_CONSISTENCY_MAX_CHARS_V1,
      },
    },
    sources: [{ id: narrativeSourceId, kind: 'narrative', content: narrative.content }, ...(intentSource ? [intentSource] : [])],
    hiddenLabels: {
      cleanControl: false,
      evidencePlacement: placement,
      expectedIssues: [{
        id: `${id}:issue-1`,
        subtype: input.subtype,
        severity: input.subtype === 'tone-inconsistency' || input.subtype === 'style-shift' ? 'medium' : 'high',
        intentClassification,
        summary: seed.summary,
        factEvidence: { sourceId: narrativeSourceId, quote: seed.factQuote },
        contradictionEvidence: { sourceId: narrativeSourceId, quote: seed.contradictionQuote },
      }],
      factPositionRatio: narrative.factRatio,
      contradictionPositionRatio: narrative.contradictionRatio,
      evidenceDistanceRatio: narrative.distanceRatio,
    },
  }
}

function buildCleanFixture(split: EvalSplit, splitIndex: number): H4LongConsistencyFixtureV1 {
  const globalIndex = (split === 'development' ? 0 : 40) + splitIndex
  const context = contextFor(globalIndex)
  const task = ['generation', 'continuation', 'expansion', 'completion'][splitIndex % 4] as LongConsistencyEvalTaskV1
  const placement: H4EvidencePlacementV1 = splitIndex % 2 === 0 ? 'middle' : 'distant'
  const id = `h4-${split === 'development' ? 'dev' : 'held'}-${String(splitIndex + 1).padStart(2, '0')}`
  const narrative = buildLongNarrative({ context, placement, cleanControl: true })
  return {
    schemaVersion: 1,
    fixtureVersion: H4_LONG_CONSISTENCY_FIXTURE_VERSION_V1,
    id,
    split,
    task,
    title: `${context.place}档案：${context.artifact}`,
    modelInput: {
      instruction: taskInstruction(task, context),
      targetChineseChars: {
        min: H4_LONG_CONSISTENCY_MIN_CHARS_V1,
        max: H4_LONG_CONSISTENCY_MAX_CHARS_V1,
      },
    },
    sources: [{ id: `narrative:${id}`, kind: 'narrative', content: narrative.content }],
    hiddenLabels: {
      cleanControl: true,
      evidencePlacement: placement,
      expectedIssues: [],
      factPositionRatio: null,
      contradictionPositionRatio: null,
      evidenceDistanceRatio: null,
    },
  }
}

function buildCatalog(): H4LongConsistencyFixtureV1[] {
  const development = [0, 1].flatMap(round => LONG_CONSISTENCY_SUBTYPES_V1.map((subtype, subtypeIndex) => (
    buildConflictFixture({
      split: 'development',
      subtype,
      round,
      splitIndex: round * LONG_CONSISTENCY_SUBTYPES_V1.length + subtypeIndex,
    })
  )))
  development.push(buildCleanFixture('development', 38), buildCleanFixture('development', 39))
  const heldOut = LONG_CONSISTENCY_SUBTYPES_V1.map((subtype, splitIndex) => buildConflictFixture({
    split: 'held-out',
    subtype,
    round: 2,
    splitIndex,
  }))
  heldOut.push(buildCleanFixture('held-out', 19))
  return [...development, ...heldOut]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

export const H4_LONG_CONSISTENCY_FIXTURES_V1: readonly H4LongConsistencyFixtureV1[] = deepFreeze(buildCatalog())

export function getH4LongConsistencyFixturesV1(split: EvalSplit): H4LongConsistencyFixtureV1[] {
  return H4_LONG_CONSISTENCY_FIXTURES_V1.filter(fixture => fixture.split === split)
}

export function toH4ModelVisibleFixtureV1(
  fixture: H4LongConsistencyFixtureV1,
): H4LongConsistencyModelVisibleFixtureV1 {
  const { hiddenLabels: _hiddenLabels, ...visible } = fixture
  return structuredClone(visible)
}
