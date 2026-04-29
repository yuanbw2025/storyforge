/**
 * 流派标签预设数据
 *
 * 来源：参考起点中文网（qidian.com）、纵横中文网（zongheng.com）、晋江文学城（jjwxc.net）
 *      三大平台的实际分类体系（2026 年 4 月版）整理而成
 *
 * 抓取记录：
 * - 三站 WebFetch 均因 JS 渲染/反爬虫无法直接取页内文本
 * - 降级使用人工对照三站分类页整理的数据（见 docs/playbooks/PHASE-00-genre-web-search.md § 8）
 *
 * 数据维护规则：
 * - value 必须是英文/拼音，永久稳定，作为数据库存储 key（不可改名）
 * - label 是中文显示，可改但需团队评审
 * - 新增标签直接追加，不要重排顺序
 * - "other" 必须始终是最后一项（兜底用）
 */

export type GenreGender = 'male' | 'female' | 'general'

export interface GenrePreset {
  /** 永久稳定的 key（拼音/英文），用于数据库存储 */
  value: string
  /** 中文显示名 */
  label: string
  /** 一级分类组 */
  group: string
  /** 适用频道：male=男频，female=女频，general=通用（如悬疑） */
  gender: GenreGender
}

export const GENRE_PRESETS: readonly GenrePreset[] = [
  // === 男频玄幻 ===
  { value: 'xuanhuan',     label: '玄幻',       group: '玄幻',     gender: 'male' },
  { value: 'dongfangxh',   label: '东方玄幻',   group: '玄幻',     gender: 'male' },
  { value: 'yishidalu',    label: '异世大陆',   group: '玄幻',     gender: 'male' },
  { value: 'wangchao',     label: '王朝争霸',   group: '玄幻',     gender: 'male' },
  { value: 'gaowu',        label: '高武世界',   group: '玄幻',     gender: 'male' },

  // === 男频仙侠 ===
  { value: 'xianxia',      label: '仙侠',       group: '仙侠',     gender: 'male' },
  { value: 'xiuzhen',      label: '修真文明',   group: '仙侠',     gender: 'male' },
  { value: 'huanxiang',    label: '幻想修仙',   group: '仙侠',     gender: 'male' },
  { value: 'gudianxx',     label: '古典仙侠',   group: '仙侠',     gender: 'male' },
  { value: 'shenhua',      label: '神话修真',   group: '仙侠',     gender: 'male' },

  // === 男频武侠 ===
  { value: 'wuxia',        label: '武侠',       group: '武侠',     gender: 'male' },
  { value: 'chuantongwx',  label: '传统武侠',   group: '武侠',     gender: 'male' },
  { value: 'xiandaiwx',    label: '现代武侠',   group: '武侠',     gender: 'male' },
  { value: 'wuxiatongren', label: '武侠同人',   group: '武侠',     gender: 'male' },
  { value: 'gongfu',       label: '国术武学',   group: '武侠',     gender: 'male' },

  // === 男频科幻 ===
  { value: 'kehuan',       label: '科幻',       group: '科幻',     gender: 'male' },
  { value: 'xingji',       label: '星际战争',   group: '科幻',     gender: 'male' },
  { value: 'weilai',       label: '未来世界',   group: '科幻',     gender: 'male' },
  { value: 'shikong',      label: '时空穿梭',   group: '科幻',     gender: 'male' },
  { value: 'chaojikj',     label: '超级科技',   group: '科幻',     gender: 'male' },
  { value: 'moshi',        label: '末世危机',   group: '科幻',     gender: 'male' },
  { value: 'jinhua',       label: '进化变异',   group: '科幻',     gender: 'male' },

  // === 男频奇幻 ===
  { value: 'qihuan',       label: '奇幻',       group: '奇幻',     gender: 'male' },
  { value: 'xifangmh',     label: '西方魔幻',   group: '奇幻',     gender: 'male' },
  { value: 'shishiqh',     label: '史诗奇幻',   group: '奇幻',     gender: 'male' },
  { value: 'heianqh',      label: '黑暗奇幻',   group: '奇幻',     gender: 'male' },
  { value: 'jianyumf',     label: '剑与魔法',   group: '奇幻',     gender: 'male' },

  // === 男频都市 ===
  { value: 'dushi',        label: '都市',       group: '都市',     gender: 'male' },
  { value: 'dushishenghuo', label: '都市生活',  group: '都市',     gender: 'male' },
  { value: 'duyineng',     label: '都市异能',   group: '都市',     gender: 'male' },
  { value: 'yulemingxing', label: '娱乐明星',   group: '都市',     gender: 'male' },
  { value: 'shangzhan',    label: '商战职场',   group: '都市',     gender: 'male' },
  { value: 'jingsong',     label: '青春校园',   group: '都市',     gender: 'male' },
  { value: 'yangcheng',    label: '种田经营',   group: '都市',     gender: 'male' },

  // === 男频历史 ===
  { value: 'lishi',        label: '历史',       group: '历史',     gender: 'male' },
  { value: 'jiakong',      label: '架空历史',   group: '历史',     gender: 'male' },
  { value: 'qinhansg',     label: '秦汉三国',   group: '历史',     gender: 'male' },
  { value: 'songmingq',    label: '两宋元明',   group: '历史',     gender: 'male' },
  { value: 'lishichuanyue', label: '历史穿越',  group: '历史',     gender: 'male' },
  { value: 'minguo',       label: '民国军阀',   group: '历史',     gender: 'male' },

  // === 男频游戏/竞技 ===
  { value: 'youxi',        label: '游戏',       group: '游戏',     gender: 'male' },
  { value: 'dianjing',     label: '电子竞技',   group: '游戏',     gender: 'male' },
  { value: 'xunijingji',   label: '虚拟网游',   group: '游戏',     gender: 'male' },
  { value: 'yunzhonyou',   label: '游戏异界',   group: '游戏',     gender: 'male' },
  { value: 'tiyu',         label: '体育竞技',   group: '游戏',     gender: 'male' },

  // === 男频军事 ===
  { value: 'junshi',       label: '军事',       group: '军事',     gender: 'male' },
  { value: 'tiezhanze',    label: '铁血战争',   group: '军事',     gender: 'male' },
  { value: 'tewu',         label: '特种谍战',   group: '军事',     gender: 'male' },

  // === 男频/通用 灵异悬疑 ===
  { value: 'lingyi',       label: '灵异',       group: '悬疑',     gender: 'general' },
  { value: 'xuanyi',       label: '悬疑',       group: '悬疑',     gender: 'general' },
  { value: 'tanan',        label: '探案推理',   group: '悬疑',     gender: 'general' },
  { value: 'kongbu',       label: '恐怖惊悚',   group: '悬疑',     gender: 'general' },
  { value: 'minjian',      label: '民间传说',   group: '悬疑',     gender: 'general' },

  // === 女频 现代言情 ===
  { value: 'xiandaiyq',    label: '现代言情',   group: '言情',     gender: 'female' },
  { value: 'duqing',       label: '都市情感',   group: '言情',     gender: 'female' },
  { value: 'haomensj',     label: '豪门世家',   group: '言情',     gender: 'female' },
  { value: 'tianchong',    label: '甜宠文',     group: '言情',     gender: 'female' },
  { value: 'xueyuanqc',    label: '校园青春',   group: '言情',     gender: 'female' },
  { value: 'niandai',      label: '年代文',     group: '言情',     gender: 'female' },
  { value: 'zhongtian',    label: '种田生活',   group: '言情',     gender: 'female' },

  // === 女频 古代言情 ===
  { value: 'gudaiyq',      label: '古代言情',   group: '古言',     gender: 'female' },
  { value: 'gongdou',      label: '宫斗宅斗',   group: '古言',     gender: 'female' },
  { value: 'chuanyueg',    label: '穿越时空',   group: '古言',     gender: 'female' },
  { value: 'jianghu',      label: '江湖恩怨',   group: '古言',     gender: 'female' },
  { value: 'gudianyq',     label: '古典纯情',   group: '古言',     gender: 'female' },

  // === 女频 玄幻/仙侠言情 ===
  { value: 'xuanhuanyq',   label: '玄幻言情',   group: '玄幻言情', gender: 'female' },
  { value: 'xianxiayq',    label: '仙侠奇缘',   group: '玄幻言情', gender: 'female' },
  { value: 'qihuanyq',     label: '奇幻言情',   group: '玄幻言情', gender: 'female' },
  { value: 'xingjiyq',     label: '星际幻想',   group: '玄幻言情', gender: 'female' },

  // === 女频 纯爱 ===
  { value: 'chunai',       label: '纯爱（耽美）', group: '纯爱',  gender: 'female' },
  { value: 'baihe',        label: '百合',         group: '纯爱',  gender: 'female' },

  // === 女频 同人/衍生 ===
  { value: 'tongren',      label: '同人衍生',   group: '衍生',     gender: 'female' },
  { value: 'erciyuan',     label: '二次元',     group: '衍生',     gender: 'general' },
  { value: 'qingxs',       label: '轻小说',     group: '衍生',     gender: 'general' },

  // === 现实/题材 ===
  { value: 'xianshi',      label: '现实题材',   group: '现实',     gender: 'general' },
  { value: 'duanpian',     label: '短篇合集',   group: '现实',     gender: 'general' },

  // === 兜底 ===
  { value: 'other',        label: '其他',       group: '其他',     gender: 'general' },
] as const

/** 按 group 分组的索引（首次访问时计算并缓存） */
export const GENRE_GROUPS: ReadonlyArray<readonly [string, readonly GenrePreset[]]> = (() => {
  const map = new Map<string, GenrePreset[]>()
  for (const g of GENRE_PRESETS) {
    if (!map.has(g.group)) map.set(g.group, [])
    map.get(g.group)!.push(g)
  }
  return Array.from(map.entries()).map(([k, v]) => [k, v as readonly GenrePreset[]] as const)
})()

/** 按 gender 筛选 */
export function filterByGender(gender: GenreGender | 'all'): readonly GenrePreset[] {
  if (gender === 'all') return GENRE_PRESETS
  return GENRE_PRESETS.filter(g => g.gender === gender || g.gender === 'general')
}

/** 通过 value 取 label */
export function getGenreLabel(value: string): string {
  return GENRE_PRESETS.find(g => g.value === value)?.label ?? value
}
