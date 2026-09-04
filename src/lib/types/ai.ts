/** AI 提供商 */
export type AIProvider =
  | 'deepseek'
  | 'openai'
  | 'qwen'
  | 'doubao'
  | 'minimax'
  | 'glm'
  | 'wenxin'
  | 'gemini'
  | 'poe'
  | 'kimi'
  | 'claude'
  | 'modelscope'
  | 'nvidia'
  | 'agnes'
  | 'longcat'
  | 'opencode'
  | 'ollama'
  | 'custom'

/** AI 配置 */
export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  baseUrl: string
  temperature: number
  maxTokens: number
  /**
   * FB-8:用户手填的「上下文窗口大小」(token),用于本地/自定义模型(LM Studio/Ollama/中转/新模型)。
   * 设了就以它为准,否则按内置预设、再否则 8K 兜底。0/undefined = 用预设。
   */
  contextWindow?: number
}

/**
 * NS-5 · Embedding（语义检索通道）配置。与聊天 AIConfig 分开存——换写作模型不影响向量。
 * enabled=false（默认）时检索只走关键词通道（优雅降级）。走 OpenAI 兼容 /embeddings 端点。
 */
export interface EmbeddingConfig {
  /** 是否启用语义检索通道（默认 false = 纯关键词，零额外成本/不外传） */
  enabled: boolean
  provider: AIProvider
  apiKey: string
  baseUrl: string
  model: string
}

/** API 配置预设（多套配置一键切换） */
export interface AIConfigPreset {
  id: string
  name: string
  config: AIConfig
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** AI 错误 */
export class AIError extends Error {
  status: number
  body: string

