/** 小说类型 */
export type NovelGenre =
  | 'xuanhuan'   // 玄幻
  | 'xianxia'    // 仙侠
  | 'dushi'      // 都市
  | 'lishi'      // 历史
  | 'kehuan'     // 科幻
  | 'qihuan'     // 奇幻
  | 'wuxia'      // 武侠
  | 'other'      // 其他

/** 项目 */
export interface Project {
  id?: number
  name: string
  genre: NovelGenre
  description: string
  targetWordCount: number  // 目标字数
  createdAt: number        // timestamp
  updatedAt: number        // timestamp
}

/** 创建项目入参 */
export type CreateProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>
