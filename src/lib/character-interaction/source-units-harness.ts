import {executeFrozenFormalAIEntryV1} from '../agent/formal-ai-entry'
import {createChatSourceRunHarnessV1} from './source-run-harness'
import {readChatSourceUnitsContextV1, readChatSourceUnitsReviewContextV1, validateChatSourceUnitsRequestV1, validateChatSourceUnitsReviewRequestV1,
  type ChatSourceUnitsReviewRequestV1} from './source-units-context'
import type {ChatSourceReviewRequestV1} from './source-review-context'
import {CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1, createChatSourceUnitsArtifactV1, createChatSourceUnitsReviewArtifactV1} from './source-units-candidate'
import {chatSourceUnitsPromptV1} from './source-observation-units'

const generation = createChatSourceRunHarnessV1({
  step: 'chat:source-units', skill: 'chat.source-units.v1', entry: 'chat.source-units', category: 'authoring.chat-source-units',
  kind: 'storyforge.chat-source-units-run', verifier: 'chat-source-units-v1', lockKey: 'chat-source-units',
  prompt: chatSourceUnitsPromptV1, objective: '从完整所选原文提出事实和保留限制候选；不写入作品设置或运行知识',
  criterion: 'source-units.quoted-candidate', writeTargets: [],
  source: {key: 'chat.source-units', options: (request: ChatSourceReviewRequestV1) => ({chatSourceUnitsRequest: request}),
    read: readChatSourceUnitsContextV1, validateRequest: validateChatSourceUnitsRequestV1},
  createArtifact: createChatSourceUnitsArtifactV1, hasCandidate: result => !!result.candidate,
  runModel: ({formalEntry, skill, messages, resolved, scope, signal, result}) => executeFrozenFormalAIEntryV1('chat.source-units', formalEntry, skill,
    'src/lib/character-interaction/source-units-harness.ts', messages, resolved.config,
    {category: 'authoring.chat-source-units', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, signal, result, undefined, resolved),
})
const review = createChatSourceRunHarnessV1({
  step: 'chat:source-units-review', skill: 'chat.source-units-review.v1', entry: 'chat.source-units-review', category: 'authoring.chat-source-units-review',
  kind: 'storyforge.chat-source-units-review-run', verifier: 'chat-source-units-review-v1', lockKey: 'chat-source-units-review',
  prompt: CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1, objective: '独立检查事实候选对完整原文的忠实性、可独立证明性与覆盖；保留否决证据，不自动采纳',
  // This separate run generates a review report; it is not a repair call on the generator's artifact.
  criterion: 'source-units.review-recorded', writeTargets: [],
  source: {key: 'chat.source-units-review', options: (request: ChatSourceUnitsReviewRequestV1) => ({chatSourceUnitsReviewRequest: request}),
    read: readChatSourceUnitsReviewContextV1, validateRequest: validateChatSourceUnitsReviewRequestV1},
  createArtifact: createChatSourceUnitsReviewArtifactV1, hasCandidate: result => !!result.report,
  runModel: ({formalEntry, skill, messages, resolved, scope, signal, result}) => executeFrozenFormalAIEntryV1('chat.source-units-review', formalEntry, skill,
    'src/lib/character-interaction/source-units-harness.ts', messages, resolved.config,
    {category: 'authoring.chat-source-units-review', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, signal, result, undefined, resolved),
})
export const generateChatSourceUnitsV1 = generation.generate
export const readChatSourceUnitsRunV1 = generation.read
export const readLatestChatSourceUnitsRunV1 = generation.latest
export const recoverChatSourceUnitsRunV1 = generation.recover
export const cancelChatSourceUnitsRunV1 = generation.cancel
export const reviewChatSourceUnitsV1 = review.generate
export const readChatSourceUnitsReviewRunV1 = review.read
export const readLatestChatSourceUnitsReviewRunV1 = review.latest
export const recoverChatSourceUnitsReviewRunV1 = review.recover
export const cancelChatSourceUnitsReviewRunV1 = review.cancel
export type ChatSourceUnitsRunViewV1 = Awaited<ReturnType<typeof generation.read>>
export type ChatSourceUnitsReviewRunViewV1 = Awaited<ReturnType<typeof review.read>>
