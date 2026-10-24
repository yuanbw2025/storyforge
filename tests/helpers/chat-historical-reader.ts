import {vi} from 'vitest'
import * as runtime from '../../src/lib/character-interaction/runtime'
import * as coordinator from '../../src/lib/character-interaction/coordinator-selection'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import * as skills from '../../src/lib/agent/skill-registry'
import {chatRetrievalVersionForReader, type ChatRetrievalVersion} from '../../src/lib/character-interaction/context-selection'

/** Historical-reader cases predate action choice. Freeze the original two-step
 * producer too; a current choice contract must never accept old Gateway bytes. */
export function freezeLegacyChatActionContractFixture() {
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action'
    ? {...original(id), promptVersion: 'chat-narrative-action-v44'} : original(id))
}

/** Reader v11 was released with producer v12 / reviewer v11 (38ba906b).
 * Keep that complete contract, not today's inquiry/audience policy with an old label. */
export function freezeLegacyChatSituationContractFixture() {
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-situation-construction'
    ? {...original(id), promptVersion: 'chat-situation-construction-v12'} : id === 'character.chat-situation-review'
      ? {...original(id), promptVersion: 'chat-situation-review-v11'} : original(id))
}

/** Produce the actual old bytes and identity, not a new packet relabeled old. */
export function useHistoricalChatReaderFixture(reader: string, situationVersion?: ChatRetrievalVersion) {
  if (situationVersion) {
    if (reader !== 'chat-situation-runtime-view-v11' || situationVersion !== 'chat-relevance-v5') throw new Error('Unsupported historical situation fixture')
    freezeLegacyChatSituationContractFixture()
  }
  const create = manifests.createContextManifestFromAssemblyV1
  vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => create({...input,
    readerVersion: input.readerVersion === (situationVersion ? 'chat-situation-runtime-view-v15' : 'chat-narrative-runtime-view-v14') ? reader : input.readerVersion}))
  if (situationVersion) {
    const select = coordinator.selectChatCoordinatorContextV1
    vi.spyOn(coordinator, 'projectChatCoordinatorContextV1').mockImplementation((state, candidate = {text: ''}) => ({text: select(state, {...candidate, retrievalVersion: situationVersion}), selection: undefined}))
    vi.spyOn(coordinator, 'selectChatCoordinatorContextV1').mockImplementation((state, candidate = {text: ''}) => select(state, {...candidate, retrievalVersion: situationVersion}))
  } else {
    freezeLegacyChatActionContractFixture()
    const build = runtime.buildInteractionContextWindow, retrievalVersion = chatRetrievalVersionForReader(reader)!
    vi.spyOn(runtime, 'buildInteractionContextWindow').mockImplementation((state, actor, options = {}) => build(state, actor, {...options, retrievalVersion}))
  }
}
