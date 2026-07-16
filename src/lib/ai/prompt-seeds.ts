import { CORE_PROMPT_SEEDS } from './prompt-seeds-core'
import { TOOL_PROMPT_SEEDS } from './prompt-seeds-tools'
import { GENRE_PACK_SEEDS } from './prompt-seeds-genre-packs'
import type { PromptSeed } from './prompt-seed-type'

export type { PromptSeed } from './prompt-seed-type'

/**
 * 系统内置提示词的唯一有序入口。
 *
 * 顺序是持久化 seed 契约的一部分：基础创作 → 工具/提取 → 题材包。
 * 小说创作内容由 Prompt store 动态加载，避免长文本进入首屏包。
 * 各领域文件只负责定义模板，初始化和查询仍统一读取本数组。
 */
export const SYSTEM_PROMPT_SEEDS: PromptSeed[] = [
  ...CORE_PROMPT_SEEDS,
  ...TOOL_PROMPT_SEEDS,
  ...GENRE_PACK_SEEDS,
]
