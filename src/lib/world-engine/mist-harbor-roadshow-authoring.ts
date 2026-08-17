import { adopt } from '../registry/adopt'
import { useHistoricalStore } from '../../stores/historical'
import type {
  Chapter,
  DetailedOutline,
  HistoricalKeyword,
  HistoricalTimelineEvent,
  OutlineNode,
  WorkspaceScope,
} from '../types'
import { readOwnedRows } from './scope'
import {
  MIST_HARBOR_ROADSHOW_BEATS,
  MIST_HARBOR_ROADSHOW_NODES,
} from './mist-harbor-roadshow-story'

export interface MistHarborAuthoringSummary {
  worldRuleEntryCount: number
  historicalEventCount: number
  historicalKeywordCount: number
  storyCoreCount: number
  outlineNodeCount: number
  chapterCount: number
  detailedOutlineCount: number
  foreshadowCount: number
}

const WORLDVIEW = {
  geography: '雾港位于长雾海北缘的凹形玄武岩海湾。城市依山势分成上城、潮灯中城与沿堤下港，五条防潮堤围出内港，北塔灯室和失声钟楼分别把守海湾两端。退潮时会露出通向旧泵站的石脊，黑潮来临时则全部没入海面。',
  history: '雾港以潮汐钟落成之年为钟历元年。钟历三十七年发生黑潮事故，四十七名钟机工与船员死亡，官方将事故归因于极端天气；钟历四十七年，潮汐迟到十三分钟，港民姓名开始从登记册和记忆中褪去。',
  society: '港议会、巡潮队、守灯人和商港行会构成城市秩序。议会掌握钟机档案与封港权；巡潮队维护堤岸和宵禁；守灯人负责公共航标；行会控制物资与船位。普通港民依靠潮牌获得工作、配给和撤离顺序。',
  culture: '雾港没有神权组织。市民相信记录、灯火与公开见证能够抵抗遗忘。守灯人旧誓“灯未熄，港未沉”属于公共职责而非血统特权；葬礼会把逝者姓名写在耐盐铜片上，投入钟楼下的回声井。',
  economy: { currency: '雾铢与议会潮票', industries: ['远洋转运', '钟机维修', '盐晶加工', '潮灯制造'], trade: '依靠长雾海航线与限时开港窗口' },
  rules: '潮汐钟通过低频共振校准内港水位；过载时会从全城记录与人的记忆中抽取可被编码的姓名信息。任何修复都必须遵守能量守恒：恢复潮声、保存记忆与避免黑潮冲击三者不可同时无代价满足。',
  worldOrigin: '这是一个以近代工业、海港自治和低度奇异科技为基础的架空世界。雾港由最早穿越长雾海的测潮船队建立，城市围绕一台能把月潮转化为机械动力的潮汐钟成长。奇异现象来自可测量的潮汐共振，不存在神明直接干预。',
  powerHierarchy: '力量不以个人修炼划分，而以对潮汐共振工学的理解和设备权限划分：普通港民只能使用潮灯与潮牌；钟机师可校准支线设备；守灯人与巡潮官持有关键设施通行权；只有三枚权限印记同时生效时，才能接管潮汐钟主轴。',
  divineDesign: { hasDivinity: false, divineRank: '无神明层级', divineNames: '无', divineRules: '所谓海神与潮语是港民对共振现象的民俗解释，剧情中的关键因果必须能由设备、制度、记录与人物选择追溯。' },
  worldStructure: '单一海洋星球上的沿海城市与近海群岛。当前故事聚焦雾港内港、北部灯塔、防波堤钟楼和可航行的长雾海；远方世界只以航线、商船与失踪记录出现。',
  worldDimensions: '雾港主城区东西约十二公里、南北约九公里；内港宽四公里。步行横穿城区约两小时，巡潮艇从码头抵达钟楼约二十分钟。',
  continentLayout: '雾港背靠北岸断崖，面向长雾海。西侧盐沼提供盐晶和药草，东侧黑礁群形成天然航道，南方外海是黑潮与远航线的来源。',
  regionDimensions: '上城约十八平方公里，中城约三十二平方公里，下港与堤岸设施约二十五平方公里；故事中的十个主要场景都处于一夜内可抵达的尺度。',
  mountainsRivers: '北岸断崖储存淡水，三条暗渠汇入地下泵站；城市没有大河，内外港水位完全依赖潮门、泵轮和五条防潮堤调节。',
  climateByRegion: '全年多雾、潮湿、低温。上城风强而干燥，中城常有盐雾凝露，下港受潮差影响最大；黑潮到来前会出现无风、灯焰向海面弯折和金属低鸣。',
  naturalResourceOverview: '主要资源是盐晶、耐盐苔、深水鱼油、黑礁铜矿和可储存共振的潮石。所有奇异材料都服务于航海与钟机工业，不形成脱离世界规则的万能魔法。',
  naturalResources: { rareCreatures: '雾鳐、回声鲸、黑礁盲鱼', herbs: '耐盐苔、雾薄荷、止潮藻', minerals: '黑礁铜、潮石、蓝盐晶', others: '鲸油、耐潮木、深海玻璃' },
  historyLine: '建港与钟机落成 → 港议会获得共振设施控制权 → 钟历三十七年黑潮事故与档案封存 → 十年表面繁荣 → 钟历四十七年失潮、失名与黑潮回返。',
  worldEvents: '钟历元年潮汐钟启用；钟历十二年五堤合围；钟历三十七年黑潮事故造成四十七人死亡；钟历三十八年原始潮位页被抽走；钟历四十七年失潮之夜，全城出现姓名褪色。',
  races: '主要居民均为人类。雾港人的差异来自职业、阶层、航线出身与是否经历黑潮，而非种族能力；远航船员、盐沼居民和上城议员拥有不同经验与利益。',
  factionLayout: '港议会控制行政与档案；巡潮队控制武装、宵禁和关键通道；守灯人维持航标与公共誓约；商港行会掌握船只、工匠和物资；失名者家属组成非正式的“铜片会”，要求公开死者名单。',
  politicsEconomyCulture: '雾港是由七席港议会治理的商港自治城。秩序依赖潮牌、档案与设施权限，财富来自海贸和钟机技术，公共文化则围绕灯火、姓名记录与共同见证展开。',
  politicsOverview: '七席港议会制定封港、配给和钟机政策；巡潮官可在紧急状态下限制通行，但接管主钟必须由守灯徽章、档案校准码与议会封缄印三方共同授权。该制衡正是最终选择得以成立的制度基础。',
  economyOverview: '港口以雾铢和短期潮票结算。钟机工、船员、档案员和潮灯匠构成核心劳动力；失潮会同时摧毁航运窗口、淡水泵送和票据信用，因此危机不仅是奇观，也是城市生存问题。',
  cultureOverview: '人们见面先报姓名与潮牌号，重要承诺需有第三人见证。每年黑潮纪念日熄灭私人灯火，只保留公共灯塔；官方十年来刻意省略四十七名遇难者姓名，形成故事的道德裂缝。',
  internalConflicts: '核心矛盾有三层：公开真相与维持秩序的政治冲突；恢复潮汐与保存集体记忆的技术冲突；林澈寻找父亲与承担公共职责的私人冲突。余砚代表证据，顾潮生代表秩序，两人都不能被写成单纯工具人。',
  itemDesign: '关键道具全部具有制度或机械功能：黄铜潮汐钥匙重接主轴；守灯人徽章提供通行与授权；黑潮记录页证明事故因果。道具不能凭空解决危机，每件都必须通过调查、关系或选择获得。',
}

