import type { ProductModuleCompilerInputV1 } from '../../src/lib/product-production/product-module-compilers'
import type { ProductProductionWorldSourceCatalogV2 } from '../../src/lib/product-production/world-source'
import { DEFAULT_CHAT_SETTINGS } from '../../src/lib/character-interaction/authoring-contract'

/** Deliberately small compiler input, not a production or real-model acceptance fixture. */
export function characterChatBaselineInput(): ProductModuleCompilerInputV1 & {
  sourceCatalog: ProductModuleCompilerInputV1['sourceCatalog'] & {
    resources: Pick<ProductProductionWorldSourceCatalogV2['resources'][number], 'value'>[]
  }
} {
  return {
    brief: {
      characterChat: { ...DEFAULT_CHAT_SETTINGS, mode: 'multi' },
      source: { selection: { roleBindings: { participants: ['world-release:character:17', 'world-release:character:42'] } } },
      intent: {
        productType: 'character-interaction', playerRole: '修钟学徒沈禾',
        contentBoundaries: ['不替玩家决定行动'], openingSituation: '驿站避雨', coreExperience: ['共同调查'],
      },
      scale: { targetPlayMinutes: 30 },
    },
    sourceCatalog: {
      characters: [
        { resourceKey: 'world-release:character:17', name: '叶岑', description: '守卫；未分类秘密：密信藏在旧钟底座。' },
        { resourceKey: 'world-release:character:42', name: '程素', description: '驿站医师。' },
      ],
      resources: [{ value: { name: '叶岑', motivation: '找到失物后向被冤枉的住客公开道歉' } }],
    },
    narrative: {
      moduleKind: 'main', moduleTitle: '驿站避雨', entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '驿站', summary: '寻找失物', conditionJson: '{}', effectsJson: '[]', successorKeys: ['end'] },
        { key: 'end', kind: 'ending', title: '告别', summary: '告别', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [{ beatKey: 'future', nodeKey: 'end', kind: 'dialogue', speakerKey: 'character:1', text: '未来结局：真正拿走物品的是掌柜。', order: 0 }],
      choices: [],
    },
  } as unknown as ReturnTypeShape
}

type ReturnTypeShape = ProductModuleCompilerInputV1 & {
  sourceCatalog: ProductModuleCompilerInputV1['sourceCatalog'] & {
    resources: Pick<ProductProductionWorldSourceCatalogV2['resources'][number], 'value'>[]
  }
}
