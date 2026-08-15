import type { CreativeReliabilityEvalSplitV1 } from './types'

export const CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1 =
  'crel-story-arc-zh-development-6-heldout-6-v1'

export interface CreativeReliabilityFixtureCharacterV1 {
  name: string
  role: 'protagonist' | 'antagonist' | 'supporting'
  personality: string
  motivation: string
  background: string
}

export interface CreativeReliabilityFixtureV1 {
  id: string
  split: CreativeReliabilityEvalSplitV1
  cohort: 'concept-only' | 'world-only' | 'character-only' | 'partial' | 'developed'
  projectName: string
  genre: string
  worldName: string
  worldOrigin: string
  worldRules: string
  theme: string
  centralConflict: string
  logline: string
  mainPlot: string
  characters: CreativeReliabilityFixtureCharacterV1[]
  authorRequest: string
  requiredFacts: Array<{ id: string; description: string }>
  forbiddenFacts: string[]
}

export const CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1:
readonly CreativeReliabilityFixtureV1[] = [
  {
    id: 'crel-dev-01-floating-library', split: 'development', cohort: 'world-only',
    projectName: '坠落书库', genre: '奇幻', worldName: '浮页群岛',
    worldOrigin: '每座岛都是一本失去读者后升空的书，书页脱落时岛屿会下降。',
    worldRules: '被公开朗读的文字会暂时成为现实，但同一段文字只能生效一次。',
    theme: '', centralConflict: '', logline: '', mainPlot: '', characters: [],
    authorRequest: '基于现有世界观生成 main 主线。不要介绍设定，要提出主角目标、阻力、不可逆选择和下一步压力。',
    requiredFacts: [
      { id: 'f1', description: '书页脱落会让岛屿下降。' },
      { id: 'f2', description: '公开朗读可让文字暂时成真，但每段只能生效一次。' },
      { id: 'f3', description: '主线必须发生行动和状态变化，而不是只介绍浮岛。' },
    ],
    forbiddenFacts: ['同一段文字可以无限重复生效', '书页脱落不会影响岛屿'],
  },
  {
    id: 'crel-dev-02-rented-memory', split: 'development', cohort: 'concept-only',
    projectName: '记忆租期', genre: '都市悬疑', worldName: '当代城市',
    worldOrigin: '', worldRules: '', theme: '记忆能否构成责任', centralConflict: '',
    logline: '一个替陌生人保管记忆的人，发现其中一段记忆正在指认自己。', mainPlot: '', characters: [],
    authorRequest: '从这个概念生成 main 主线，允许补足临时人物和机制，但必须把它们标成候选假设，并推动调查。',
    requiredFacts: [
      { id: 'f1', description: '主角替陌生人保管记忆。' },
      { id: 'f2', description: '某段记忆指认主角，形成调查压力。' },
      { id: 'f3', description: '新增机制应服务人物选择而非背景堆砌。' },
    ], forbiddenFacts: ['开场直接证明主角无罪', '把记忆设定写成无关百科'],
  },
  {
    id: 'crel-dev-03-bridge-repair', split: 'development', cohort: 'character-only',
    projectName: '洪水前的桥', genre: '现实情感', worldName: '河谷小城',
    worldOrigin: '', worldRules: '', theme: '', centralConflict: '', logline: '', mainPlot: '',
    characters: [{
      name: '周岚', role: 'protagonist', personality: '寡言、遇事先动手解决',
      motivation: '在汛期前修好父亲生前设计却因事故停工的桥。',
      background: '桥梁工程师，事故后离开故乡五年。',
    }],
    authorRequest: '围绕周岚生成 main 主线，补足对手与外部期限；不要反复回忆父亲，要让她不断做决定。',
    requiredFacts: [
      { id: 'f1', description: '周岚必须在汛期前修桥。' },
      { id: 'f2', description: '父亲与停工事故是压力来源而非反复说明。' },
      { id: 'f3', description: '主线包含连续行动、阻力和选择。' },
    ], forbiddenFacts: ['父亲突然复活解决工程', '主线只有童年回忆'],
  },
  {
    id: 'crel-dev-04-time-debt', split: 'development', cohort: 'partial',
    projectName: '借来的明天', genre: '科幻', worldName: '极昼殖民地',
    worldOrigin: '居民可抵押未来寿命换取当下的能源配额。',
    worldRules: '寿命债不可转嫁给未签署者；系统只记录签署行为，不判断胁迫。',
    theme: '选择与代际责任', centralConflict: '主角发现整座学校的配额来自一份受胁迫签署的寿命债。',
    logline: '', mainPlot: '',
    characters: [{
      name: '黎序', role: 'protagonist', personality: '精确克制',
      motivation: '保住学校供暖，同时终止胁迫签署。', background: '殖民地能源审计员。',
    }],
    authorRequest: '生成 main 主线，必须在供暖、证据和不可转嫁规则之间形成逐步升级的选择。',
    requiredFacts: [
      { id: 'f1', description: '寿命债不可转嫁给未签署者。' },
      { id: 'f2', description: '系统不能识别胁迫。' },
      { id: 'f3', description: '保暖与停止胁迫必须同时构成困境。' },
    ], forbiddenFacts: ['系统自动判定并撤销所有胁迫合同', '寿命债可随意转嫁'],
  },
  {
    id: 'crel-dev-05-borrowed-name', split: 'development', cohort: 'partial',
    projectName: '借名一日', genre: '历史幻想', worldName: '临川府',
    worldOrigin: '无名者可借用族谱中的一个姓名生活一天，并继承该名最后一位死者的一项义务。',
    worldRules: '姓名日落失效；义务未完成会留在借名者身上，但记忆不会继承。',
    theme: '身份与承诺', centralConflict: '', logline: '', mainPlot: '', characters: [],
    authorRequest: '生成 main 主线，让一次借名引出可持续升级的义务链；不得靠继承死者记忆破案。',
    requiredFacts: [
      { id: 'f1', description: '借名只持续到日落。' },
      { id: 'f2', description: '会继承义务但不会继承记忆。' },
      { id: 'f3', description: '义务链要迫使主角持续行动与选择。' },
    ], forbiddenFacts: ['借名者继承死者完整记忆', '姓名永久有效'],
  },
  {
    id: 'crel-dev-06-seed-bank', split: 'development', cohort: 'developed',
    projectName: '最后一袋种子', genre: '乡土剧情', worldName: '旱原村落',
    worldOrigin: '连续三年干旱后，村里只剩合作社的一袋耐旱种子。',
    worldRules: '种子足够种一片试验田，不能覆盖全村；收成至少需要一个雨季。',
    theme: '信任与共同承担', centralConflict: '各家都想分走种子，而分散播种会让试验失败。',
    logline: '返乡农技员必须让彼此失信的村民共同完成一片试验田。',
    mainPlot: '公开数据、决定田址、应对偷种、分配劳动和未来收益。',
    characters: [{
      name: '许穗', role: 'protagonist', personality: '务实但不擅长处理旧人情',
      motivation: '完成试验田并建立可查的收益分配。', background: '离村十年的农技员。',
    }],
    authorRequest: '生成 main 主线；每阶段都要改变合作关系，不能用突然降雨解决核心冲突。',
    requiredFacts: [
      { id: 'f1', description: '种子只够一片试验田。' },
      { id: 'f2', description: '收成需要至少一个雨季。' },
      { id: 'f3', description: '每阶段推进合作关系和分配选择。' },
    ], forbiddenFacts: ['突然降雨立即解决全部问题', '种子足够全村随意分'],
  },
] as const

