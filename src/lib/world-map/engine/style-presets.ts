/**
 * 地图渲染风格预设
 * 每种预设定义颜色方案、字体、透明度等
 */

import type { MapStylePreset } from './types'

/** 风格配置 */
export interface StyleConfig {
  /** 海洋背景色 */
  oceanBg: string
  /** 海洋深度色阶（浅 → 深，5 级） */
  oceanDepth: [string, string, string, string, string]
  /** 海岸线颜色 */
  coastline: string
  /** 海岸光晕颜色 */
  coastGlow: string
  /** 河流颜色 */
  river: string
  /** 河流光晕 */
  riverGlow: string
  /** 河流高光 */
  riverHighlight: string
  /** 国界颜色透明度 */
  borderAlpha: number
  /** 国家标签字体 */
  stateLabelFont: string
  /** 国家标签颜色 */
  stateLabelColor: string
  /** 国家标签发光 */
  stateLabelGlow: string
  /** 城镇标签字体 */
  burgLabelFont: string
  /** 城镇标签颜色 */
  burgLabelColor: string
  /** 城镇标签描边 */
  burgLabelStroke: string
  /** 首都外圈颜色 */
  capitalStroke: string
  /** 城镇外圈颜色 */
  townStroke: string
  /** 暗角强度 0-1 */
  vignetteAlpha: number
  /** 暗角颜色 */
  vignetteColor: string
  /** 背景叠加滤镜（可选，如泛黄） */
  overlayColor?: string
  /** 比例尺颜色 */
  scaleBarColor: string
  /** 比例尺背景 */
  scaleBarBg: string
  /** 高山颜色基调 [r,g,b] 低→高 */
  mountainLow: [number, number, number]
  mountainHigh: [number, number, number]
  /** 道路颜色 */
  roadMajor: string
  roadMinor: string
  roadTrade: string
  roadSea: string
  /** 省界颜色 */
  provinceBorder: string
}

