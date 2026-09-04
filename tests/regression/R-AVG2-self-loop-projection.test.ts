import { describe, expect, it } from 'vitest'
import { EMPTY_AVG_STAGE } from '../../src/lib/avg/runtime'
import { applyProductRuntimeEvent } from '../../src/lib/product/runtime-api'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRuntimeState } from '../../src/lib/types'

describe('R-AVG2 · same-node visit projection', () => {
  it('同一节点再次进入时重置当前 Beat，并保留全局已读与舞台证据', () => {
    const contentHash = 'a'.repeat(64)
    const state: ProductRuntimeState = {
      ...structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
      narrative: {
        schema: 'storyforge.product-narrative-runtime', version: 2,
        moduleKind: 'main', moduleTitle: '循环场景', sourceHash: contentHash,
        nodes: [{
          key: 'loop', kind: 'scene', title: '信号回廊', summary: '再次检查信号',
          conditionJson: '{}', effectsJson: '[]', successorKeys: ['loop'],
        }],
        currentNodeKey: 'loop', visitedNodeKeys: ['loop', 'loop'], availableNodeKeys: ['loop'],
        variables: {}, completed: false, contentHash,
        beats: [{
          beatKey: 'beat.loop', nodeKey: 'loop', kind: 'narration', speakerKey: null,
          text: '回廊再次响应。', order: 0,
        }],
        choices: [{
          choiceKey: 'choice.loop', sourceNodeKey: 'loop', text: '继续检查', description: '',
          unavailableReason: '', targetNodeKey: 'loop', displayConditionJson: '{}',
          availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
        }],
        visibleChoiceKeys: ['choice.loop'], availableChoiceKeys: ['choice.loop'],
        choiceHistory: [{ eventSequence: 2, choiceKey: 'choice.loop', fromNodeKey: 'loop', toNodeKey: 'loop' }],
        endingKey: null, completedAtSequence: null, lastEnteredNodeSequence: 1,
      },
      presentation: {
        schema: 'storyforge.avg-presentation', version: 1, contentHash,
        assets: [], cues: [], currentNodeKey: 'loop', currentBeatKey: 'beat.loop',
        reachedBeatKeys: ['beat.loop'], readBeatKeys: ['beat.loop'],
        stage: { ...structuredClone(EMPTY_AVG_STAGE), tone: 'cold' },
        snapshots: { 'node:loop:visit:1': { ...structuredClone(EMPTY_AVG_STAGE), tone: 'cold' } },
        mediaFailures: [],
      },
      lastSequence: 2,
    }

    const projected = applyProductRuntimeEvent(state, {
      projectId: 1, sessionId: 1, sequence: 3, type: 'narrative.node.entered',
      actorKey: null, targetKey: 'loop', payloadJson: JSON.stringify({ nodeKey: 'loop', causeSequence: 2 }),
      createdAt: 1,
    })

    expect(projected.presentation).toMatchObject({
      currentNodeKey: 'loop', currentBeatKey: null,
      reachedBeatKeys: ['beat.loop'], readBeatKeys: ['beat.loop'],
      stage: { tone: 'cold' },
    })
    expect(projected.narrative?.lastEnteredNodeSequence).toBe(3)
  })
})
