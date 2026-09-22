import { describe, expect, it } from 'vitest'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import { projectTextOpenWorldPlayerMediaV1 } from '../../src/lib/open-world/player-media'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

function asset(assetKey: string): FrozenRuntimeMediaAssetV2 {
  return {
    assetKey, version: 1, kind: 'background', name: assetKey,
    mimeType: 'image/png', byteSize: 16, width: 1280, height: 720, durationMs: null,
    contentHash: 'a'.repeat(64), blobContentHash: 'a'.repeat(64), source: 'test',
    license: 'test-only', altText: assetKey, characterTag: '', sceneTag: '',
  }
}

describe('Text Open World G7-06 · player media projection', () => {
  it('旧Presentation v2只在读取内存中升级并保留程序地图兼容', () => {
    const modules = parseTextOpenWorldModulesV1(createTextOpenWorldVNextFixture())
    expect(modules.presentation).toMatchObject({ version: 3, sourceVersion: 2 })
    expect(modules.presentation.mediaSlots).toEqual([
      expect.objectContaining({
        key: 'map.world', subjectKind: 'world', subjectKey: 'world', assetKey: null,
      }),
    ])
  })

  it('按显式主体绑定当前地点背景与角色头像，不从asset key猜owner', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const presentation = runtimePackage.modules.presentation.payload as Record<string, unknown>
    presentation.version = 3
    runtimePackage.modules.presentation.schemaVersion = 3
    presentation.mediaSlots = [{
      key: 'map.world', kind: 'map', subjectKind: 'world', subjectKey: 'world',
      consumerRef: 'overlay.map', required: true, assetKey: null,
      fallbackText: '程序地图', altText: '世界地图',
    }, {
      key: 'slot.location', kind: 'background', subjectKind: 'location', subjectKey: 'location.salt-port',
      consumerRef: 'play.scene', required: true, assetKey: 'asset.opaque-a',
      fallbackText: '盐港文字场景', altText: '盐港广场背景',
    }, {
      key: 'slot.actor', kind: 'portrait', subjectKind: 'actor', subjectKey: 'actor.caretaker',
      consumerRef: 'play.scene', required: true, assetKey: 'asset.opaque-b',
      fallbackText: '岑阿婆文字肖像', altText: '岑阿婆头像',
    }]
    runtimePackage.mediaManifest.slotKeys = ['map.world', 'slot.location', 'slot.actor']
    runtimePackage.mediaManifest.requiredSlotKeys = ['map.world', 'slot.location', 'slot.actor']
    const modules = parseTextOpenWorldModulesV1(runtimePackage)
    const projection = projectTextOpenWorldPlayerMediaV1({
      modules,
      assets: [asset('asset.opaque-a'), { ...asset('asset.opaque-b'), kind: 'character-pose' }],
      urls: { 'asset.opaque-a': 'blob:background', 'asset.opaque-b': 'blob:portrait' },
      currentLocationKey: 'location.salt-port',
    })
    expect(projection.currentLocationBackground).toMatchObject({
      slotKey: 'slot.location', assetKey: 'asset.opaque-a', url: 'blob:background',
    })
    expect(projection.portraitByActorKey['actor.caretaker']).toMatchObject({
      slotKey: 'slot.actor', assetKey: 'asset.opaque-b', url: 'blob:portrait',
    })
    expect(projection.degradedSlotKeys).toEqual([])
  })

  it('媒资缺失时保留alt与文字回退且不伪造URL', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const presentation = runtimePackage.modules.presentation.payload as Record<string, unknown>
    presentation.version = 3
    runtimePackage.modules.presentation.schemaVersion = 3
    presentation.mediaSlots = [{
      key: 'map.world', kind: 'map', subjectKind: 'world', subjectKey: 'world',
      consumerRef: 'overlay.map', required: true, assetKey: null,
      fallbackText: '程序地图', altText: '世界地图',
    }, {
      key: 'slot.location', kind: 'background', subjectKind: 'location', subjectKey: 'location.salt-port',
      consumerRef: 'play.scene', required: true, assetKey: 'asset.missing',
      fallbackText: '盐港文字场景', altText: '盐港广场背景',
    }]
    runtimePackage.mediaManifest.slotKeys = ['map.world', 'slot.location']
    runtimePackage.mediaManifest.requiredSlotKeys = ['map.world', 'slot.location']
    const projection = projectTextOpenWorldPlayerMediaV1({
      modules: parseTextOpenWorldModulesV1(runtimePackage), assets: [], urls: {},
      currentLocationKey: 'location.salt-port',
    })
    expect(projection.currentLocationBackground).toEqual({
      slotKey: 'slot.location', assetKey: null, url: null,
      fallbackText: '盐港文字场景', altText: '盐港广场背景',
    })
    expect(projection.degradedSlotKeys).toEqual(['slot.location'])
  })

  it('拒绝Presentation v3对不存在Actor的头像绑定', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const presentation = runtimePackage.modules.presentation.payload as Record<string, unknown>
    presentation.version = 3
    runtimePackage.modules.presentation.schemaVersion = 3
    presentation.mediaSlots = [{
      key: 'map.world', kind: 'map', subjectKind: 'world', subjectKey: 'world',
      consumerRef: 'overlay.map', required: true, assetKey: null,
      fallbackText: '程序地图', altText: '世界地图',
    }, {
      key: 'slot.ghost', kind: 'portrait', subjectKind: 'actor', subjectKey: 'actor.not-found',
      consumerRef: 'play.scene', required: true, assetKey: null,
      fallbackText: '不存在的角色', altText: '不存在的角色头像',
    }]
    runtimePackage.mediaManifest.slotKeys = ['map.world', 'slot.ghost']
    runtimePackage.mediaManifest.requiredSlotKeys = ['map.world', 'slot.ghost']
    expect(() => parseTextOpenWorldModulesV1(runtimePackage)).toThrow('subjectKey 引用不存在:actor.not-found')
  })
})
