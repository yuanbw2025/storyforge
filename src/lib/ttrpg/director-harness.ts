import { captureTtrpgDirectorViewV1, parseTtrpgDirectorOutputV1 } from './director-context'
import { generateTtrpgDecisionV1, adoptTtrpgDecisionV1, type TtrpgDecisionInputV1, type TtrpgDecisionProtocolV1 } from './decision-harness'
import type { TtrpgDirectorPlanV1 } from './director-model'
import { commitTtrpgDirectorFromHarnessV1 } from './runtime-api'

export const TTRPG_DIRECTOR_PROTOCOL_V1: TtrpgDecisionProtocolV1<TtrpgDirectorPlanV1, Awaited<ReturnType<typeof captureTtrpgDirectorViewV1>>['view']> = {
  kind: 'director', skillId: 'prose.ttrpg-director', sourceKey: 'ttrpgDirector',
  systemPrompt: [
    '你是主持整场游戏的 AI KP。依据当前行动、角色知情范围、未解决目标和冻结线索路径，决定现在应该揭示什么、提供哪些去向。',
    '你读取的 GM 资料包含秘密。输出只能是引用已有 key 的结构化决策，绝不输出任何叙事、秘密文本、骰点或新事实。',
    'revealClueKeys 最多一个，只能从 options.eligibleReveals 选择。优先回应玩家刚才实际调查的对象；满足发现条件时应提供有用线索，失败也按已冻结 failForward 推进，不能为了拖延而藏住必需信息。',
    'recommendedSceneKeys 只能从 options.nextScenes 选择。玩家仍有未调查的入口时保留调查空间；选择何时离开及走哪条路属于真人玩家，不能代替其决定。',
    'recommendedEndingKeys 只能从 options.eligibleEndings 选择。没有可用结局时不得结束。以完成玩家目标与合理后果为导向，避免无意义循环。',
    'pacing 只能是 investigate、discuss、move、conclude。move 需要至少一个后继场景；conclude 需要至少一个已满足条件的结局。',
    '仅输出严格 JSON：{"revealClueKeys":[],"recommendedSceneKeys":[],"recommendedEndingKeys":[],"pacing":"investigate"}',
  ].join('\n'),
  capture: captureTtrpgDirectorViewV1,
  parse: parseTtrpgDirectorOutputV1,
  commit: ({ scope, candidate }) => commitTtrpgDirectorFromHarnessV1({ scope, runId: candidate.runId, candidateHash: candidate.candidateHash }),
}
export const generateTtrpgDirectorDecisionV1 = (input: TtrpgDecisionInputV1) => generateTtrpgDecisionV1(TTRPG_DIRECTOR_PROTOCOL_V1, input)
export const adoptTtrpgDirectorDecisionV1 = (input: Parameters<typeof adoptTtrpgDecisionV1>[1]) => adoptTtrpgDecisionV1(TTRPG_DIRECTOR_PROTOCOL_V1, input)
