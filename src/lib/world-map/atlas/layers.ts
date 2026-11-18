import type { LayerVisibility } from '../engine/types'

export interface AtlasLayers extends Required<LayerVisibility> {
  mountains: boolean
  forests: boolean
  fortresses: boolean
  walls: boolean
}

export const DEFAULT_ATLAS_LAYERS: AtlasLayers = {
  terrain: true,
  coastlines: true,
  rivers: true,
  roads: true,
  borders: true,
  provinces: false,
  stateLabels: true,
  burgIcons: true,
  burgLabels: true,
  scaleBar: true,
  vignette: false,
  mountains: true,
  forests: true,
  fortresses: true,
  walls: true,
}

export const ATLAS_LAYER_LABELS: Record<keyof AtlasLayers, string> = {
  terrain: '地形底色',
  coastlines: '海岸线',
  mountains: '山脉',
  forests: '森林',
  rivers: '河流',
  roads: '道路',
  borders: '国界',
  provinces: '省界',
  burgIcons: '城镇图标',
  fortresses: '关隘与要塞',
  walls: '城墙与屏障',
  stateLabels: '区域名称',
  burgLabels: '地点与地貌名称',
  scaleBar: '比例尺',
  vignette: '暗角',
}
