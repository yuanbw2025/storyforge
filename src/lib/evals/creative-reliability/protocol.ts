import type { ChatMessage } from '../../types'
import { normalizeCreativeJsonEnvelopeV1 } from '../../agent/creative-json-normalizer'
import type { CreativeReliabilityFixtureV1 } from './fixtures'

export const CREATIVE_RELIABILITY_BASELINE_PROMPT_VERSION_V1 =
  'crel-story-arc-baseline-direct-v1'
export const CREATIVE_RELIABILITY_GENERATOR_PROMPT_VERSION_V1 = 'outline.story-arcs-v6'
export const CREATIVE_RELIABILITY_REPAIR_PROMPT_VERSION_V1 =
  'crel-story-arc-targeted-repair-v1'
export const CREATIVE_RELIABILITY_VERIFIER_PROMPT_VERSION_V1 =
  'crel-story-arc-independent-verifier-v1'

export interface CreativeReliabilityVerifierAssessmentV1 {
  semanticScore: number
  causalCoherence: number
  specificity: number
  matchedRequiredFactIds: string[]
  missingRequiredFactIds: string[]
  safetyPassed: boolean
  narrativeProgressed: boolean
  infodumpOnly: boolean
}

export function buildCreativeReliabilityBaselineMessagesV1(input: {
  fixture: CreativeReliabilityFixtureV1
  assembledContext: string
}): ChatMessage[] {
  return [{
    role: 'system',
    content: `你是专业长篇小说策划师。根据作者已有材料直接生成一条完整 main 主线故事线。

要求：
1. 包含 3-7 个因果递进阶段。
2. 每阶段包含 title、description 和 1-3 个 keyEvents。
3. 主线必须推进人物目标、阻力、选择和状态变化，不能只复述设定。
4. 只输出严格 JSON，不要 Markdown 或解释：
{"name":"故事线名称","description":"整体描述","stages":[{"title":"阶段标题","description":"阶段描述","keyEvents":["事件"]}]}`,
  }, {
    role: 'user',
    content: [
      `【项目】${input.fixture.projectName}（${input.fixture.genre}）`,
      `【作者已有材料】\n${input.assembledContext || '（暂无正式材料）'}`,
      `【作者要求】\n${input.fixture.authorRequest}`,
    ].join('\n\n'),
  }]
}

export function parseCreativeReliabilityBaselineOutputV1(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? trimmed
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('baseline_output_missing_json')
  const parsed = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>
  if (typeof parsed.name !== 'string' || !parsed.name.trim()) throw new Error('baseline_name_invalid')
  if (typeof parsed.description !== 'string' || !parsed.description.trim()) {
    throw new Error('baseline_description_invalid')
  }
  if (!Array.isArray(parsed.stages) || parsed.stages.length < 3 || parsed.stages.length > 7) {
    throw new Error('baseline_stages_invalid')
  }
  const stages = parsed.stages.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`baseline_stage_${index}_invalid`)
    const stage = item as Record<string, unknown>
    if (
      typeof stage.title !== 'string'
      || !stage.title.trim()
      || typeof stage.description !== 'string'
      || !stage.description.trim()
    ) throw new Error(`baseline_stage_${index}_text_invalid`)
    if (
      !Array.isArray(stage.keyEvents)
      || stage.keyEvents.length < 1
      || stage.keyEvents.length > 3
      || stage.keyEvents.some(event => typeof event !== 'string' || !event.trim())
    ) throw new Error(`baseline_stage_${index}_events_invalid`)
    return {
      title: stage.title.trim(),
      description: stage.description.trim(),
      keyEvents: stage.keyEvents.map(event => String(event).trim()),
      ...(typeof stage.turningPoint === 'string' && stage.turningPoint.trim()
        ? { turningPoint: stage.turningPoint.trim() }
        : {}),
    }
  })
  return JSON.stringify([{
    name: parsed.name.trim(),
    type: 'main',
    description: parsed.description.trim(),
    stages,
  }], null, 2)
}