  constructor(status: number, body: string) {
    super(`AI API Error (${status}): ${body}`)
    this.name = 'AIError'
    this.status = status
    this.body = body
  }
}

/** 各 provider 的可选模型列表（有下拉菜单的 provider 才需要配） */
export const PROVIDER_MODELS: Record<string, { value: string; label: string; desc?: string }[]> = {
  deepseek: [
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', desc: '快速，性价比高' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '最强，支持深度思考' },
  ],
  doubao: [
    { value: 'doubao-1-5-pro-32k-250115', label: 'Doubao 1.5 Pro 32K', desc: '32K 上下文·纯文本生成' },
    { value: 'deepseek-v4-flash-ga-260731', label: 'DeepSeek V4 Flash 正式版', desc: '火山方舟·快速文本推理' },
    { value: 'deepseek-v4-pro-260425', label: 'DeepSeek V4 Pro', desc: '火山方舟·高质量文本推理' },
    { value: 'deepseek-v4-flash-260425', label: 'DeepSeek V4 Flash', desc: '火山方舟·文本推理' },
  ],
  // Gemini 模型列表（官方 OpenAI compatibility / model catalog，2026-08-22 复核）
  gemini: [
    { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash ⭐', desc: '稳定版·1M 上下文·65K 输出' },
    { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', desc: '高吞吐轻量版' },
    { value: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', desc: '官方当前新一代 Flash；使用前先做任务预检' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: '历史稳定版' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', desc: '轻量稳定版' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: '最强稳定版，支持思考' },
    { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', desc: '⚠️ 预览版' },
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Preview)', desc: '⚠️ 预览版，可能不稳定' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', desc: '老版' },
  ],
  poe: [
    { value: 'GPT-4o', label: 'GPT-4o' },
    { value: 'Claude-Sonnet-4.6', label: 'Claude Sonnet 4.6' },
    { value: 'Claude-Opus-4.7', label: 'Claude Opus 4.7' },
    { value: 'Gemini-3.1-Pro', label: 'Gemini 3.1 Pro' },
    { value: 'GPT-5.4', label: 'GPT-5.4' },
    { value: 'GLM-5.1-FM', label: 'GLM 5.1 FM' },
  ],
  nvidia: [
    { value: 'mistralai/mistral-nemotron', label: 'Mistral Nemotron ⭐', desc: 'NVIDIA 托管文本端点·当前实测低延迟' },
    { value: 'deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash 0731', desc: 'NVIDIA 托管目录当前 V4 端点；可能冷启动或长时间排队' },
    { value: 'minimaxai/minimax-m3', label: 'MiniMax M3', desc: 'NVIDIA 托管目录当前文本端点·推理与 Agent' },
    { value: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', desc: 'NVIDIA 当前 Llama 文本端点' },
    { value: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', desc: '高性能' },
    { value: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', desc: '低延迟兼容端点' },
  ],
  modelscope: [
    { value: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B A22B', desc: '最强 MoE 模型' },
    { value: 'Qwen/Qwen3-32B', label: 'Qwen3 32B', desc: '高性能密集模型' },
    { value: 'Qwen/Qwen3-30B-A3B', label: 'Qwen3 30B A3B', desc: '轻量 MoE，性价比高' },
    { value: 'Qwen/Qwen3-14B', label: 'Qwen3 14B', desc: '中等规模密集模型' },
    { value: 'Qwen/Qwen3-8B', label: 'Qwen3 8B', desc: '轻量密集模型' },
    { value: 'Qwen/Qwen3-4B', label: 'Qwen3 4B', desc: '超轻量' },
  ],
  agnes: [
    { value: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash', desc: '512K 上下文·Agent/推理推荐' },
    { value: 'agnes-2.5-pro', label: 'Agnes 2.5 Pro', desc: '服务实时目录·高质量独立评审' },
    { value: 'agnes-2.5-pro-alpha', label: 'Agnes 2.5 Pro Alpha', desc: '服务实时目录·实验性' },
    { value: 'agnes-2.0-flash', label: 'Agnes 2.0 Flash', desc: '256K 上下文·备用模型' },
  ],
  longcat: [
    { value: 'LongCat-2.0', label: 'LongCat 2.0', desc: '美团 LongCat · OpenAI 兼容 · 1M 上下文' },
  ],
  opencode: [
    { value: 'kimi-k2.7-code', label: 'Kimi K2.7 Code', desc: 'OpenCode Go · chat/completions' },
    { value: 'kimi-k2.6', label: 'Kimi K2.6', desc: 'OpenCode Go · chat/completions' },
    { value: 'glm-5.2', label: 'GLM-5.2', desc: 'OpenCode Go · chat/completions' },
    { value: 'glm-5.1', label: 'GLM-5.1', desc: 'OpenCode Go · chat/completions' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: 'OpenCode Go · chat/completions' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', desc: 'OpenCode Go · chat/completions' },
    { value: 'mimo-v2.5-pro', label: 'MiMo-V2.5-Pro', desc: 'OpenCode Go · chat/completions' },
    { value: 'mimo-v2.5', label: 'MiMo-V2.5', desc: 'OpenCode Go · chat/completions' },
  ],
}

/** 提供商预设 */
export const PROVIDER_PRESETS: Record<string, Partial<AIConfig>> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-max',
  },
  doubao: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-1-5-pro-32k-250115',
  },
  minimax: {
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-Text-01',
  },
  glm: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  wenxin: {
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'ernie-4.0-8k',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
  },
  poe: {
    baseUrl: 'https://api.poe.com/v1',
    model: 'GPT-4o',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  claude: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'mistralai/mistral-nemotron',
  },
  modelscope: {
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: 'Qwen/Qwen3-235B-A22B',
  },
  agnes: {
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-2.5-flash',
  },
  longcat: {
    baseUrl: 'https://api.longcat.chat/openai/v1',
    model: 'LongCat-2.0',
  },
  opencode: {
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'kimi-k2.7-code',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    apiKey: 'ollama',
  },
}

/** Official providers accept only their current registered model IDs; custom/local providers remain open. */
export function normalizeProviderModel(provider: AIProvider, model: string): string {
  const normalized = model.trim()
  const registered = PROVIDER_MODELS[provider]
  if (!registered?.length) return normalized
  if (registered.some(option => option.value === normalized)) return normalized
  return PROVIDER_PRESETS[provider]?.model ?? registered[0].value
}
