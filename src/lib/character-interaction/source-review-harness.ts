import {executeFrozenFormalAIEntryV1} from '../agent/formal-ai-entry'
import {createChatSourceRunHarnessV1, type ChatSourceRunBoundaryV1, type ChatSourceRunViewV1} from './source-run-harness'
import {CHAT_SOURCE_REVIEW_PROMPT_V1, createChatSourceSuggestionsArtifactV1} from './source-review-suggestions'

const harness = createChatSourceRunHarnessV1({
  step: 'chat:source-review', skill: 'chat.source-review.v1', entry: 'chat.source-review', category: 'authoring.chat-source-review',
  kind: 'storyforge.chat-source-review-run', verifier: 'chat-source-review-v1', lockKey: 'chat-source-review',
  prompt: CHAT_SOURCE_REVIEW_PROMPT_V1, objective: '解释作者选中的角色聊天原文，提供带逐字引用的用途与风险建议；不修改资料或知情范围',
  criterion: 'source-review.grounded-quotes', writeTargets: [], createArtifact: createChatSourceSuggestionsArtifactV1, hasCandidate: result => !!result.suggestions,
  runModel: ({formalEntry, skill, messages, resolved, scope, signal, result}) => executeFrozenFormalAIEntryV1('chat.source-review', formalEntry, skill,
    'src/lib/character-interaction/source-review-harness.ts', messages, resolved.config,
    {category: 'authoring.chat-source-review', projectId: scope.projectId, contextOverflowPolicy: 'reject'}, signal, result, undefined, resolved),
})
export type ChatSourceReviewBoundaryV1 = ChatSourceRunBoundaryV1
export type ChatSourceReviewRunViewV1 = ChatSourceRunViewV1<ReturnType<typeof createChatSourceSuggestionsArtifactV1>>
export const generateChatSourceReviewSuggestionsV1 = harness.generate
export const readChatSourceReviewRunV1 = harness.read
export const readLatestChatSourceReviewRunV1 = harness.latest
export const recoverChatSourceReviewRunV1 = harness.recover
export const cancelChatSourceReviewRunV1 = harness.cancel
