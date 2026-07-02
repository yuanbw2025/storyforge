/**
 * 题材元数据 — Phase E1
 *
 * 每个题材的结构化元信息：反模式、节奏策略、典型结构。
 * 用于 AI 生成时注入额外约束。
 */

export interface GenreMetadata {
  id: string
  label: string
  emoji: string
  description: string
  /** AI 应避免的套路 */
  antiPatterns: string[]
  /** 节奏策略 */
  pacingStrategy: string
  /** 典型结构（用于大纲生成参考） */
  typicalStructure: { title: string; description: string }[]
}

export const GENRE_METADATA: GenreMetadata[] = [
  // ── 已有 4 个题材（补充元数据） ──
  {
    id: 'xianxia',
    label: '仙侠修真',
    emoji: '☯️',
    description: '飞升体系、人间道义、正邪较量',
    antiPatterns: [
      '避免过度堆砌境界名称',
      '避免"踩脸打脸"循环套路',
      '避免丹药/法宝无限叠加',
      '避免女性角色沦为附庸',
    ],
    pacingStrategy: '前期慢节奏铺垫世界观和人物关系，中期交替升级与探索，每卷末设置"天劫/大考验"高潮',
    typicalStructure: [
      { title: '入门篇', description: '凡人机缘、拜师入门、初识修行' },
      { title: '历练篇', description: '门派试炼、结识同伴、初露锋芒' },
      { title: '争锋篇', description: '宗门大比、敌对势力、实力飞跃' },
      { title: '风云篇', description: '更大的世界、隐藏的秘密、力量蜕变' },
      { title: '飞升篇', description: '终极对决、大道抉择、飞升或超脱' },
    ],
  },
  {
    id: 'yanqing',
    label: '言情',
    emoji: '💗',
    description: '情感细腻、双视角心理戏、CP张力',
    antiPatterns: [
      '避免"霸道总裁"千篇一律的人设',
      '避免误会推动全部剧情',
      '避免配角沦为工具人',
      '避免感情线没有成长弧',
    ],
    pacingStrategy: '甜虐交替节奏，3章甜1章虐为基础节奏，每卷有一次大危机考验感情',
    typicalStructure: [
      { title: '相遇篇', description: '命运交汇、初印象反差、暗生情愫' },
      { title: '靠近篇', description: '日常互动、心理博弈、感情升温' },
      { title: '危机篇', description: '误解/外力介入、分离、内心挣扎' },
      { title: '重逢篇', description: '真相大白、坦诚相待、感情升华' },
    ],
  },
  {
    id: 'realism',
    label: '现实主义',
    emoji: '🌃',
    description: '日常感、内心戏与时代切片',
    antiPatterns: [
      '避免脱离现实的巧合',
      '避免说教性过强的叙述',
      '避免人物行为不符合社会背景',
      '避免忽视细节真实感',
    ],
    pacingStrategy: '整体平稳推进，关键节点适度加速，用日常细节积蓄情感张力',
    typicalStructure: [
      { title: '日常', description: '建立人物的日常生活与困境' },
      { title: '变化', description: '打破平衡的事件，推动人物做出选择' },
      { title: '挣扎', description: '矛盾深化，内心与外部冲突交织' },
      { title: '蜕变', description: '人物在困境中成长或妥协的结局' },
    ],
  },
  {
    id: 'suspense',
    label: '悬疑推理',
    emoji: '🔍',
    description: '信息控制、不可靠叙事、伏笔密度高',
    antiPatterns: [
      '避免凶手身份过早暴露',
      '避免线索出现但不回收',
      '避免超自然解释代替逻辑推理',
      '避免侦探角色全知全能',
    ],
    pacingStrategy: '节奏由松到紧，前1/3铺设谜面+误导，中段反转，尾段加速揭示真相',
    typicalStructure: [
      { title: '谜面', description: '案件发生、角色登场、表面线索展示' },
      { title: '调查', description: '深入挖掘、嫌疑人盘查、伏笔布局' },
      { title: '误导', description: '假象破灭、新线索出现、视角反转' },
      { title: '真相', description: '逻辑推演、揭开谜底、收束伏笔' },
    ],
  },

  // ── Phase E1: 新增 16 个题材 ──
  {
    id: 'xuanhuan',
    label: '玄幻',
    emoji: '🐉',
    description: '宏大世界观、天赋体系、热血升级',
    antiPatterns: [
      '避免无脑升级无剧情',
      '避免反派智商下线',
      '避免设定前后矛盾',
      '避免战斗只靠数值碾压',
    ],
    pacingStrategy: '升级-战斗-探索三段式循环，每10章一个小高潮，每卷一个大决战',
    typicalStructure: [
      { title: '崛起', description: '废柴逆袭、获得机缘、初入江湖' },
      { title: '争雄', description: '势力冲突、实力飞跃、结交盟友' },
      { title: '称霸', description: '更高层面的较量、揭开世界真相' },
      { title: '巅峰', description: '终极挑战、突破极限、封神或超脱' },
    ],
  },
  {
    id: 'wuxia',
    label: '武侠',
    emoji: '⚔️',
    description: '江湖恩怨、侠义精神、门派纷争',
    antiPatterns: [
      '避免武功等级过于量化',
      '避免正邪二元对立过于简单',
      '避免忽视江湖规矩与人情世故',
    ],
    pacingStrategy: '以事件驱动节奏，恩怨交替推进，关键打斗浓墨重彩',
    typicalStructure: [
      { title: '出山', description: '少年入江湖、师门传承、初遇恩怨' },
      { title: '闯荡', description: '行走江湖、结识群侠、卷入纷争' },
      { title: '风波', description: '武林大会、门派争锋、身世揭秘' },
      { title: '归隐', description: '最终决战、了却恩仇、归隐或传承' },
    ],
  },
  {
    id: 'dushi',
    label: '都市',
    emoji: '🏙️',
    description: '现代都市背景、职场/商战/生活',
    antiPatterns: [
      '避免主角万能无短板',
      '避免女角色只做花瓶',
      '避免脱离现代社会常识',
    ],
    pacingStrategy: '事件驱动为主，日常与危机交替，感情线穿插其中调节节奏',
    typicalStructure: [
      { title: '起步', description: '主角的日常困境与转折机遇' },
      { title: '发展', description: '逐步崛起、人际网络扩展' },
      { title: '危机', description: '重大挑战、对手出现、内外压力' },
      { title: '巅峰', description: '终极对决、事业与感情的抉择' },
    ],
  },
  {
    id: 'lishi',
    label: '历史',
    emoji: '📜',
    description: '历史背景、朝堂权谋、架空或考据',
    antiPatterns: [
      '避免严重违背历史常识（非架空时）',
      '避免现代思维套用古人',
      '避免朝堂戏过于脸谱化',
    ],
    pacingStrategy: '大事件为节奏锚点，日常铺垫与朝堂博弈交替，战争场面集中爆发',
    typicalStructure: [
      { title: '入局', description: '主角进入权力核心、初识格局' },
      { title: '布局', description: '政治博弈、结盟对抗、暗流涌动' },
      { title: '变局', description: '重大转折、战争或政变、命运抉择' },
      { title: '定局', description: '天下大势已定、功过评说' },
    ],
  },
  {
    id: 'scifi',
    label: '科幻',
    emoji: '🚀',
    description: '科学设定、未来社会、星际探索',
    antiPatterns: [
      '避免伪科学解释核心设定',
      '避免技术万能论',
      '避免忽视社会变革对人的影响',
    ],
    pacingStrategy: '探索-发现-危机三段循环，科技设定穿插展开，避免信息倾倒',
    typicalStructure: [
      { title: '发现', description: '科技突破或异常现象、引出核心设定' },
      { title: '探索', description: '深入未知、团队组建、世界观展开' },
      { title: '危机', description: '技术失控或外来威胁、人性考验' },
      { title: '抉择', description: '终极博弈、科技与人性的平衡' },
    ],
  },
  {
    id: 'moshi',
    label: '末世',
    emoji: '☠️',
    description: '末日求生、人性考验、废土探索',
    antiPatterns: [
      '避免主角独善其身不需要队伍',
      '避免资源问题无限忽略',
      '避免丧尸/怪物只是背景板',
    ],
    pacingStrategy: '紧张-喘息交替节奏，每次探索带来新危机，安全区域作为缓冲段',
    typicalStructure: [
      { title: '末日降临', description: '灾变发生、主角求生、组建小队' },
      { title: '废土求生', description: '探索废墟、争夺资源、人性博弈' },
      { title: '势力纷争', description: '避难所冲突、阵营选择、信任危机' },
      { title: '希望曙光', description: '找到出路或接受新世界' },
    ],
  },
  {
    id: 'chuanyue',
    label: '穿越',
    emoji: '🌀',
    description: '穿越时空、利用先知优势、改变命运',
    antiPatterns: [
      '避免主角事事靠先知',
      '避免配角完全没有主观能动性',
      '避免历史/异世界完全按主角剧本走',
    ],
    pacingStrategy: '前期立足（3-5章），中期以先知优势发展，后期蝴蝶效应制造不可预测性',
    typicalStructure: [
      { title: '初来', description: '穿越降临、适应环境、确立身份' },
      { title: '立足', description: '利用先知、积累实力、初露锋芒' },
      { title: '变局', description: '蝴蝶效应、计划被打乱、真正考验' },
      { title: '归宿', description: '改变命运或接受宿命' },
    ],
  },
  {
    id: 'chongsheng',
    label: '重生',
    emoji: '🔄',
    description: '重回过去、弥补遗憾、逆转人生',
    antiPatterns: [
      '避免重生后一切顺遂',
      '避免只靠记忆碾压而不成长',
      '避免感情线过于套路化',
    ],
    pacingStrategy: '前期快速改变关键节点，中期遭遇新问题，后期面对前世没有的挑战',
    typicalStructure: [
      { title: '重生', description: '回到过去、明确目标、开始改变' },
      { title: '布局', description: '利用记忆弥补遗憾、提前布局' },
      { title: '偏差', description: '蝴蝶效应导致未知变化、新挑战' },
      { title: '超越', description: '超越前世格局、真正的成长' },
    ],
  },
  {
    id: 'xitong',
    label: '系统流',
    emoji: '📱',
    description: '获得系统辅助、任务升级、数值成长',
    antiPatterns: [
      '避免系统万能无限制',
      '避免主角完全依赖系统',
      '避免任务设置机械无趣',
    ],
    pacingStrategy: '任务驱动节奏，完成-奖励-新任务循环，穿插系统隐藏设定揭示',
    typicalStructure: [
      { title: '绑定', description: '获得系统、熟悉规则、完成新手任务' },
      { title: '成长', description: '任务升级、能力增强、初显锋芒' },
      { title: '真相', description: '系统来源揭秘、隐藏目的、抉择' },
      { title: '超越', description: '脱离系统束缚或与系统共存' },
    ],
  },
  {
    id: 'wuxian',
    label: '无限流',
    emoji: '🎮',
    description: '穿越不同世界/副本、团队协作、生存挑战',
    antiPatterns: [
      '避免副本之间毫无联系',
      '避免队友只是消耗品',
      '避免主角独狼通关',
    ],
    pacingStrategy: '副本为单元节奏，每个副本内紧凑推进，副本间休整期发展人物关系',
    typicalStructure: [
      { title: '新手副本', description: '规则建立、团队初组、基础生存' },
      { title: '成长副本', description: '难度升级、策略深化、团队磨合' },
      { title: '高难副本', description: '死亡威胁、背叛与信任、终极挑战' },
      { title: '终局', description: '揭示幕后真相、逃脱或超越' },
    ],
  },
  {
    id: 'cyberpunk',
    label: '赛博朋克',
    emoji: '🤖',
    description: '高科技低生活、义体改造、公司阴谋',
    antiPatterns: [
      '避免科技只是装饰',
      '避免忽视阶层矛盾',
      '避免赛博世界过于乌托邦',
    ],
    pacingStrategy: '任务驱动推进，黑客入侵+街头行动交替，信息碎片逐步拼出全貌',
    typicalStructure: [
      { title: '底层', description: '边缘人物的日常、接触地下世界' },
      { title: '入局', description: '接下大单、卷入公司阴谋' },
      { title: '觉醒', description: '发现真相、义体与人性的选择' },
      { title: '反抗', description: '对抗系统或融入系统' },
    ],
  },
  {
    id: 'cthulhu',
    label: '克苏鲁',
    emoji: '🐙',
    description: '未知恐惧、理智崩溃、不可名状之物',
    antiPatterns: [
      '避免怪物战斗化',
      '避免主角轻松克服恐惧',
      '避免过度解释不可知之物',
    ],
    pacingStrategy: '恐惧递进，从日常违和到认知崩塌，信息获取越多越恐惧，控制节奏避免麻木',
    typicalStructure: [
      { title: '日常', description: '看似正常的世界，细微的违和感' },
      { title: '调查', description: '追寻线索、接触禁忌知识' },
      { title: '深渊', description: '直面不可名状之物、理智动摇' },
      { title: '结局', description: '疯狂、死亡或艰难存活' },
    ],
  },
  {
    id: 'zhongtian',
    label: '种田',
    emoji: '🌾',
    description: '经营建设、发展壮大、慢节奏成长',
    antiPatterns: [
      '避免建设过于轻松无阻力',
      '避免完全没有外部冲突',
      '避免经济系统不合理',
    ],
    pacingStrategy: '建设与挑战交替，每个阶段有新的发展目标和对应危机，整体偏慢但不无聊',
    typicalStructure: [
      { title: '初建', description: '获得领地/基地、从零开始' },
      { title: '发展', description: '引进人才、扩大规模、解决资源' },
      { title: '危机', description: '外敌入侵或内部矛盾、保卫家园' },
      { title: '繁荣', description: '成为一方势力、影响力辐射' },
    ],
  },
  {
    id: 'zhengba',
    label: '争霸',
    emoji: '👑',
    description: '权谋争斗、势力扩张、天下争霸',
    antiPatterns: [
      '避免主角全靠个人武力',
      '避免政治博弈过于简单',
      '避免忽视后勤补给等现实问题',
    ],
    pacingStrategy: '政治-军事-内政三线交替，大战役为节奏高潮，内政期间铺垫伏笔',
    typicalStructure: [
      { title: '起兵', description: '获得初始势力、站稳脚跟' },
      { title: '扩张', description: '征伐四方、招揽人才、势力壮大' },
      { title: '角逐', description: '强敌对峙、合纵连横、决定性战役' },
      { title: '天下', description: '统一或平衡、功臣安置、新秩序' },
    ],
  },
  {
    id: 'xifan',
    label: '西幻/奇幻',
    emoji: '🧙',
    description: '魔法世界、种族纷争、史诗冒险',
    antiPatterns: [
      '避免魔法体系无规则',
      '避免种族设定只是换皮人类',
      '避免任务过于游戏化',
    ],
    pacingStrategy: '冒险-休整交替，每个区域/地牢为一个节奏单元，史诗战争为全书高潮',
    typicalStructure: [
      { title: '启程', description: '接受使命、组建冒险队伍' },
      { title: '历险', description: '穿越不同地域、遭遇挑战与诱惑' },
      { title: '深渊', description: '至暗时刻、队伍分裂或牺牲' },
      { title: '决战', description: '终极对决、拯救世界或改变格局' },
    ],
  },
  {
    id: 'shishi',
    label: '史诗奇幻',
    emoji: '🏰',
    description: '宏大世界、群像远征、文明与命运级冲突',
    antiPatterns: [
      '避免只堆设定而缺少人物选择',
      '避免阵营过多导致主线失焦',
      '避免史诗战争没有代价和后果',
    ],
    pacingStrategy: '个人使命与世界格局交替推进，以远征、盟约、战争和牺牲构成卷级高潮',
    typicalStructure: [
      { title: '召唤', description: '危机显现、主角卷入宏大使命' },
      { title: '结盟', description: '穿越地域与阵营，建立同盟或队伍' },
      { title: '大战', description: '文明级冲突爆发，付出关键代价' },
      { title: '终局', description: '命运抉择、世界秩序被重写或守住' },
    ],
  },
  {
    id: 'heian',
    label: '黑暗奇幻',
    emoji: '🕯️',
    description: '残酷世界、道德灰度、诅咒与代价',
    antiPatterns: [
      '避免为黑暗而黑暗，缺少角色动机',
      '避免残酷事件没有剧情后果',
      '避免把所有阵营都写成同质化邪恶',
    ],
    pacingStrategy: '压迫感逐步升级，在短暂喘息后设置更高代价的选择，高潮强调牺牲与不可逆后果',
    typicalStructure: [
      { title: '阴影', description: '建立残酷秩序、诅咒或腐化源头' },
      { title: '交易', description: '角色为生存或目标付出代价' },
      { title: '沦陷', description: '信任破裂、阵营崩坏或内心腐化' },
      { title: '代价', description: '以不完美胜利或沉重牺牲收束' },
    ],
  },
  {
    id: 'youxi',
    label: '游戏',
    emoji: '🎯',
    description: '游戏世界、副本挑战、竞技对抗',
    antiPatterns: [
      '避免数值设定过于复杂难懂',
      '避免游戏外完全没有生活',
      '避免技能只是换名的魔法',
    ],
    pacingStrategy: '副本/赛事为节奏单元，训练-比赛循环，游戏内外双线交叉',
    typicalStructure: [
      { title: '入坑', description: '接触游戏、发现天赋、加入队伍' },
      { title: '训练', description: '磨练技术、探索系统、团队磨合' },
      { title: '赛场', description: '正式比赛/排位、遭遇强敌' },
      { title: '巅峰', description: '冠军争夺或终极副本挑战' },
    ],
  },
]