const WORLD_RULE_ENTRIES = {
  'era.period': { historicalAnchors: '近代工业港口、机械钟楼、城市议会与海贸行会。', fictionalAdaptations: '低度奇异科技让潮汐能被机械共振校准，并能编码姓名与记忆。', priority: 'balanced' },
  'era.divergence': { historicalAnchors: '蒸汽时代城市基础设施与档案官僚制。', fictionalAdaptations: '潮石替代部分燃煤动力，雾港由潮汐钟成为独立自治港。', priority: 'fictional' },
  'era.calendar': { historicalAnchors: '以城市重大工程落成为地方纪年起点。', fictionalAdaptations: '采用钟历与潮刻，一日八潮刻，失潮以分钟偏差被精确记录。', priority: 'balanced' },
  events: { historicalAnchors: '工业事故常伴随责任掩盖、档案删改与公共安全争议。', fictionalAdaptations: '黑潮事故导致姓名信息被钟机吸收，十年后以失名现象回返。', priority: 'balanced' },
  'geography.terrain': { historicalAnchors: '玄武岩海湾、断崖、盐沼与黑礁航道。', fictionalAdaptations: '退潮石脊可通往地下泵站，黑潮会改变近岸声学而不瞬间改写地形。', priority: 'historical' },
  'geography.cities': { historicalAnchors: '上城、中城、下港与堤岸设施按产业和地势分层。', fictionalAdaptations: '潮汐钟、北塔灯室和回声井共同构成城市的记忆基础设施。', priority: 'balanced' },
  'geography.water': { historicalAnchors: '潮门、泵站、防潮堤和内外港水位差。', fictionalAdaptations: '钟机共振可短时延迟潮峰，但能量代价必须落到设备、记忆或人员风险。', priority: 'historical' },
  'geography.roads': { historicalAnchors: '石板街、堤顶巡逻路、升降桥和近岸航道。', fictionalAdaptations: '失潮时开放石脊捷径，封港时巡潮队控制钟楼与北塔通道。', priority: 'balanced' },
  'climate.weather': { historicalAnchors: '冷湿海洋性气候、浓雾、盐雾与强风。', fictionalAdaptations: '黑潮前无风、金属低鸣、灯焰向海弯折，作为可重复识别的危机征兆。', priority: 'balanced' },
  'climate.disaster': { historicalAnchors: '风暴潮、海水倒灌、堤岸失效与航运中断。', fictionalAdaptations: '黑潮同时冲击水位与城市记录，但不能无条件抹除实体或复活死者。', priority: 'historical' },
  'politics.system': { historicalAnchors: '商港寡头议会、专业官署与紧急状态授权。', fictionalAdaptations: '关键钟机权力被拆分为三枚权限印记，避免单一角色轻易控制全城。', priority: 'balanced' },
  'politics.law': { historicalAnchors: '封港令、档案密级、宵禁、事故调查与公共听证。', fictionalAdaptations: '七日公开之约是具有记录效力的紧急契约，违约会触发议会席位复核。', priority: 'historical' },
  'economy.trade': { historicalAnchors: '转口贸易、船位、仓单、行会信用与海运保险。', fictionalAdaptations: '潮票价值与下一次可航潮窗绑定，失潮会造成即时信用危机。', priority: 'historical' },
  'technology.engineering': { historicalAnchors: '钟表机构、泵轮、液压闸门、灯塔光学与机械校准。', fictionalAdaptations: '潮石可储存低频共振，黄铜钥匙用于机械相位校准而非施法。', priority: 'balanced' },
  'culture.philosophy': { historicalAnchors: '海员共同体强调誓言、遇难者纪念、公共灯塔与姓名登记。', fictionalAdaptations: '雾港的主流公共伦理认为记录和见证能够抵抗遗忘，耐盐铜片与回声井把它变成可见仪式。', priority: 'historical' },
  'supernatural.system': { historicalAnchors: '不采用真实宗教作为超自然因果。', fictionalAdaptations: '所有异常均归入潮汐共振工学；若无法说明代价、载体和边界，就不能成为解法。', priority: 'fictional' },
} as const

