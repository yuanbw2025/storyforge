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
 *   | `useCreativeRulesStore`  | `creativeRules`  | 创作 → 创作规则                  |
 *
 * 所有单例均直接使用当前表结构与统一工厂。
 */

import type {
  CreativeRules,
  Geography,
  History,
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

export const useCreativeRulesStore = createProjectSingletonStore<
  'creativeRules',
  CreativeRules
>({
  table: 'creativeRules',
  key: 'creativeRules',
  defaults: {
    writingStyle: '',
    narrativePOV: 'third-limited',
    atmosphere: '',
    prohibitions: '[]',
    consistencyRules: '[]',
    specialRequirements: '',
  },
})
