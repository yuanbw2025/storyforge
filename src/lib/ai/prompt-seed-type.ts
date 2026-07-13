import type { PromptTemplate } from '../types'

export type PromptSeed = Omit<PromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