const GEOGRAPHY_LOCATIONS = [
  { id: 'mist-harbor', name: '雾港', type: 'city', description: '长雾海北缘的商港自治城，由上城、中城、下港和五道防潮堤组成。', significance: '所有角色关系、制度矛盾与危机代价的共同容器。', parentId: null, order: 0 },
  { id: 'mist-dock', name: '雾港码头', type: 'building', description: '青石码头与搁浅船阵构成的失潮现场。', significance: '开场发现潮汐迟到、姓名褪色和黑潮征兆。', parentId: 'mist-harbor', order: 1 },
  { id: 'mist-market', name: '潮灯集市', type: 'building', description: '依靠悬挂潮灯照明的夜市，消息、零件和潮票在此流通。', significance: '民间证词与巡潮队秩序第一次正面冲突。', parentId: 'mist-harbor', order: 2 },
  { id: 'mist-archive', name: '旧档案馆', type: 'building', description: '半沉入防洪墙的石砌档案馆，蓝灯暗号标出被删记录。', significance: '找到黑潮记录页和钟机校准证据。', parentId: 'mist-harbor', order: 3 },
  { id: 'mist-pump', name: '地下泵站', type: 'ruin', description: '位于退潮石脊下方的旧泵轮与遇难者维护通道。', significance: '调查路线汇合，机械安全与死者姓名发生抉择。', parentId: 'mist-harbor', order: 4 },
  { id: 'mist-north-tower', name: '北塔灯室', type: 'building', description: '俯瞰海湾的公共灯塔，保存守灯徽章与林澈父亲的第七码。', significance: '私人真相、公共责任和同伴信任的情感锚点。', parentId: 'mist-harbor', order: 5 },
  { id: 'mist-bell', name: '失声钟楼', type: 'building', description: '防波堤尽头的巨型铜钟楼，主轴连接全城潮门。', significance: '三枚权限汇合并作出最终路线选择。', parentId: 'mist-harbor', order: 6 },
  { id: 'mist-black-tide', name: '长雾海外海', type: 'nature', description: '黑潮形成与远航失踪记录指向的未知海域。', significance: '远航结局把城市问题转化为更大世界的探索入口。', parentId: null, order: 7 },
] as const

const HISTORY_EVENTS = [
  { id: 'mist-history-01', era: '钟历', date: '钟历元年', title: '潮汐钟启用', description: '第一代测潮船队完成主钟与五道潮门的联动，雾港由季节性泊地成为常设商港。', impact: '建立钟历、港议会与守灯人制度。', order: 0 },
  { id: 'mist-history-02', era: '钟历', date: '钟历十二年', title: '五堤合围', description: '内港防潮堤全部落成，地下泵站接入淡水和货运系统。', impact: '城市人口扩大，生存开始依赖钟机基础设施。', order: 1 },
  { id: 'mist-history-03', era: '钟历', date: '钟历三十七年', title: '黑潮事故', description: '港议会强行提高钟机共振，黑潮提前抵港，四十七名钟机工与船员死亡。', impact: '原始记录被封存，余砚被调离钟楼，林澈父亲失踪，顾潮生失去兄长。', order: 2 },
  { id: 'mist-history-04', era: '钟历', date: '钟历三十八年', title: '封缄令生效', description: '事故被改写为极端天气，遇难者姓名从公共纪念册和维修记录中移除。', impact: '维持十年表面秩序，也让记忆债务积累在潮汐钟中。', order: 3 },
  { id: 'mist-history-05', era: '钟历', date: '钟历四十七年·失潮之夜', title: '潮汐迟到十三分钟', description: '潮声停止，登记册与人的记忆开始同时丢失姓名，黑潮在外海重新成形。', impact: '迫使林澈、余砚与顾潮生重新打开事故记录并接管钟楼。', order: 4 },
] as const

