import { describe, expect, it } from 'vitest'
import { deriveTextOpenWorldAudioSlotDemandsV1 } from '../../src/lib/open-world/system-finalize-production'
import type { TextOpenWorldGameBriefV1 } from '../../src/lib/types'

const HASH = 'a'.repeat(64)

function media(audioLevel: TextOpenWorldGameBriefV1['media']['audioLevel']): TextOpenWorldGameBriefV1['media'] {
  return {
    visualLevel: 'key-scenes', audioLevel, imageCount: 2,
    musicTrackCount: audioLevel === 'none' ? 0 : 1,
    sfxCount: audioLevel === 'none' ? 0 : audioLevel === 'music-sfx' ? 3 : 8,
    voiceLineCount: 0,
    requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
    textFallbackRequired: true,
  }
}

function derive(audioLevel: TextOpenWorldGameBriefV1['media']['audioLevel']) {
  return deriveTextOpenWorldAudioSlotDemandsV1({
    productInstanceKey: 'game.salt-ridge', media: media(audioLevel), audioLevel,
    presentationProfileHash: HASH, toneGuide: ['边地悬疑', '克制'],
    scenes: [{ key: 'scene.harbor', title: '雾港潮门', purpose: '调查潮门异响', openingText: '盐钟在雾里停了一拍。' }],
    actors: [{ key: 'actor.linzho', name: '林舟', portrayal: '克制而警觉' }],
  })
}

describe('R-OPEN-WORLD3 · P10音频槽与生产Plan计数同源', () => {
  it('none、music-sfx、full分别生成0、4、9个可追溯槽位', () => {
    expect(derive('none')).toEqual([])
    const musicSfx = derive('music-sfx')
    expect(musicSfx).toHaveLength(4)
    expect(musicSfx.map(slot => slot.kind)).toEqual(['music', 'sound-effect', 'sound-effect', 'sound-effect'])
    expect(new Set(musicSfx.map(slot => slot.key)).size).toBe(4)
    expect(musicSfx.every(slot => slot.fallback === 'silent')).toBe(true)

    const full = derive('full')
    expect(full).toHaveLength(9)
    expect(full.filter(slot => slot.kind === 'music')).toHaveLength(1)
    expect(full.filter(slot => slot.kind === 'sound-effect')).toHaveLength(8)
  })

  it('表现档位与冻结GameBrief计数不一致时失败关闭', () => {
    expect(() => deriveTextOpenWorldAudioSlotDemandsV1({
      productInstanceKey: 'game.salt-ridge', media: media('music-sfx'), audioLevel: 'none',
      presentationProfileHash: HASH, toneGuide: ['边地悬疑'],
      scenes: [{ key: 'scene.harbor', title: '雾港潮门', purpose: '调查', openingText: '盐钟停摆。' }],
      actors: [{ key: 'actor.linzho', name: '林舟', portrayal: '警觉' }],
    })).toThrow(/音频档位不一致/)
  })
})