export function buildCreativeReliabilityVerifierMessagesV1(input: {
  fixture: CreativeReliabilityFixtureV1
  output: string
}): ChatMessage[] {
  const required = input.fixture.requiredFacts
    .map(fact => `${fact.id}: ${fact.description}`)
    .join('\n')
  const forbidden = input.fixture.forbiddenFacts.map(fact => `- ${fact}`).join('\n')
  return [{
    role: 'system',
    content: `你是与生成模型身份独立的中文故事策划评测员。只依据给出的公开材料评分。

评分规则：
- semanticScore：对作者要求和已有材料的整体符合度。
- causalCoherence：阶段之间是否由行动、后果和选择因果推进。
- specificity：是否给出可用于继续写作的具体人物行动和状态变化。
- safetyPassed：不得违反 forbidden facts 或已有硬规则。
- narrativeProgressed：故事确实发生目标、阻力、选择或状态变化。
- infodumpOnly：主体只是介绍或重复设定，没有形成叙事推进。
- required fact 只有被实际落实才算 matched；matched 与 missing 必须完整且不重叠。

只输出严格 JSON，不要解释或额外字段：
{"semanticScore":0.0,"causalCoherence":0.0,"specificity":0.0,"matchedRequiredFactIds":["f1"],"missingRequiredFactIds":["f2"],"safetyPassed":true,"narrativeProgressed":true,"infodumpOnly":false}`,
  }, {
    role: 'user',
    content: `【项目】${input.fixture.projectName}（${input.fixture.genre}）
【世界】${input.fixture.worldOrigin}\n${input.fixture.worldRules}
【故事核心】${input.fixture.theme}\n${input.fixture.centralConflict}\n${input.fixture.logline}\n${input.fixture.mainPlot}
【人物】${JSON.stringify(input.fixture.characters)}
【作者要求】${input.fixture.authorRequest}
【Required facts】\n${required}
【Forbidden facts】\n${forbidden}
【待评产物】\n${input.output || '（没有向作者呈现任何可编辑产物）'}`,
  }]
}

export function parseCreativeReliabilityVerifierAssessmentV1(
  raw: string,
  fixture: CreativeReliabilityFixtureV1,
): CreativeReliabilityVerifierAssessmentV1 {
  const normalized = normalizeCreativeJsonEnvelopeV1(raw)
  if (!normalized.value) {
    throw new Error(normalized.issues[0]?.code ?? 'verifier_json_invalid')
  }
  const parsed = normalized.value
  const expectedKeys = [
    'semanticScore',
    'causalCoherence',
    'specificity',
    'matchedRequiredFactIds',
    'missingRequiredFactIds',
    'safetyPassed',
    'narrativeProgressed',
    'infodumpOnly',
  ]
  if (Object.keys(parsed).sort().join('|') !== expectedKeys.sort().join('|')) {
    throw new Error('verifier_unknown_fields')
  }
  const score = (key: string) => {
    const value = parsed[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`verifier_${key}_invalid`)
    }
    return value
  }
  const ids = (key: string) => {
    const value = parsed[key]
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      throw new Error(`verifier_${key}_invalid`)
    }
    if (new Set(value).size !== value.length) throw new Error(`verifier_${key}_duplicate`)
    return value as string[]
  }
  const bool = (key: string) => {
    const value = parsed[key]
    if (typeof value !== 'boolean') throw new Error(`verifier_${key}_invalid`)
    return value
  }
  const matchedRequiredFactIds = ids('matchedRequiredFactIds')
  const missingRequiredFactIds = ids('missingRequiredFactIds')
  const expected = new Set(fixture.requiredFacts.map(fact => fact.id))
  const returned = [...matchedRequiredFactIds, ...missingRequiredFactIds]
  if (
    returned.length !== expected.size
    || new Set(returned).size !== expected.size
    || returned.some(id => !expected.has(id))
  ) throw new Error('verifier_fact_partition_invalid')
  return {
    semanticScore: score('semanticScore'),
    causalCoherence: score('causalCoherence'),
    specificity: score('specificity'),
    matchedRequiredFactIds,
    missingRequiredFactIds,
    safetyPassed: bool('safetyPassed'),
    narrativeProgressed: bool('narrativeProgressed'),
    infodumpOnly: bool('infodumpOnly'),
  }
}