const HISTORICAL_TIMELINE_ROWS = [
  { era: 'custom', year: 1, date: '钟历元年', title: '潮汐钟启用', description: HISTORY_EVENTS[0].description, conceptNote: '城市建立与技术乐观主义的起点。', impact: HISTORY_EVENTS[0].impact, isHistorical: false, source: '雾港正式世界设定', customTimeRange: '钟历元年', location: '失声钟楼' },
  { era: 'custom', year: 12, date: '钟历十二年', title: '五堤合围', description: HISTORY_EVENTS[1].description, conceptNote: '基础设施让繁荣与系统性风险同时增长。', impact: HISTORY_EVENTS[1].impact, isHistorical: false, source: '雾港正式世界设定', customTimeRange: '钟历十二年', location: '雾港内港' },
  { era: 'custom', year: 37, date: '钟历三十七年', title: '黑潮事故', description: HISTORY_EVENTS[2].description, conceptNote: '全部人物伤痕与制度隐瞒的共同原点。', impact: HISTORY_EVENTS[2].impact, isHistorical: false, source: '黑潮记录页', customTimeRange: '钟历三十七年', location: '失声钟楼与外港' },
  { era: 'custom', year: 38, date: '钟历三十八年', title: '封缄令生效', description: HISTORY_EVENTS[3].description, conceptNote: '秩序通过删去姓名维持，由此产生记忆债务。', impact: HISTORY_EVENTS[3].impact, isHistorical: false, source: '议会封缄令', customTimeRange: '钟历三十八年', location: '港议会与旧档案馆' },
  { era: 'custom', year: 47, date: '钟历四十七年·失潮之夜', title: '潮汐迟到十三分钟', description: HISTORY_EVENTS[4].description, conceptNote: '路演故事发生当夜，全部旧因果同时兑现。', impact: HISTORY_EVENTS[4].impact, isHistorical: false, source: '码头潮位记录', customTimeRange: '钟历四十七年一夜', location: '雾港全城' },
] as const

const HISTORICAL_KEYWORD_ROWS = [
  { keyword: '潮汐钟', category: 'technology', era: 'custom', description: '连接主轴、五道潮门和城市记录系统的巨型共振机械；能够调节潮窗，也可能抽取姓名信息。', conceptNote: '世界核心技术，必须同时表现机械可信度和道德代价。', location: '失声钟楼' },
  { keyword: '潮牌', category: 'institution', era: 'custom', description: '记录姓名、职业、配给与撤离顺序的黄铜身份牌，是港议会行政和港民日常生活的共同凭证。', conceptNote: '让“失名”同时具有情感、法律与生存后果。', location: '雾港' },
  { keyword: '守灯人旧誓', category: 'culture', era: 'custom', description: '“灯未熄，港未沉。”任何愿意承担公共守望职责的人都可宣誓，并非家族特权。', conceptNote: '主题句只在关键节点使用，避免口号泛滥。', location: '北塔灯室' },
  { keyword: '潮票', category: 'economy', era: 'custom', description: '与下一次可航潮窗绑定的短期信用票据；失潮会令货运、工资和撤离资源同时冻结。', conceptNote: '把世界危机落到普通人的即时利益。', location: '潮灯集市' },
  { keyword: '回声井', category: 'architecture', era: 'custom', description: '钟楼下方连接旧泵道的竖井，投入耐盐铜片后，姓名会随钟鸣传遍内港。', conceptNote: '遇难者记忆、城市空间与真相结局的视觉锚点。', location: '失声钟楼' },
] as const

const CHAPTER_CONFIGS = [
  { title: '第一章　潮声迟到十三分钟', act: 0, nodes: ['entry'], summary: '守灯人林澈在雾港码头发现潮汐迟到、登记册姓名褪色和黑潮征兆，并在余砚留下的蓝灯暗号与集市骚动之间作出第一步调查选择。', location: '雾港码头', emotionArc: 'rising' },
  { title: '第二章　潮灯下的失名者', act: 0, nodes: ['market', 'patrol'], summary: '林澈在潮灯集市见证普通港民失去姓名与潮牌权利，顾潮生以封港秩序阻拦调查，三人的立场首次正面碰撞。', location: '潮灯集市', emotionArc: 'wave' },
  { title: '第三章　被抽走的记录页', act: 0, nodes: ['archive', 'vault'], summary: '余砚带林澈进入旧档案馆密库，复原黑潮记录页与十三分钟校准差，证明议会曾主动让潮汐钟过载。', location: '旧档案馆', emotionArc: 'rising' },
  { title: '第四章　退潮石脊之下', act: 1, nodes: ['undercity'], summary: '两条调查路线在下港石脊汇合。众人进入地下维护通道，看见钟机正在用全城姓名偿还十年前积累的能量债。', location: '下港石脊与维护隧道', emotionArc: 'rising' },
  { title: '第五章　泵轮与四十七个名字', act: 1, nodes: ['pump', 'shrine'], summary: '林澈必须在修复泵轮争取安全窗口与找回四十七名遇难者姓名之间分配时间，机械路线与纪念路线分别揭开不同代价。', location: '地下泵站与遇难者铜片室', emotionArc: 'wave' },
  { title: '第六章　北塔的三枚权限', act: 1, nodes: ['north-tower'], summary: '三人抵达北塔灯室，确认接管主钟需要守灯徽章、档案校准码和议会封缄印共同生效；同盟建立在互不相同的动机上。', location: '北塔灯室', emotionArc: 'rising' },
  { title: '第七章　父亲第七码与封缄令', act: 1, nodes: ['father-log', 'council-seal'], summary: '林澈可追读父亲留下的第七码，或先审视顾潮生携带的封缄令；私人失踪与制度责任被证明是同一事故的两面。', location: '北塔记录室', emotionArc: 'climax' },
  { title: '第八章　失声钟楼', act: 2, nodes: ['bell'], summary: '黑潮逼近，三枚权限同时接入潮汐钟。余砚要求公开，顾潮生要求限流撤离，林澈必须决定城市如何承担没有无代价答案的现实。', location: '失声钟楼主机室', emotionArc: 'climax' },
  { title: '第九章　把名字还给全城', act: 2, nodes: ['public-square'], summary: '若选择公开，档案、铜片与钟声在公共广场完成交叉见证；真相不再属于某个英雄，而成为全城必须共同记录的责任。', location: '议会前公共广场', emotionArc: 'climax' },
  { title: '第十章　雾散以前', act: 2, nodes: ['truth', 'home', 'sea'], summary: '故事以真相之钟、守灯人的黎明或向黑潮航行三种结局收束，分别回答公开、修复与追源三种价值选择，并保留未来世界扩展入口。', location: '雾港与长雾海外海', emotionArc: 'falling' },
] as const

