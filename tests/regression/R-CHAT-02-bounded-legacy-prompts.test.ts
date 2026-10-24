import {it, expect} from 'vitest'
import {createHash} from 'node:crypto'
import expected from '../fixtures/character-chat-bounded-legacy-prompts.json'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {readProductRuntimeState} from '../../src/lib/character-interaction/runtime-api'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import * as current from '../../src/lib/character-interaction/narrative-action-prompt'
import * as scope from '../../src/lib/character-interaction/observation-scope-prompt'
it('compares all previous current prompt bytes with the exact frozen HEAD source', async () => {
  db.close(); await db.delete(); await db.open()
  const f = await seedChatNarrativeRuntimeFixture({factDiscovery: true})
  const view = interactionVisibilityView((await readProductRuntimeState(f.sessionId)).interaction!, 'guard')
  const hashes: Record<string, string> = {}, hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
  for (const producerVersion of ['chat-narrative-action-v57','chat-narrative-options-v35','chat-action-revision-v21']) {
    const before = current.chatActionPromptRulesV1(view,{producerVersion})
    hashes[producerVersion]=hash(before)
  }
  for (const reviewerVersion of ['chat-narrative-action-review-v36','chat-narrative-options-review-v26']) {
    const args = {actions: [],options: reviewerVersion.includes('options'),compact:false,reviewerVersion}
    const before = current.chatActionReviewPromptRulesV1(args)
    hashes[reviewerVersion]=hash(before)
  }
  const gen=scope.chatObservationScopeGenerationRulesV1('chat-situation-construction-v15')
  const rev=scope.chatObservationScopeReviewRulesV1('chat-situation-review-v14')
  hashes['chat-situation-construction-v15']=hash(gen);hashes['chat-situation-review-v14']=hash(rev)
  expect(hashes).toEqual(expected)
  db.close()
})
