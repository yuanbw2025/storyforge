import { describe, expect, it } from 'vitest'
import { analyzeDecodedProductAudioPcmV1 } from '../../src/lib/product-production/audio-quality-analyzer'
import {
  evaluateProductMediaCommercialPolicyV2,
  PRODUCT_COMMERCIAL_MEDIA_POLICY_V2,
} from '../../src/lib/product-production/media-quality-policy'
import type { ProductRuntimePackageV1 } from '../../src/lib/types'

function sine(input: { amplitude: number; seconds: number; frequency?: number; sampleRate?: number }): Float32Array {
  const sampleRate = input.sampleRate ?? 48_000
  const frequency = input.frequency ?? 1_000
  return Float32Array.from(
    { length: Math.round(sampleRate * input.seconds) },
    (_, index) => Math.sin(2 * Math.PI * frequency * index / sampleRate) * input.amplitude,
  )
}

function runtimeWithAsset(asset: NonNullable<ProductRuntimePackageV1['presentation']>['assets'][number], loop = false): ProductRuntimePackageV1 {
  return {
    presentation: {
      version: 1,
      assets: [asset],
      cues: asset.mimeType.startsWith('audio/') ? [{
        cueKey: `cue.${asset.assetKey}`, beatKey: 'beat.opening', phase: 'before', type: 'play-audio',
        assetKey: asset.assetKey, durationMs: 0, easing: 'linear', volume: 0.7, loop, order: 0,
      }] : [],
    },
  } as ProductRuntimePackageV1
}

function imageProbe(assetKey: string, decodedHasAlpha = false) {
  return {
    assetKey, status: 'decoded' as const, decodedHasAlpha,
    decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null,
    truePeakDbtp: null, loopSeamDbfs: null,
  }
}

describe('R-PRODUCTPROD-1F · commercial media quality analyzers', () => {
  it('对浏览器解码后的精确 PCM 计算版本化 LUFS、true peak 与循环接缝', () => {
    const channel = sine({ amplitude: 0.16, seconds: 2 })
    const analysis = analyzeDecodedProductAudioPcmV1({ channels: [channel, channel], sampleRateHz: 48_000 })
    expect(analysis).toMatchObject({ channelCount: 2, sampleRateHz: 48_000, durationMs: 2_000 })
    expect(analysis.integratedLufs).toBeGreaterThan(-22)
    expect(analysis.integratedLufs).toBeLessThan(-14)
    expect(analysis.truePeakDbtp).toBeLessThan(-10)
    expect(analysis.loopSeamDbfs).toBeLessThan(-45)

    expect(() => analyzeDecodedProductAudioPcmV1({
      channels: [new Float32Array([0, Number.NaN])], sampleRateHz: 48_000,
    })).toThrow(/audio-sample-invalid/)
  })

  it('把图片尺寸/透明度/bytes 与音频声道/采样率/响度/峰值/loop 变成商业硬门', () => {
    const image = runtimeWithAsset({
      assetKey: 'character.hero', version: 1, kind: 'character-pose', name: '主角',
      mimeType: 'image/png', byteSize: PRODUCT_COMMERCIAL_MEDIA_POLICY_V2.maximumImageBytes + 1,
      width: 720, height: 900, durationMs: null, contentHash: 'a'.repeat(64), blobContentHash: 'a'.repeat(64),
      source: 'agnes.image-2.1-flash.v1', license: 'rights-policy:v1', altText: '雾中的主角',
      characterTag: 'character:1', sceneTag: 'opening',
    })
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: image,
      probe: {
        assetKey: 'character.hero', status: 'decoded', decodedHasAlpha: false,
        decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null,
        truePeakDbtp: null, loopSeamDbfs: null,
      },
    })).toEqual([
      'image-byte-size-exceeded',
      'image-character-alpha-missing',
      'image-portrait-height-below-commercial-minimum',
    ])

    const audio = runtimeWithAsset({
      assetKey: 'music.opening', version: 1, kind: 'bgm', name: '开场音乐',
      mimeType: 'audio/mpeg', byteSize: 1024, width: null, height: null, durationMs: 3_000,
      contentHash: 'b'.repeat(64), blobContentHash: 'b'.repeat(64), source: 'elevenlabs.music.v2',
      license: 'rights-policy:v1', altText: '克制的开场音乐', characterTag: '', sceneTag: 'opening',
    }, true)
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: audio,
      probe: {
        assetKey: 'music.opening', status: 'decoded', decodedHasAlpha: null,
        decodedChannelCount: 6, decodedSampleRateHz: 22_050, integratedLufs: -10,
        truePeakDbtp: -0.2, loopSeamDbfs: -12,
      },
    })).toEqual([
      'audio-channel-count-unsupported',
      'audio-loop-seam-exceeded',
      'audio-music-loudness-out-of-range',
      'audio-sample-rate-out-of-range',
      'audio-true-peak-exceeded',
    ])
  })

  it('用运行包角色注册和编辑职责区分角色立绘、物品特写与场景 CG', () => {
    const character = runtimeWithAsset({
      assetKey: 'character.npc-01', version: 1, kind: 'character-pose', name: '守钟人',
      mimeType: 'image/png', byteSize: 1024, width: 720, height: 1080, durationMs: null,
      contentHash: 'c'.repeat(64), blobContentHash: 'c'.repeat(64), source: 'fixture', license: 'fixture',
      altText: '守钟人的透明背景立绘', characterTag: 'character.npc-01', sceneTag: 'major-character-anchor',
    })
    character.interaction = {
      playerKey: 'player',
      profiles: [{
        participantKey: 'participant.01', characterKey: 'character.npc-01', name: '守钟人', roleLabel: '守钟人',
        voiceRules: '克制', initialKnowledge: [], relationshipDimensions: [], maxMemoryEntries: 40,
      }],
      sceneTemplates: [],
    }
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: character,
      probe: imageProbe('character.npc-01', true),
    })).toEqual([])

    character.presentation!.assets[0].characterTag = 'character.unknown'
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: character,
      probe: imageProbe('character.npc-01', true),
    })).toEqual(['image-character-anchor-missing'])
    character.presentation!.assets[0].characterTag = 'character.player'
    character.presentation!.assets[0].sceneTag = 'protagonist-anchor'
    character.adventure = { playerKey: 'player' } as never
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: character,
      probe: imageProbe('character.npc-01', true),
    })).toEqual([])

    const item = runtimeWithAsset({
      assetKey: 'item.memory-box', version: 1, kind: 'cg', name: '记忆匣特写',
      mimeType: 'image/png', byteSize: 1024, width: 1024, height: 1024, durationMs: null,
      contentHash: 'd'.repeat(64), blobContentHash: 'd'.repeat(64), source: 'fixture', license: 'fixture',
      altText: '中性承托面上的记忆匣', characterTag: '', sceneTag: 'important-item-primary',
    })
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: item,
      probe: imageProbe('item.memory-box'),
    })).toEqual([])

    item.presentation!.assets[0].width = 800
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: item,
      probe: imageProbe('item.memory-box'),
    })).toEqual(['image-detail-dimensions-below-commercial-minimum'])

    item.presentation!.assets[0].sceneTag = 'mainline-turn-act-2'
    expect(evaluateProductMediaCommercialPolicyV2({
      runtimePackage: item,
      probe: imageProbe('item.memory-box'),
    })).toEqual(['image-background-dimensions-below-commercial-minimum'])
  })
})
