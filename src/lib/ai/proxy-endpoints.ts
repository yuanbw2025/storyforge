import type { AIProvider } from '../types'

export interface AIProxyEndpoint {
  proxy: string
  direct: string
}

export const AI_PROXY_ENDPOINTS: Partial<Record<AIProvider, AIProxyEndpoint>> = {
  deepseek: { proxy: '/deepseek-proxy/v1', direct: 'https://api.deepseek.com/v1' },
  openai: { proxy: '/openai-proxy/v1', direct: 'https://api.openai.com/v1' },
  kimi: { proxy: '/kimi-proxy/v1', direct: 'https://api.moonshot.cn/v1' },
  claude: { proxy: '/claude-proxy/v1', direct: 'https://api.anthropic.com/v1' },
  nvidia: { proxy: '/nvidia-proxy/v1', direct: 'https://integrate.api.nvidia.com/v1' },
  doubao: { proxy: '/doubao-proxy/api/v3', direct: 'https://ark.cn-beijing.volces.com/api/v3' },
  agnes: { proxy: '/agnes-proxy/v1', direct: 'https://apihub.agnes-ai.com/v1' },
  longcat: { proxy: '/longcat-proxy/openai/v1', direct: 'https://api.longcat.chat/openai/v1' },
  opencode: { proxy: '/opencode-proxy/v1', direct: 'https://opencode.ai/zen/go/v1' },
}