/** 预设定义 */
const PRESETS: Record<MapStylePreset, StyleConfig> = {
  // 等高线地形图（默认）
  topographic: {
    oceanBg: '#d1e5f0',
    oceanDepth: ['#b3d7ea', '#8cc0de', '#6baed6', '#4a90c4', '#2b6da8'],
    coastline: '#3a7ab5',
    coastGlow: 'rgba(60, 120, 180, 0.2)',
    river: '#4a96d0',
    riverGlow: 'rgba(60, 130, 200, 0.25)',
    riverHighlight: 'rgba(160, 210, 245, 0.3)',
    borderAlpha: 0.65,
    stateLabelFont: '"STSong", "SimSun", "Noto Serif SC", "Source Han Serif SC", serif',
    stateLabelColor: 'rgba(40, 25, 10, 0.6)',
    stateLabelGlow: 'rgba(255, 255, 240, 0.95)',
    burgLabelFont: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    burgLabelColor: '#111',
    burgLabelStroke: 'rgba(255,255,255,0.9)',
    capitalStroke: '#222',
    townStroke: '#444',
    vignetteAlpha: 0.08,
    vignetteColor: '0,0,0',
    scaleBarColor: '#333',
    scaleBarBg: 'rgba(255, 255, 255, 0.75)',
    mountainLow: [160, 130, 80],
    mountainHigh: [240, 220, 180],
    roadMajor: 'rgba(120, 80, 40, 0.5)',
    roadMinor: 'rgba(140, 110, 70, 0.35)',
    roadTrade: 'rgba(180, 140, 60, 0.45)',
    roadSea: 'rgba(60, 100, 180, 0.3)',
    provinceBorder: 'rgba(100, 100, 100, 0.25)',
  },

  // 羊皮纸古典
  parchment: {
    oceanBg: '#c5b99a',
    oceanDepth: ['#b8ad8e', '#a89e82', '#988e76', '#887e6a', '#786e5e'],
    coastline: '#5a4a30',
    coastGlow: 'rgba(80, 60, 30, 0.25)',
    river: '#6a7a5a',
    riverGlow: 'rgba(80, 100, 60, 0.2)',
    riverHighlight: 'rgba(140, 160, 120, 0.25)',
    borderAlpha: 0.5,
    stateLabelFont: '"STSong", "SimSun", "Noto Serif SC", serif',
    stateLabelColor: 'rgba(50, 30, 10, 0.7)',
    stateLabelGlow: 'rgba(200, 190, 160, 0.8)',
    burgLabelFont: '"PingFang SC", "Microsoft YaHei", sans-serif',
    burgLabelColor: '#3a2a1a',
    burgLabelStroke: 'rgba(200, 190, 160, 0.85)',
    capitalStroke: '#3a2a1a',
    townStroke: '#5a4a3a',
    vignetteAlpha: 0.15,
    vignetteColor: '40,30,10',
    overlayColor: 'rgba(180, 160, 120, 0.08)',
    scaleBarColor: '#4a3a2a',
    scaleBarBg: 'rgba(200, 190, 160, 0.7)',
    mountainLow: [140, 115, 70],
    mountainHigh: [200, 180, 140],
    roadMajor: 'rgba(90, 60, 20, 0.5)',
    roadMinor: 'rgba(100, 80, 40, 0.3)',
    roadTrade: 'rgba(160, 120, 40, 0.4)',
    roadSea: 'rgba(80, 90, 60, 0.3)',
    provinceBorder: 'rgba(80, 60, 30, 0.2)',
  },

  // 水彩手绘
  watercolor: {
    oceanBg: '#c7dce8',
    oceanDepth: ['#b0cedd', '#98bed2', '#80aec7', '#689ebc', '#508eb1'],
    coastline: '#5a8aaa',
    coastGlow: 'rgba(80, 130, 170, 0.15)',
    river: '#6aa0c0',
    riverGlow: 'rgba(80, 140, 180, 0.2)',
    riverHighlight: 'rgba(160, 200, 230, 0.25)',
    borderAlpha: 0.4,
    stateLabelFont: '"STSong", "SimSun", "Noto Serif SC", serif',
    stateLabelColor: 'rgba(50, 40, 30, 0.5)',
    stateLabelGlow: 'rgba(240, 235, 225, 0.85)',
    burgLabelFont: '"PingFang SC", "Microsoft YaHei", sans-serif',
    burgLabelColor: '#3a3a3a',
    burgLabelStroke: 'rgba(245, 240, 230, 0.85)',
    capitalStroke: '#333',
    townStroke: '#555',
    vignetteAlpha: 0.05,
    vignetteColor: '0,0,0',
    scaleBarColor: '#444',
    scaleBarBg: 'rgba(240, 235, 225, 0.7)',
    mountainLow: [170, 145, 100],
    mountainHigh: [230, 215, 185],
    roadMajor: 'rgba(100, 80, 50, 0.35)',
    roadMinor: 'rgba(120, 100, 70, 0.25)',
    roadTrade: 'rgba(160, 130, 60, 0.3)',
    roadSea: 'rgba(70, 110, 160, 0.25)',
    provinceBorder: 'rgba(90, 80, 70, 0.18)',
  },

  // 暗黑风格
  dark: {
    oceanBg: '#1a2030',
    oceanDepth: ['#1e2538', '#151c2e', '#101824', '#0b141a', '#060e14'],
    coastline: '#4a6080',
    coastGlow: 'rgba(60, 80, 120, 0.3)',
    river: '#3a6a90',
    riverGlow: 'rgba(40, 80, 120, 0.3)',
    riverHighlight: 'rgba(80, 140, 200, 0.2)',
    borderAlpha: 0.55,
    stateLabelFont: '"STSong", "SimSun", "Noto Serif SC", serif',
    stateLabelColor: 'rgba(200, 190, 170, 0.7)',
    stateLabelGlow: 'rgba(0, 0, 0, 0.6)',
    burgLabelFont: '"PingFang SC", "Microsoft YaHei", sans-serif',
    burgLabelColor: '#ccc',
    burgLabelStroke: 'rgba(0, 0, 0, 0.7)',
    capitalStroke: '#aaa',
    townStroke: '#777',
    vignetteAlpha: 0.2,
    vignetteColor: '0,0,0',
    scaleBarColor: '#aaa',
    scaleBarBg: 'rgba(0, 0, 0, 0.5)',
    mountainLow: [80, 65, 40],
    mountainHigh: [140, 120, 90],
    roadMajor: 'rgba(150, 130, 100, 0.4)',
    roadMinor: 'rgba(120, 100, 80, 0.25)',
    roadTrade: 'rgba(180, 150, 80, 0.35)',
    roadSea: 'rgba(60, 90, 140, 0.3)',
    provinceBorder: 'rgba(150, 140, 120, 0.2)',
  },

  // 简洁现代
  clean: {
    oceanBg: '#e8f0f8',
    oceanDepth: ['#d4e4f0', '#c0d8e8', '#acccdf', '#98c0d6', '#84b4cd'],
    coastline: '#6a9ab8',
    coastGlow: 'rgba(80, 140, 180, 0.12)',
    river: '#6aa8d0',
    riverGlow: 'rgba(60, 140, 200, 0.15)',
    riverHighlight: 'rgba(160, 210, 240, 0.2)',
    borderAlpha: 0.5,
    stateLabelFont: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    stateLabelColor: 'rgba(40, 40, 40, 0.6)',
    stateLabelGlow: 'rgba(255, 255, 255, 0.9)',
    burgLabelFont: '"PingFang SC", "Microsoft YaHei", sans-serif',
    burgLabelColor: '#222',
    burgLabelStroke: 'rgba(255,255,255,0.9)',
    capitalStroke: '#333',
    townStroke: '#555',
    vignetteAlpha: 0.03,
    vignetteColor: '0,0,0',
    scaleBarColor: '#444',
    scaleBarBg: 'rgba(255, 255, 255, 0.8)',
    mountainLow: [170, 150, 110],
    mountainHigh: [230, 220, 200],
    roadMajor: 'rgba(100, 80, 60, 0.4)',
    roadMinor: 'rgba(130, 110, 90, 0.25)',
    roadTrade: 'rgba(170, 140, 70, 0.35)',
    roadSea: 'rgba(70, 110, 170, 0.25)',
    provinceBorder: 'rgba(100, 100, 100, 0.18)',
  },

  // 地图集风格
  atlas: {
    oceanBg: '#cddce8',
    oceanDepth: ['#b8cede', '#a0bed4', '#88aeca', '#709ec0', '#588eb6'],
    coastline: '#2a5a80',
    coastGlow: 'rgba(30, 70, 120, 0.2)',
    river: '#3a80b0',
    riverGlow: 'rgba(40, 100, 160, 0.2)',
    riverHighlight: 'rgba(120, 180, 220, 0.25)',
    borderAlpha: 0.7,
    stateLabelFont: '"STSong", "SimSun", "Noto Serif SC", serif',
    stateLabelColor: 'rgba(20, 15, 5, 0.65)',
    stateLabelGlow: 'rgba(245, 240, 230, 0.9)',
    burgLabelFont: '"PingFang SC", "Microsoft YaHei", sans-serif',
    burgLabelColor: '#1a1a1a',
    burgLabelStroke: 'rgba(245, 240, 230, 0.9)',
    capitalStroke: '#1a1a1a',
    townStroke: '#3a3a3a',
    vignetteAlpha: 0.1,
    vignetteColor: '20,15,5',
    scaleBarColor: '#2a2a2a',
    scaleBarBg: 'rgba(245, 240, 230, 0.8)',
    mountainLow: [150, 120, 70],
    mountainHigh: [220, 200, 160],
    roadMajor: 'rgba(80, 50, 20, 0.55)',
    roadMinor: 'rgba(110, 80, 40, 0.35)',
    roadTrade: 'rgba(150, 110, 30, 0.45)',
    roadSea: 'rgba(50, 80, 140, 0.3)',
    provinceBorder: 'rgba(60, 50, 30, 0.22)',
  },
}

/** 获取风格配置 */
export function getStyleConfig(preset: MapStylePreset = 'topographic'): StyleConfig {
  return PRESETS[preset] || PRESETS.topographic
}

/** 风格预设描述（UI 用） */
export const STYLE_PRESET_LABELS: Record<MapStylePreset, string> = {
  topographic: '等高线地形图',
  parchment: '羊皮纸古典',
  watercolor: '水彩手绘',
  dark: '暗黑风格',
  clean: '简洁现代',
  atlas: '地图集',
}