const ACTS = [
  { title: '第一幕　失潮之夜', summary: '从码头异常、集市失名和档案缺页建立危机，确认潮汐钟正在用城市记忆维持运转。' },
  { title: '第二幕　城市的潮心', summary: '调查深入泵站和北塔，四十七名遇难者、父亲记录与三方权限把人物伤痕连接成制度真相。' },
  { title: '第三幕　让城市选择代价', summary: '在黑潮抵达前接管失声钟楼，让公开真相、限流守港和断钟远航形成三种可承担的结局。' },
] as const

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderChapterContent(config: (typeof CHAPTER_CONFIGS)[number]): string {
  const paragraphs = MIST_HARBOR_ROADSHOW_BEATS
    .filter(beat => (config.nodes as readonly string[]).includes(beat.nodeKey))
    .map(beat => {
      const text = escapeHtml(beat.text)
      if (beat.kind === 'dialogue' && beat.speaker) return `<p><strong>${escapeHtml(beat.speaker)}：</strong>${text}</p>`
      if (beat.kind === 'system') return `<p><em>${text}</em></p>`
      return `<p>${text}</p>`
    })
  return `<article data-mist-harbor-roadshow="v1"><h2>${escapeHtml(config.title)}</h2>${paragraphs.join('')}</article>`
}

function plainTextLength(html: string): number {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length
}

