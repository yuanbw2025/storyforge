import { beforeAll, describe, expect, it } from 'vitest'
import { characterChatBaselineInput } from '../helpers/character-chat-baseline'
import { compileInteractionModulesV1 } from '../../src/lib/product-production/product-module-compilers'
import { createInitialInteractionState, interactionVisibilityView } from '../../src/lib/character-interaction/runtime'

/**
 * Known defects at CHAT-00's baseline. `it.fails` documents a reproduced gap,
 * not a product quality pass. Replace each with an ordinary regression when
 * CHAT-01/02 implements its public production-to-runtime path.
 */
describe('CHAT-00 · source projection failure baseline', () => {
  let compiled: ReturnType<typeof compileInteractionModulesV1>
  let playerKnowledge: string

  beforeAll(() => {
    compiled = compileInteractionModulesV1(characterChatBaselineInput())
    const state = createInitialInteractionState(compiled)
    if (!state) throw new Error('baseline fixture did not initialize')
    playerKnowledge = JSON.stringify(interactionVisibilityView(state, 'player').knowledge)
  })

  it('uses the real compiler and preserves its input', () => {
    const input = characterChatBaselineInput()
    const before = structuredClone(input)
    expect(compileInteractionModulesV1(input).profiles.map(profile => profile.name)).toEqual(['叶岑', '程素'])
    expect(input).toEqual(before)
  })

  it.fails('keeps portable source identities rather than character sequence numbers', () => {
    expect(compiled.profiles.map(profile => profile.characterKey)).toEqual([
      'world-release:character:17', 'world-release:character:42',
    ])
  })

  it.fails('does not make unclassified source summaries public to the player', () => {
    expect(playerKnowledge).not.toContain('密信藏在旧钟底座')
  })

  it.fails('retains authorized character motivation beyond the short summary', () => {
    expect(JSON.stringify(compiled)).toContain('找到失物后向被冤枉的住客公开道歉')
  })

  it.fails('carries the confirmed player identity into the interaction runtime input', () => {
    expect(JSON.stringify(compiled)).toContain('修钟学徒沈禾')
  })

  it.fails('does not turn future ending dialogue into initial public knowledge', () => {
    expect(playerKnowledge).not.toContain('真正拿走物品的是掌柜')
  })
})
