import type { PromptParameter } from '../types/prompt'

export const VOLUME_OUTLINE_PARAMETERS: PromptParameter[] = [
  {
    key: 'pace',
    label: '整体节奏',
    type: 'select',
    options: ['慢', '中', '快', '极快'],
    default: '中',
    description: '影响每卷信息密度',
    optional: true,
  },
  {
    key: 'volumeCount',
    label: '建议卷数',
    type: 'slider',
    min: 1,
    max: 30,
    step: 1,
    default: 5,
    description: '不指定则按目标字数自动估算',
    optional: true,
  },
]