async function ensureSingletons(scope: WorkspaceScope): Promise<void> {
  await adopt({ projectId: scope.projectId, scope, target: 'worldviews', mode: 'replace', data: WORLDVIEW })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'worldRulesProfiles',
    mode: 'replace',
    data: {
      entries: WORLD_RULE_ENTRIES,
      customNodes: [],
      globalNote: '雾港采用“工业基础设施 + 低度奇异共振”的统一因果。任何新增设定都要说明载体、权限、代价和可验证证据；角色不能靠临时出现的超能力绕过公共选择。',
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'geographies',
    mode: 'replace',
    data: { overview: WORLDVIEW.geography, locations: GEOGRAPHY_LOCATIONS },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'histories',
    mode: 'replace',
    data: {
      overview: '雾港的历史不是背景年表，而是当夜危机的因果链：城市依赖潮汐钟繁荣，议会在十年前用过载换取安全，随后删除四十七名死者和事故责任；被压入钟机的记录在失潮之夜以姓名褪色的方式回返。',
      eraSystem: '采用“钟历”，以潮汐钟启用为元年；日常时间同时使用八个潮刻，精密钟机记录仍以小时和分钟标注，因此“迟到十三分钟”具有公开可核验性。',
      events: HISTORY_EVENTS,
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'powerSystems',
    mode: 'replace',
    data: {
      name: '潮汐共振工学',
      description: '通过潮石、黄铜谐振器、泵轮和大型钟机捕获月潮低频能量的工程体系。能力来自知识、设备和制度权限，而非个人魔力；同一原理既能照明、泵水和开辟航窗，也能在过载时损伤记录与记忆。',
      levels: [
        { id: 'civilian', name: '民用潮具', capability: '使用潮灯、潮牌和常规泵具' },
        { id: 'artisan', name: '钟机工', capability: '维护支线谐振器与读取潮位曲线' },
        { id: 'calibrator', name: '校准师', capability: '修改相位、编写校准码并判断过载风险' },
        { id: 'custodian', name: '设施持权人', capability: '凭正式印记进入北塔、泵站和钟楼控制区' },
        { id: 'triune', name: '三权接管', capability: '三枚权限共同生效后调整或关闭潮汐钟主轴' },
      ],
      rules: '共振必须有设备载体；能量转移必须留下可见代价；越过设施权限需要剧情证据；单人不能接管主钟；记忆损失不能被一句台词无条件复原；最终解法只能在公开、限流或断钟三条已建立的机制内演化。',
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'storyCores',
    mode: 'replace',
    data: {
      theme: '一个城市能否以遗忘受害者为代价维持安全；真正的守护不是替所有人隐瞒，而是让共同体看见并承担自己的选择。',
      centralConflict: '黑潮抵达前，林澈必须重启、限制或关闭正在吞噬姓名的潮汐钟；余砚坚持公开事故记录，顾潮生担心真相引发撤离崩溃，三人又必须合作取得接管权限。',
      plotPattern: '三幕式调查悬疑 + 路线汇合 + 价值选择多结局。第一幕发现异常与证据，第二幕追溯系统代价和人物旧伤，第三幕把技术危机转化为公开决策。',
      logline: '失潮之夜，能听懂钟声的守灯人必须与一名守秘档案员和一名封港巡潮官合作，在全城姓名消失前揭开十年前的黑潮旧案，并决定雾港愿意为安全、真相或自由付出什么代价。',
      concept: '把“城市记忆”落实为档案、身份牌、遇难者姓名和公共见证，再用一台吞噬记录的基础设施迫使玩家选择。谜团的答案不只是凶手或秘密，而是一个共同体如何处理被刻意删除的历史。',
      mainPlot: '林澈从码头失潮出发，经潮灯集市或旧档案馆取得民间证词与黑潮记录，在地下泵站确认记忆债务，在北塔集齐守灯徽章、校准码和封缄印，最终接管失声钟楼，走向真相之钟、七日公开之约或断钟远航。',
      subPlots: '林澈追寻父亲第七码并从私人执念转向公共责任；余砚从保存证据转为公开作证；顾潮生面对哥哥之死与秩序信念的冲突；四十七名遇难者姓名从被删去的数字恢复为可被城市共同见证的人。',
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'creativeRules',
    mode: 'replace',
    data: {
      writingStyle: '克制的工业海港悬疑。环境描写强调盐雾、黄铜、低频震动、灯焰和潮声；对白短而有信息差，每段对话都推动证据、关系或选择，不用旁白替角色宣布主题。',
      narrativePOV: 'third-limited',
      atmosphere: '冷湿、压迫而不绝望；前两幕以蓝灰与铜灯制造调查感，终幕让公共广场、黎明或外海分别释放不同情绪。',
      prohibitions: ['不新增无来源神力或万能道具', '不把顾潮生写成纯粹恶人', '不让父亲突然生还解决冲突', '不以梦境或失忆否定玩家已经获得的证据', '不绕过三枚权限直接控制主钟'],
      consistencyRules: ['潮汐迟到固定为十三分钟', '黑潮事故死亡人数固定为四十七人', '主钟接管需要守灯徽章、档案校准码和议会封缄印', '奇异现象必须遵守潮汐共振工学的载体与代价', '林澈、余砚、顾潮生的冲突来自价值与经历而非信息降智'],
      specialRequirements: '可玩投影必须保留证据获取、路线汇合、三方合作与三结局。AVG 可加强镜头和情绪表现，文字冒险可增加物品与地点交互，但不能改变正式世界因果。',
      referenceWorksV2: [],
      citedReferenceIds: [],
      citedInsightIds: [],
    },
  })
}

async function ensureHistoricalRows(scope: WorkspaceScope): Promise<void> {
  const store = useHistoricalStore.getState()
  await store.loadEvents(scope)
  for (const row of HISTORICAL_TIMELINE_ROWS) {
    const current = useHistoricalStore.getState().events.find(item => item.title === row.title)
    if (current?.id) await useHistoricalStore.getState().updateEvent(current.id, { ...row, projectId: scope.projectId, worldGroupId: null })
    else await useHistoricalStore.getState().addEvent({ ...row, projectId: scope.projectId, worldGroupId: null })
  }
  await useHistoricalStore.getState().loadKeywords(scope)
  for (const row of HISTORICAL_KEYWORD_ROWS) {
    const current = useHistoricalStore.getState().keywords.find(item => item.keyword === row.keyword)
    if (current?.id) await useHistoricalStore.getState().updateKeyword(current.id, { ...row, projectId: scope.projectId, worldGroupId: null })
    else await useHistoricalStore.getState().addKeyword({ ...row, projectId: scope.projectId, worldGroupId: null })
  }
}

async function ensureOutlineNode(
  scope: WorkspaceScope,
  data: Pick<OutlineNode, 'parentId' | 'type' | 'title' | 'summary' | 'order'>,
): Promise<OutlineNode & { id: number }> {
  let current = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes'))
    .find(item => (item.parentId ?? null) === data.parentId && item.type === data.type && item.title === data.title)
  if (current?.id) {
    await adopt({ projectId: scope.projectId, scope, target: 'outlineNodes', recordId: current.id, mode: 'replace', data })
  } else {
    await adopt({ projectId: scope.projectId, scope, target: 'outlineNodes', mode: 'add', data })
    current = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes'))
      .find(item => (item.parentId ?? null) === data.parentId && item.type === data.type && item.title === data.title)
  }
  if (!current?.id) throw new Error(`[mist-harbor] 大纲节点写入失败:${data.title}`)
  return current as OutlineNode & { id: number }
}

async function ensureAuthoringStructure(scope: WorkspaceScope, characters: Map<string, number>): Promise<void> {
  const volume = await ensureOutlineNode(scope, {
    parentId: null,
    type: 'volume',
    title: '第一卷　失潮钟声',
    summary: '一夜之内，雾港从潮声停止与姓名褪色的局部异常，走向必须公开历史、限制系统或驶向未知的共同体选择。全卷采用三幕十章结构，对应可玩叙事的完整调查与三结局。',
    order: 0,
  })
  const acts: Array<OutlineNode & { id: number }> = []
  for (const [order, act] of ACTS.entries()) {
    acts.push(await ensureOutlineNode(scope, { parentId: volume.id, type: 'storyBlock', title: act.title, summary: act.summary, order }))
  }
  const chapterNodes: Array<OutlineNode & { id: number }> = []
  for (const [order, config] of CHAPTER_CONFIGS.entries()) {
    chapterNodes.push(await ensureOutlineNode(scope, {
      parentId: acts[config.act].id,
      type: 'chapter',
      title: config.title,
      summary: config.summary,
      order,
    }))
  }

  const existingChapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
  for (const [order, config] of CHAPTER_CONFIGS.entries()) {
    const node = chapterNodes[order]
    const content = renderChapterContent(config)
    const data = {
      outlineNodeId: node.id,
      title: config.title,
      content,
      summary: config.summary,
      wordCount: plainTextLength(content),
      status: 'revised',
      order,
      notes: `雾港路演正式章节；对应可玩节点：${config.nodes.join('、')}。`,
      perspectiveCharacterId: characters.get('林澈') ?? null,
    }
    const existing = existingChapters.find(item => item.outlineNodeId === node.id || item.title === config.title)
    const installerOwned = !existing?.content?.trim() || existing.content.includes('data-mist-harbor-roadshow=')
    if (!existing?.id) await adopt({ projectId: scope.projectId, scope, target: 'chapters', mode: 'add', data })
    else if (installerOwned) await adopt({ projectId: scope.projectId, scope, target: 'chapters', recordId: existing.id, mode: 'replace', data })
  }

  const chapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
  const chapterByOrder = CHAPTER_CONFIGS.map(config => {
    const chapter = chapters.find(item => item.title === config.title)
    if (!chapter?.id) throw new Error(`[mist-harbor] 章节写入失败:${config.title}`)
    return chapter as Chapter & { id: number }
  })
  const foreshadowRows = [
    { name: '迟到十三分钟', type: 'timeline', status: 'resolved', description: '开场潮位偏差与十年前过载记录使用同一数值，证明今夜危机是黑潮事故的延迟回返。', plantChapterId: chapterByOrder[0].id, echoChapterIds: [chapterByOrder[2].id, chapterByOrder[6].id], resolveChapterId: chapterByOrder[7].id, expectedResolveChapterId: chapterByOrder[7].id, notes: '数字必须始终保持十三分钟。', timelinePosition: 0.1, importance: 10, urgency: 'low' },
    { name: '被删去的四十七个名字', type: 'callback', status: 'resolved', description: '失名者、档案缺页和铜片室逐步把事故统计恢复为具体姓名，最终成为公共见证的核心。', plantChapterId: chapterByOrder[1].id, echoChapterIds: [chapterByOrder[2].id, chapterByOrder[4].id], resolveChapterId: chapterByOrder[8].id, expectedResolveChapterId: chapterByOrder[8].id, notes: '不要只把遇难者作为机关密码。', timelinePosition: 0.2, importance: 10, urgency: 'low' },
    { name: '父亲留下的第七码', type: 'character', status: 'resolved', description: '林澈父亲留下的校准节律既是私人线索，也是证明单人不应控制公共设施的警告。', plantChapterId: chapterByOrder[0].id, echoChapterIds: [chapterByOrder[5].id], resolveChapterId: chapterByOrder[6].id, expectedResolveChapterId: chapterByOrder[6].id, notes: '父亲不以突然现身的方式回归。', timelinePosition: 0.12, importance: 8, urgency: 'low' },
    { name: '三枚权限印记', type: 'chekhov', status: 'resolved', description: '守灯徽章、档案校准码与议会封缄印分别代表公共职责、证据和行政权，必须共同接入才能接管主钟。', plantChapterId: chapterByOrder[2].id, echoChapterIds: [chapterByOrder[5].id, chapterByOrder[6].id], resolveChapterId: chapterByOrder[7].id, expectedResolveChapterId: chapterByOrder[7].id, notes: '任何游戏投影都不得绕过三权接管条件。', timelinePosition: 0.3, importance: 10, urgency: 'low' },
  ] as const
  await adopt({ projectId: scope.projectId, scope, target: 'foreshadows', mode: 'add-many', data: foreshadowRows.map(row => ({ ...row })) })

  const foreshadows = await readOwnedRows<{ id?: number; name: string }>(scope, 'foreshadows')
  const foreshadowIds = foreshadows.filter(item => foreshadowRows.some(row => row.name === item.name)).flatMap(item => item.id ?? [])
  const nodeByKey = new Map(MIST_HARBOR_ROADSHOW_NODES.map(item => [item.key, item]))
  const existingDetails = await readOwnedRows<DetailedOutline>(scope, 'detailedOutlines')
  for (const [order, config] of CHAPTER_CONFIGS.entries()) {
    const node = chapterNodes[order]
    const characterIds = [...new Set(MIST_HARBOR_ROADSHOW_BEATS
      .filter(beat => (config.nodes as readonly string[]).includes(beat.nodeKey) && beat.speaker)
      .flatMap(beat => beat.speaker ? [characters.get(beat.speaker)] : [])
      .filter((id): id is number => typeof id === 'number'))]
    const scenes = config.nodes.map((nodeKey, sceneOrder) => {
      const narrativeNode = nodeByKey.get(nodeKey)
      return {
        sceneId: `mist-roadshow-${String(order + 1).padStart(2, '0')}-${String(sceneOrder + 1).padStart(2, '0')}`,
        title: narrativeNode?.title ?? config.title,
        summary: narrativeNode?.summary ?? config.summary,
        characterIds,
        location: config.location,
        conflict: config.summary,
        pace: config.emotionArc === 'climax' ? 'climax' : config.emotionArc === 'falling' ? 'slow' : sceneOrder === config.nodes.length - 1 ? 'fast' : 'medium',
        estimatedWords: Math.max(500, Math.round(1800 / config.nodes.length)),
        notes: `对应 NarrativeNode：${nodeKey}；保留证据、关系与选择后果。`,
      }
    })
    const detail = {
      outlineNodeId: node.id,
      scenes,
      openingHook: order === 0 ? '午夜潮声没有按时抵达，林澈先听见了铜灯里不属于风的第二次震动。' : `承接上一章结果进入${config.location}，先展示已获得证据带来的现实变化。`,
      endingCliffhanger: order === CHAPTER_CONFIGS.length - 1 ? '雾散以前，城市终于开始用自己的声音记录选择。' : CHAPTER_CONFIGS[order + 1].summary,
      sceneLocation: config.location,
      appearingCharacterIds: characterIds,
      foreshadowIds,
      emotionArc: config.emotionArc,
      prohibitions: ['不新增无来源解法', '不抹去已确认的证据', '不让角色为推进情节突然降智'],
      lastUsedSummary: config.summary,
    }
    const existing = existingDetails.find(item => item.outlineNodeId === node.id)
    if (!existing?.id) await adopt({ projectId: scope.projectId, scope, target: 'detailedOutlines', mode: 'add', data: detail })
    else if (!Array.isArray(existing.scenes) || existing.scenes.length === 0 || existing.scenes.every(scene => scene.sceneId.startsWith('mist-roadshow-'))) {
      await adopt({ projectId: scope.projectId, scope, target: 'detailedOutlines', recordId: existing.id, mode: 'replace', data: detail })
    }
  }
}

export async function ensureMistHarborAuthoringWorld(
  scope: WorkspaceScope,
  characters: Map<string, number>,
): Promise<MistHarborAuthoringSummary> {
  await ensureSingletons(scope)
  await ensureHistoricalRows(scope)
  await ensureAuthoringStructure(scope, characters)
  const [rules, events, keywords, cores, outlines, chapters, details, foreshadows] = await Promise.all([
    readOwnedRows<{ entries?: Record<string, unknown> }>(scope, 'worldRulesProfiles', { owner: 'world' }),
    readOwnedRows<HistoricalTimelineEvent>(scope, 'historicalTimelineEvents', { owner: 'world' }),
    readOwnedRows<HistoricalKeyword>(scope, 'historicalKeywords', { owner: 'world' }),
    readOwnedRows(scope, 'storyCores', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes'),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<DetailedOutline>(scope, 'detailedOutlines'),
    readOwnedRows<{ name: string }>(scope, 'foreshadows'),
  ])
  return {
    worldRuleEntryCount: Object.keys(rules[0]?.entries ?? {}).length,
    historicalEventCount: events.filter(item => HISTORICAL_TIMELINE_ROWS.some(row => row.title === item.title)).length,
    historicalKeywordCount: keywords.filter(item => HISTORICAL_KEYWORD_ROWS.some(row => row.keyword === item.keyword)).length,
    storyCoreCount: cores.length,
    outlineNodeCount: outlines.filter(item => item.title === '第一卷　失潮钟声' || ACTS.some(act => act.title === item.title) || CHAPTER_CONFIGS.some(config => config.title === item.title)).length,
    chapterCount: chapters.filter(item => CHAPTER_CONFIGS.some(config => config.title === item.title)).length,
    detailedOutlineCount: details.filter(item => outlines.some(node => node.id === item.outlineNodeId && CHAPTER_CONFIGS.some(config => config.title === node.title))).length,
    foreshadowCount: foreshadows.filter(item => ['迟到十三分钟', '被删去的四十七个名字', '父亲留下的第七码', '三枚权限印记'].includes(item.name)).length,
  }
}