const GENRE_METADATA_ALIASES: Record<string, string> = {
  kehuan: 'scifi',
  qihuan: 'xifan',
  xifang: 'xifan',
}

export function normalizeGenreMetadataId(genreId: string): string {
  return GENRE_METADATA_ALIASES[genreId] ?? genreId
}

/**
 * 根据题材 ID 获取元数据
 */
export function getGenreMetadata(genreId: string): GenreMetadata | undefined {
  const normalized = normalizeGenreMetadataId(genreId)
  return GENRE_METADATA.find(g => g.id === normalized)
}

/**
 * 构建题材约束上下文（注入 AI prompt）
 */
export function buildGenreConstraintContext(genreIds: string | string[]): string {
  const ids = (Array.isArray(genreIds) ? genreIds : [genreIds])
    .map(id => id.trim())
    .filter(Boolean)
  const metas = new Map<string, GenreMetadata>()
  for (const id of ids) {
    const meta = getGenreMetadata(id)
    if (meta) metas.set(meta.id, meta)
  }
  if (metas.size === 0) return ''

  return Array.from(metas.values()).map(meta => {
    const parts: string[] = [`【题材约束：${meta.label}】`]

    if (meta.antiPatterns.length > 0) {
      parts.push(`反模式（请避免）：${meta.antiPatterns.join('；')}`)
    }
    if (meta.pacingStrategy) {
      parts.push(`节奏策略：${meta.pacingStrategy}`)
    }

    return parts.join('\n')
  }).join('\n\n')
}