// Holdout 内容冻结后只允许最终运行一次。不得用其结果调参；失败样例也必须保留。
export const CREATIVE_RELIABILITY_HELDOUT_FIXTURES_V1:
readonly CreativeReliabilityFixtureV1[] = [
  {
    id: 'crel-held-01-drowned-bells', split: 'held-out', cohort: 'world-only',
    projectName: '沉钟群岛', genre: '海洋奇幻', worldName: '潮下诸岛',
    worldOrigin: '退潮时海底钟楼会露出一小时，岛民靠钟声决定下一季迁徙方向。',
    worldRules: '每口钟只能被同一个人敲响一次；错误钟声不会被第二次敲击撤销。',
    theme: '', centralConflict: '', logline: '', mainPlot: '', characters: [],
    authorRequest: '生成 main 主线，用一次不可撤销的错误钟声迫使人物行动，不要只描写群岛。',
    requiredFacts: [
      { id: 'f1', description: '钟楼只在退潮时露出一小时。' },
      { id: 'f2', description: '同一人只能敲同一口钟一次，错误不可撤销。' },
      { id: 'f3', description: '错误钟声造成持续行动和选择。' },
    ], forbiddenFacts: ['同一人可反复敲钟纠错', '钟声错误没有后果'],
  },
  {
    id: 'crel-held-02-shadow-testimony', split: 'held-out', cohort: 'concept-only',
    projectName: '影子证词', genre: '法庭幻想', worldName: '近代城市',
    worldOrigin: '', worldRules: '', theme: '证据与解释权', centralConflict: '',
    logline: '律师发现证人的影子在法庭上做出了与本人相反的动作。', mainPlot: '', characters: [],
    authorRequest: '从概念生成 main 主线，补足影子机制为临时候选，并让案件持续推进。',
    requiredFacts: [
      { id: 'f1', description: '影子动作与证人陈述相反。' },
      { id: 'f2', description: '机制不能直接等同于绝对真相。' },
      { id: 'f3', description: '案件通过调查和选择推进。' },
    ], forbiddenFacts: ['影子永远说绝对真话', '开庭即自动结案'],
  },
  {
    id: 'crel-held-03-genetic-archive', split: 'held-out', cohort: 'character-only',
    projectName: '失配档案', genre: '太空剧情', worldName: '远航殖民舰',
    worldOrigin: '', worldRules: '', theme: '', centralConflict: '', logline: '', mainPlot: '',
    characters: [{
      name: '任澈', role: 'protagonist', personality: '守规程、惧怕公开犯错',
      motivation: '查明为什么自己的基因档案与出生舱记录不匹配。',
      background: '殖民舰档案员，负责即将到来的定居资格核验。',
    }],
    authorRequest: '围绕任澈生成 main 主线，补足制度压力与对手；不要把不匹配直接解释成克隆阴谋。',
    requiredFacts: [
      { id: 'f1', description: '基因档案与出生舱记录不匹配。' },
      { id: 'f2', description: '定居资格核验形成期限。' },
      { id: 'f3', description: '任澈必须通过行动承担公开错误的风险。' },
    ], forbiddenFacts: ['开场直接证实克隆阴谋', '不匹配对资格没有影响'],
  },
  {
    id: 'crel-held-04-night-elevator', split: 'held-out', cohort: 'partial',
    projectName: '夜班电梯', genre: '都市奇幻', worldName: '旧商业区',
    worldOrigin: '午夜后，写字楼电梯会停靠在被公司从档案中删除的楼层。',
    worldRules: '乘客只能带回一件被删除的物品，不能带回人；天亮前必须离开。',
    theme: '劳动与被抹去的历史', centralConflict: '', logline: '', mainPlot: '', characters: [],
    authorRequest: '生成 main 主线，让每次进入删除楼层都带来新代价和选择，不能突破只能带回物品的规则。',
    requiredFacts: [
      { id: 'f1', description: '电梯只在午夜后通往删除楼层。' },
      { id: 'f2', description: '只能带回一件物品，不能带回人，天亮前离开。' },
      { id: 'f3', description: '每次进入都升级人物代价。' },
    ], forbiddenFacts: ['可以把被删除的人带回现实', '白天也可自由进入'],
  },
  {
    id: 'crel-held-05-salt-ledger', split: 'held-out', cohort: 'partial',
    projectName: '盐册失页', genre: '历史悬疑', worldName: '沿海盐场',
    worldOrigin: '盐场以双册记工，一册由官署保管，一册由灶户轮值保管。',
    worldRules: '两册同时相符才可结算；缺页只能由当日全部轮值者共同补证。',
    theme: '共同证词与利益', centralConflict: '民册缺了一页，官册却多出一批不存在的盐。',
    logline: '', mainPlot: '', characters: [],
    authorRequest: '生成 main 主线，围绕双册差异逐步调查；不能靠单人伪造补页完成结算。',
    requiredFacts: [
      { id: 'f1', description: '官册和民册同时相符才可结算。' },
      { id: 'f2', description: '缺页需当日全部轮值者共同补证。' },
      { id: 'f3', description: '不存在的盐与失页形成调查链。' },
    ], forbiddenFacts: ['单人可合法补写缺页', '只看官册即可结算'],
  },
  {
    id: 'crel-held-06-delayed-message', split: 'held-out', cohort: 'developed',
    projectName: '十二年后回信', genre: '科幻情感', worldName: '双星通信带',
    worldOrigin: '两颗殖民星之间的单程讯息延迟六年。',
    worldRules: '讯息一经发送无法撤回；双方每年只获准发送一次公共频道长信。',
    theme: '承诺与变化', centralConflict: '两名共同设计生态站的人必须用十二年前的承诺处理今天的灾难。',
    logline: '生态学家在每封回信都要十二年才形成往返的条件下，试图与旧搭档共同阻止生态站崩溃。',
    mainPlot: '发现崩溃征兆、解读旧信、决定当年唯一长信内容、承担对方已经改变的风险。',
    characters: [{
      name: '程月', role: 'protagonist', personality: '谨慎、总想把话说完整',
      motivation: '修复生态站，也确认旧搭档是否仍愿承担共同责任。', background: '留在内星的生态学家。',
    }],
    authorRequest: '生成 main 主线，严格遵守六年单程延迟和每年一封限制，让关系与危机同步推进。',
    requiredFacts: [
      { id: 'f1', description: '讯息单程延迟六年且无法撤回。' },
      { id: 'f2', description: '双方每年只能发送一次公共长信。' },
      { id: 'f3', description: '生态危机和关系选择同步升级。' },
    ], forbiddenFacts: ['双方进行即时通信', '发送后可以撤回改信'],
  },
] as const

export function getCreativeReliabilityFixturesV1(split: CreativeReliabilityEvalSplitV1) {
  return split === 'development'
    ? CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1
    : CREATIVE_RELIABILITY_HELDOUT_FIXTURES_V1
}
