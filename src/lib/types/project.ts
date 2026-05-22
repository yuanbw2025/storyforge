/** 写作状态 */
export type ProjectStatus = 'drafting' | 'ongoing' | 'paused' | 'completed'

/** 项目状态标签 */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  drafting:  '构思中',
  ongoing:   '连载中',
  paused:    '暂停',
  completed: '已完结',
}

/**
 * 流派标签（多选字符串，取代旧的单选 NovelGenre 枚举）
 * 参考起点、纵横、晋江分类体系
 */
export const GENRE_OPTIONS = [
  // 玄幻
  { group: '玄幻', value: 'xuanhuan',       label: '玄幻' },
  { group: '玄幻', value: 'dongfang',       label: '东方玄幻' },
  { group: '玄幻', value: 'yishi',          label: '异世大陆' },
  { group: '玄幻', value: 'wangchao',       label: '王朝争霸' },
  { group: '玄幻', value: 'gaowu',          label: '高武世界' },
  // 仙侠
  { group: '仙侠', value: 'xianxia',        label: '仙侠' },
  { group: '仙侠', value: 'xiuzhen',        label: '修真文明' },
  { group: '仙侠', value: 'huanxiu',        label: '幻想修仙' },
  { group: '仙侠', value: 'gudian',         label: '古典仙侠' },
  // 武侠
  { group: '武侠', value: 'wuxia',          label: '武侠' },
  { group: '武侠', value: 'chuantong',      label: '传统武侠' },
  { group: '武侠', value: 'xiandaiwu',      label: '现代武侠' },
  // 科幻
  { group: '科幻', value: 'kehuan',         label: '科幻' },
  { group: '科幻', value: 'xingji',         label: '星际战争' },
  { group: '科幻', value: 'weilai',         label: '未来世界' },
  { group: '科幻', value: 'shikong',        label: '时空穿梭' },
  { group: '科幻', value: 'chaoji',         label: '超级科技' },
  { group: '科幻', value: 'moshi',          label: '末世危机' },
  // 奇幻
  { group: '奇幻', value: 'qihuan',         label: '奇幻' },
  { group: '奇幻', value: 'xifang',         label: '西方魔幻' },
  { group: '奇幻', value: 'shishi',         label: '史诗奇幻' },
  { group: '奇幻', value: 'heian',          label: '黑暗奇幻' },
  // 都市
  { group: '都市', value: 'dushi',          label: '都市' },
  { group: '都市', value: 'dushenghuo',     label: '都市生活' },
  { group: '都市', value: 'duyineng',       label: '都市异能' },
  { group: '都市', value: 'yule',           label: '娱乐明星' },
  { group: '都市', value: 'shangzhan',      label: '商战职场' },
  { group: '都市', value: 'yishu',          label: '异术超能' },
  // 历史
  { group: '历史', value: 'lishi',          label: '历史' },
  { group: '历史', value: 'jiakong',        label: '架空历史' },
  { group: '历史', value: 'zhuanji',        label: '历史传记' },
  { group: '历史', value: 'songmingqing',   label: '两宋元明' },
  { group: '历史', value: 'qinhan',         label: '秦汉三国' },
  // 游戏
  { group: '游戏', value: 'youxi',          label: '游戏' },
  { group: '游戏', value: 'youxiyijie',     label: '游戏异界' },
  { group: '游戏', value: 'dianjing',       label: '电子竞技' },
  { group: '游戏', value: 'xuni',           label: '虚拟网游' },
  // 轻小说
  { group: '轻小说', value: 'qingxiaoshuo', label: '轻小说' },
  { group: '轻小说', value: 'riben',        label: '日系轻小说' },
  { group: '轻小说', value: 'xueyuan',      label: '校园青春' },
  // 其他
  { group: '其他', value: 'xuanyi',         label: '悬疑灵异' },
  { group: '其他', value: 'zhentan',        label: '侦探推理' },
  { group: '其他', value: 'kongbu',         label: '恐怖惊悚' },
  { group: '其他', value: 'other',          label: '其他' },
] as const

/** 旧的单选类型（保留兼容性） */
export type NovelGenre = string

/** 项目 */
export interface Project {
  id?: number
  name: string
  /** 兼容旧数据的单选流派（保留此字段避免旧代码报错，值始终有效） */
  genre: string
  /** 多选流派标签 */
  genres: string[]
  /** 用户在 GENRE_OPTIONS 之外自定义的流派标签（v3 §2.2，多选时显示在最末） */
  customGenre?: string
  /** 写作状态 */
  status: ProjectStatus
  description: string
  targetWordCount: number  // 目标字数
  /** 当前已写字数（v3 §2.2 状态栏，由 chapter 字数累加得到） */
  currentWordCount?: number
  /** 封面图（base64 或 object URL） */
  coverImage?: string
  createdAt: number        // timestamp
  updatedAt: number        // timestamp
}

/** 创建项目入参 */
export type CreateProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>

/** 将旧数据迁移：确保 genres[]、status、genre 字段始终有效 */
export function migrateGenre(p: Project): Project {
  const genres = p.genres && p.genres.length > 0
    ? p.genres
    : p.genre ? [p.genre] : ['other']
  const genre = p.genre || (genres[0] ?? 'other')
  return { ...p, genre, genres, status: p.status ?? 'drafting' }
}
