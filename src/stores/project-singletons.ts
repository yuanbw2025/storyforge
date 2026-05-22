/**
 * 项目级单例 Store 合集
 * ------------------------------------------------------------
 * 本文件通过 `createProjectSingletonStore` 工厂集中生成
 * 四兄弟"单条记录 / 每个项目"的 Zustand store：
 *
 *   | hook 名                  | Dexie 表         | 对应 UI 面板                     |
 *   | ------------------------ | ---------------- | -------------------------------- |
 *   | `useGeographyStore`      | `geographies`    | 世界观 → 地理                    |
 *   | `useHistoryStore`        | `histories`      | 世界观 → 历史                    |
 *   | `useItemSystemStore`     | `itemSystems`    | 世界观 → 物品体系                |
 *   | `useCreativeRulesStore`  | `creativeRules`  | 创作 → 创作规则                  |
 *
 * 对外 API（hook 名、state 字段名、方法签名）与原手写 store 完全一致，
 * 调用方只需更新 import 路径即可。
 */

import type {
  CreativeRules,
  Geography,
  History,
  ItemSystem,
} from '../lib/types'
import { createProjectSingletonStore } from './_factories'

export const useGeographyStore = createProjectSingletonStore<'geography', Geography>({
  table: 'geographies',
  key: 'geography',
  defaults: {
    overview: '',
    locations: '[]',
    worldMapData: '',
  },
})

export const useHistoryStore = createProjectSingletonStore<'history', History>({
  table: 'histories',
  key: 'history',
  defaults: {
    overview: '',
    eraSystem: '',
    events: '[]',
  },
})

export const useItemSystemStore = createProjectSingletonStore<'itemSystem', ItemSystem>({
  table: 'itemSystems',
  key: 'itemSystem',
  defaults: {
    overview: '',
    items: '[]',
  },
})

export const useCreativeRulesStore = createProjectSingletonStore<
  'creativeRules',
  CreativeRules
>({
  table: 'creativeRules',
  key: 'creativeRules',
  defaults: {
    writingStyle: '',
    narrativePOV: 'third-limited',
    toneAndMood: '',
    prohibitions: '[]',
    consistencyRules: '[]',
    specialRequirements: '',
    referenceWorks: '[]',
  },
})
