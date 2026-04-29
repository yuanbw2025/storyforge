/** 参考书目类型 */
export type ReferenceType = 'story' | 'style'

/** 参考书目条目 */
export interface Reference {
  id?: number
  projectId: number
  title: string        // 书名
  author: string       // 作者
  type: ReferenceType  // 故事参考 | 风格参考
  note: string         // 备注
  url: string          // 链接（可选）
  createdAt: number
  updatedAt: number
}

export type CreateReferenceInput = Omit<Reference, 'id' | 'createdAt' | 'updatedAt'>
