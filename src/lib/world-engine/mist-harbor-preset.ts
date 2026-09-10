import { adopt as governedAdopt } from '../registry/adopt'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { createWorkspace } from '../workspace/create-workspace'
import { resolveWorkspaceScope } from '../workspace/ownership'
import { readOwnedRows } from '../workspace/scope'
import { createWorldRevision, publishWorldRevision } from './releases'
import type {
  Chapter,
  DetailedOutline,
  OutlineNode,
  WorkspaceScope,
  Character,
  CodexCategory,
  StoryArc,
} from '../types'
import { MIST_HARBOR_ROADSHOW_BEATS, MIST_HARBOR_ROADSHOW_NODES } from '../../content/mist-harbor/story'

async function adopt(input: Parameters<typeof governedAdopt>[0]) {
  const result = await governedAdopt(input)
  if (
    result.typeErrors.length ||
    result.unknown.length ||
    result.fkErrors.length ||
    result.skipped.length ||
    !result.written.length
  )
    throw new Error(
      '雾港原稿采纳失败：' +
        input.target +
        ' ' +
        JSON.stringify({
          unknown: result.unknown,
          typeErrors: result.typeErrors,
          fkErrors: result.fkErrors,
          skipped: result.skipped,
        }),
    )
  return result
}
const CHARACTER_ROWS = [
  {
    name: '林澈',
    roleWeight: 'main',
    moralAxis: 'good',
    orderAxis: 'neutral',
    shortDescription: '雾港最年轻的守灯人，也是唯一能听懂潮汐钟异响的人。',
    appearance: '深蓝长风衣、银灰短发，随身提着旧铜灯。',
    personality: '冷静、克制，危急时会选择保护他人。',
    background: '父亲在十年前的黑潮事故中失踪，她继承了北塔灯室。',
    motivation: '查清失潮真相，让港口在黎明前恢复潮声，同时证明父亲的失踪不是一场无意义的事故。',
    abilities: '辨认潮声中的相位差；维护灯塔机械；熟悉近岸航道；能在压力下迅速判断公共安全风险。',
    relationships:
      '余砚是她父亲旧日同事与证据同盟；顾潮生既是制度阻拦者，也是唯一能交出议会权限的人；守钟人曾教她辨认第七码。',
    arc: '从把守灯视为自己必须独自承担的家族债务，到相信同伴、接受父亲无法被简单找回，并把真相与选择权交还全城。',
    identity: '北塔守灯人；旧守灯人林泊川之女；失潮调查的行动发起者。',
    profile: '23岁，女性，人类，雾港本地人。',
    values: '相信被记录的姓名和公开承担比表面稳定更重要；守护不是替别人决定，而是让人有选择的资格。',
    strengths: '听觉敏锐、机械直觉强、临危不乱、愿意保护陌生人。',
    weaknesses: '习惯独自承担，不愿承认自己仍在寻找父亲；面对无辜者风险时容易把责任全部揽到自己身上。',
    fears: '最怕父亲主动参与了事故，也怕自己最终会像议会一样以保护为名替全城隐瞒。',
    goals: '短期在黑潮抵达前取得主钟控制权；长期重建公开、可追责的守灯制度。',
    innerConflict: '她需要父亲留下的技术与情感支撑，却必须接受公共真相不能只服务于自己的寻亲愿望。',
    keyEvents: '十年前在北塔最后一次见到父亲；继承旧铜灯与守灯徽章；失潮之夜第一次听见钟声中重复的第七码。',
    powerLevel: '设施持权人：可进入北塔和钟楼外环，但不能单独接管主钟。',
    speechStyle: '短句，语气平静；下判断前会先复述自己听见或确认的事实，谈及父亲时会有短暂停顿。',
    habits: '思考时用拇指摩挲铜灯提梁；进入陌生机械室先数振动节律。',
    signatureItem: '旧铜灯与守灯人徽章',
    location: '北塔灯室',
    firstAppearance: '第一章　潮声迟到十三分钟',
    storyRole: '玩家主要视角与最终价值选择的承担者；连接守灯传统、事故家庭与全城公共责任。',
    ending: '根据选择成为公开事故的守灯见证人、七日修复的制度监督者，或率船队驶向黑潮源头。',
  },
  {
    name: '余砚',
    roleWeight: 'secondary',
    moralAxis: 'neutral',
    orderAxis: 'lawful',
    shortDescription: '旧档案馆管理员，保存着被港议会封存的潮位记录。',
    appearance: '灰色长衣、铜制单片护目镜，指尖常沾蓝墨。',
    personality: '谨慎、博学，以证据为先。',
    background: '曾是潮汐钟校准师，黑潮事故后被调离钟楼。',
    motivation: '让原始记录重新进入公共档案，并承认自己十年前只保存证据、没有及时作证的责任。',
    abilities: '档案修复、潮位曲线解读、钟机相位校准、蓝灯密码、议会文书流程。',
    relationships:
      '林澈是他选择重新行动的理由；顾潮生曾依据封缄令监视档案馆，两人彼此不信任却都知道对方没有伪造事故伤亡。',
    arc: '从相信“把证据藏好就是尽责”的守秘者，转为愿意带着证据走到广场、接受质询并公开作证的人。',
    identity: '旧档案馆管理员；前潮汐钟校准师；黑潮事故原始记录的保管人。',
    profile: '36岁，男性，人类，雾港本地人。',
    values: '事实必须可复核，记录不能只为权力服务；但证据在公开前也必须避免被再次销毁。',
    strengths: '记忆准确、耐心、掌握档案与钟机双重专业、能识别伪造和删改。',
    weaknesses: '行动迟缓，常用“证据还不够”推迟承担；面对人群时缺乏表达情绪的能力。',
    fears: '害怕公开失败会让唯一原件被毁，也害怕林澈发现他十年前曾有机会警告她父亲。',
    goals: '短期恢复黑潮记录页并取得校准码；长期建立任何议会都不能单独删除的分布式公共档案。',
    innerConflict: '他以谨慎保护真相，却逐渐发现没有见证人的真相仍可能等同于被删除。',
    keyEvents: '参与潮汐钟第六次校准；在事故前夜发现异常曲线；事故后被迫签署封缄令；用蓝墨暗号保存缺页索引。',
    powerLevel: '校准师：能读取和修改支线相位，但无行政通行权。',
    speechStyle: '精确、简短，只说自己能够证实的事；纠正数字时会摘下单片护目镜。',
    habits: '把关键句抄写两份并分别存放；紧张时检查墨水是否干透。',
    signatureItem: '铜制单片护目镜与蓝墨索引卡',
    location: '旧档案馆',
    firstAppearance: '第一章　潮声迟到十三分钟',
    storyRole: '证据链、世界机制解释和公开真相路线的核心推动者。',
    ending: '在真相路线成为公共听证的首位证人；在七日路线负责开放校准记录；在远航路线把档案副本交给留港者。',
  },
  {
    name: '顾潮生',
    roleWeight: 'secondary',
    moralAxis: 'neutral',
    orderAxis: 'lawful',
    shortDescription: '港议会巡潮官，奉命阻止任何人接近失声钟楼。',
    appearance: '黑色防潮制服，肩章像两枚闭合的潮眼。',
    personality: '强硬、务实，并非不在意港民。',
    background: '亲历黑潮事故，坚信公开真相会引发更大的灾难。',
    motivation:
      '在黑潮抵达前保持撤离、泵站与堤岸秩序，即使继续背负隐瞒；同时不愿让哥哥和四十六名死者再次被当成可以利用的数字。',
    abilities: '巡潮队指挥、堤岸应急、近战与救援、港区通行权、紧急状态法规。',
    relationships:
      '林澈让他看见守护可以不等于封锁；余砚掌握他无法反驳的记录；已故哥哥顾远舟是四十七名遇难钟机工之一。',
    arc: '从把秩序理解为压制信息与服从命令，到承认真正稳定必须容纳证据、责任和公开选择；也可能在玩家拒绝合作时成为最后阻拦者。',
    identity: '港议会巡潮官；巡潮队第三队指挥；封缄印的现场持有人。',
    profile: '31岁，男性，人类，雾港本地人。',
    values: '生命安全和可执行的秩序高于姿态；承诺一旦公开就必须有人负责落实。',
    strengths: '决断、组织能力强、熟悉全城应急系统、敢于亲自承担危险。',
    weaknesses: '习惯以命令替代解释，把公众想象成需要被管理的风险；对哥哥之死高度防御。',
    fears: '最怕真相在错误时刻造成踩踏和设施瘫痪，也怕承认自己十年来守护的是一份谎言。',
    goals: '短期完成封港与撤离、阻止钟机失控；长期让巡潮队不再成为议会删改历史的执行工具。',
    innerConflict: '他相信隐瞒曾救过更多人，却亲眼看到同一隐瞒正在让哥哥的姓名和全城记忆第二次死亡。',
    keyEvents:
      '黑潮事故中负责外堤救援；从遇难名单中认出哥哥；接受巡潮官任命；十年间执行封缄令；失潮之夜第一次违背议会口头命令。',
    powerLevel: '行政持权人：可调动巡潮队和开放钟楼通道，持有封缄印，但不懂完整校准。',
    speechStyle: '命令式语气，很少解释；动摇时会直呼林澈全名，谈到伤亡则改用完整姓名。',
    habits: '每到一处先确认出口和人数；做出困难决定后会重新扣紧右手手套。',
    signatureItem: '巡潮官封缄印',
    location: '潮灯集市与失声钟楼封锁线',
    firstAppearance: '第二章　潮灯下的失名者',
    storyRole: '秩序立场的主要对手与必要盟友；提供制度权限、撤离压力和非脸谱化冲突。',
    ending: '可在公开路线解除封锁并承担听证，在七日路线签署可追责契约，或在远航路线留守雾港执行撤离。',
  },
  {
    name: '潮汐商人',
    roleWeight: 'secondary',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '在潮灯集市经营零件与航线消息的行商，是普通港民利益和海上世界的窗口。',
    appearance: '穿多口袋防水斗篷，腰间挂着不同港口的潮票夹和一串会随水位变色的玻璃珠。',
    personality: '圆滑、敏锐、嘴上先谈价钱，真正危急时愿意帮人保留退路。',
    background: '常年往返黑礁群与南方航线，黑潮事故当夜曾把一船伤员送回雾港。',
    motivation: '保住集市居民的姓名、潮票和撤离资格，同时查明外海航线为何再次出现黑潮回声。',
    abilities: '航线情报、物资调度、识别潮石与船具、与多方谈判。',
    relationships: '与林澈交换近岸消息；欠顾潮生一次救援人情；为余砚秘密转运过档案副本。',
    arc: '从把所有风险都折算成价格的旁观者，转为用自己的船位和信用为失名者提供公开见证。',
    identity: '潮灯集市行商；商港行会外海联络人。',
    profile: '29岁，女性，人类，南方航线移居者。',
    values: '交易必须留有凭据，任何人都不该因为名字从账本消失就失去食物和船位。',
    strengths: '信息广、临场周旋强、熟悉物资与航线。',
    weaknesses: '过度回避明确站队，容易先保护自己的网络。',
    fears: '自己的流动身份会在封港中被视为无名者，所有积累一夜归零。',
    goals: '短期为失名者保住船位；长期建立不由议会单方控制的跨港信用记录。',
    innerConflict: '她依靠模糊立场生存，却必须在集市邻居被删除时决定什么不能拿来议价。',
    keyEvents: '参与黑潮事故救援；见过外海回声鲸异常迁徙；替余砚运出一份记录副本。',
    powerLevel: '资深航线经营者：无关键设施权限，但掌握船只、物资和外海信息。',
    speechStyle: '先用价格或航线打比方，再给出真正消息；紧急时会省去所有客套。',
    habits: '谈话时转动变色玻璃珠；记账从不只写编号，一定补上姓名。',
    signatureItem: '变色潮珠与多港潮票夹',
    location: '潮灯集市',
    firstAppearance: '第二章　潮灯下的失名者',
    storyRole: '补足普通港民、经济后果和远航可能性；可作为文字冒险中的交易与情报角色。',
    ending: '组织民船撤离、为公共档案提供跨港备份，或加入驶向黑潮的先遣船队。',
  },
  {
    name: '守钟人',
    roleWeight: 'npc',
    moralAxis: 'good',
    orderAxis: 'lawful',
    shortDescription: '负责失声钟楼日常保养的老机械师，十年来用维修暗记保存被删去的遇难者姓名。',
    appearance: '身材瘦高，穿旧皮围裙，左耳因事故失聪，手腕缠着四十七圈细铜线。',
    personality: '寡言、固执，对机器和姓名同样尊重。',
    background: '黑潮事故的幸存钟机工之一，官方记录称他当夜休假，实际是林澈父亲把他推出主机室。',
    motivation: '确保主钟不会再次由单一命令过载，并让四十七名同伴以完整姓名被城市记住。',
    abilities: '主钟结构、维修暗记、应急停机、唇读与手势沟通。',
    relationships: '受林澈父亲救命并教过年幼林澈辨认钟律；拒绝为余砚伪造证据；对顾潮生既愤怒又理解。',
    arc: '从躲在维修暗记中保存姓名，到在公共广场亲自敲响见证钟。',
    identity: '失声钟楼守钟人；黑潮事故幸存钟机工。',
    profile: '58岁，男性，人类，雾港本地人。',
    values: '机器可以维修，删去的人名不能用新零件替代；任何接管命令都必须留下可追责记录。',
    strengths: '经验深、原则稳定、熟悉主钟全部机械旁路。',
    weaknesses: '长期拒绝离开钟楼，不相信议会程序，也不善于寻求帮助。',
    fears: '主钟再次响起时，同伴只被当成燃料或英雄口号。',
    goals: '短期验证三枚权限并守住停机闸；长期建立由工匠和市民共同监督的钟机制度。',
    innerConflict: '他恨这台机器，却知道彻底毁掉它会让港民失去淡水、航线与家园。',
    keyEvents: '参与主钟建造；黑潮事故中被林泊川救出；用四十七种维修符号保存同伴姓名。',
    powerLevel: '主钟机械专家：能执行停机与旁路，但依法不能决定城市采用哪种运行方案。',
    speechStyle: '句子很短，常配合敲击和手势；称呼死者时一定说全名。',
    habits: '每天检查四十七个润滑点；说谎者靠近主轴时，他会把扳手横放在控制台上。',
    signatureItem: '缠有四十七圈铜线的停机扳手',
    location: '失声钟楼',
    firstAppearance: '第八章　失声钟楼',
    storyRole: '主钟规则的可信见证者、事故幸存者与最终操作执行者，防止技术解法凭空出现。',
    ending: '执行玩家选择的主钟方案，并把完整维修日志交给公共档案或远航队。',
  },
] as const

const LOCATION_ROWS = [
  [
    '雾港码头',
    ['港口', '海湾'],
    '浓雾中的青石码头，失潮后搁浅的船只像一排沉默骨架。',
    '开场地点与调查起点。',
  ],
  [
    '潮灯集市',
    ['集市', '港口'],
    '依靠悬挂潮灯照明的夜市，港民在这里交换消息与禁售零件。',
    '获得民间证言并遭遇巡潮官。',
  ],
  [
    '旧档案馆',
    ['城市', '遗迹'],
    '半沉入防洪墙的石砌档案馆，封存着十年前的黑潮记录。',
    '发现失潮机制与父亲留下的校准页。',
  ],
  [
    '失声钟楼',
    ['禁地', '港口'],
    '位于防波堤尽头的巨大铜钟楼，今夜第一次完全停止。',
    '最终抉择与多结局地点。',
  ],
  [
    '北塔灯室',
    ['要塞', '港口'],
    '俯瞰整座雾港的灯塔顶层，旧铜灯仍按守灯人的节律燃烧。',
    '角色关系与希望结局的情感锚点。',
  ],
] as const

const ARTIFACT_ROWS = [
  ['黄铜潮汐钥匙', '能重新咬合潮汐钟主轴的校准钥匙。', '钥匙齿纹对应旧档案最后一页的潮位曲线。'],
  ['守灯人徽章', '允许持有者在封港时进入灯塔与钟楼。', '徽章背面刻着雾港旧誓词：灯未熄，港未沉。'],
  [
    '黑潮记录页',
    '被港议会从公共档案中抽走的一页原始记录。',
    '它证明十年前的黑潮并非天灾，而是一次错误的钟机试验。',
  ],
] as const

const LORE_ROWS = [
  [
    '黑潮事故',
    '十年前导致雾港封锁与潮汐钟停摆的钟机试验事故。',
    '公开记录称它是极端天气，原始潮位页却证明议会曾强行提高钟机共振。',
  ],
  [
    '守灯人旧誓',
    '雾港守灯人世代相传的公共誓词。',
    '“灯未熄，港未沉。”它不是血统宣言，而是任何愿意守灯者都可承担的职责。',
  ],
] as const

const STORY_ARC_STAGES = [
  {
    id: 'mist-act-one',
    title: '第一幕 · 失潮之夜',
    description:
      '午夜潮汐迟到十三分钟，港民姓名从登记册和记忆里消失。林澈必须先追查旧档案，或先保护潮灯集市里的失名者。',
    keyEvents: ['码头失潮与姓名褪色', '档案馆蓝灯暗号', '潮灯集市公共证词', '黑潮事故的十三分钟'],
    turningPoint: '确认潮汐钟正在以城市记忆为代价重新充能',
  },
  {
    id: 'mist-act-two',
    title: '第二幕 · 城市的潮心',
    description:
      '调查路线在地下泵站汇合。林澈可修复机械旁路争取安全窗口，或找回四十七名遇难者姓名；随后在北塔选择父亲记录或议会封缄令。',
    keyEvents: [
      '逆转泵轮或沉没者名录',
      '顾潮生承认哥哥之死',
      '父亲第七码或议会封缄令',
      '三方共同取得钟楼接管权',
    ],
    turningPoint: '三人得知重启、限流与断钟都必须承担不可撤销的代价',
  },
  {
    id: 'mist-act-three',
    title: '第三幕 · 失声钟楼',
    description: '黑潮抵达前，林澈在公开全部记录、签下七日公开之约和彻底断钟驶向潮源之间作出最终选择。',
    keyEvents: ['真相之钟', '守灯人的黎明', '向黑潮航行'],
    turningPoint: '雾港不再寻找无代价的答案，而是公开记录自己选择承担的代价',
  },
]

const STORY_ARC_DESCRIPTION =
  '三幕多结局主线：从失潮与失名异象出发，揭开潮汐钟以集体记忆维持秩序的黑潮旧案，并在真相、撤离安全与远航追源之间作出选择。所有可玩路线都会跨越三幕，并在钟楼收束为三种明确结局。'

async function ensureCharacters(scope: WorkspaceScope): Promise<Map<string, number>> {
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'characters',
    mode: 'add-many',
    data: CHARACTER_ROWS.map((row) => ({ ...row })),
  })
  const current = await readOwnedRows<Character>(scope, 'characters')
  const ids = new Map<string, number>()
  for (const row of CHARACTER_ROWS) {
    const existing = current.find((item) => item.name === row.name)
    if (!existing?.id) throw new Error(`[mist-harbor] 角色采纳失败:${row.name}`)
    ids.set(row.name, existing.id)
  }
  return ids
}

async function ensureWorldAssets(scope: WorkspaceScope, characters: Map<string, number>): Promise<void> {
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'importantLocations',
    mode: 'add-many',
    data: LOCATION_ROWS.map(([name, tags, description, significance], sortOrder) => ({
      name,
      tags,
      description,
      significance,
      parentId: null,
      sortOrder,
    })),
  })
  let loreCategory = (await readOwnedRows<CodexCategory>(scope, 'codexCategories')).find(
    (item) => item.builtInKey === 'humEvent',
  )
  if (!loreCategory) {
    await adopt({
      projectId: scope.projectId,
      scope,
      target: 'codexCategories',
      mode: 'add',
      data: {
        domain: 'humanity',
        parentId: null,
        name: '世界事件',
        builtInKey: 'humEvent',
        fieldSchema: [],
        hidden: false,
        order: 1,
      },
    })
    loreCategory = (await readOwnedRows<CodexCategory>(scope, 'codexCategories')).find(
      (item) => item.builtInKey === 'humEvent',
    )
  }
  if (!loreCategory?.id) throw new Error('[mist-harbor] 世界事件分类采纳失败')
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'codexEntries',
    mode: 'add-many',
    data: LORE_ROWS.map(([name, summary, description], order) => ({
      categoryId: loreCategory!.id!,
      name,
      summary,
      description,
      fields: {},
      refs: {},
      tags: ['雾港', '世界知识'],
      importance: 5 - order,
      order,
    })),
  })
  let category = (await readOwnedRows<CodexCategory>(scope, 'codexCategories')).find(
    (item) => item.builtInKey === 'artifact',
  )
  if (!category) {
    await adopt({
      projectId: scope.projectId,
      scope,
      target: 'codexCategories',
      mode: 'add',
      data: {
        domain: 'humanity',
        parentId: null,
        name: '人工器物',
        builtInKey: 'artifact',
        fieldSchema: [],
        hidden: false,
        order: 0,
      },
    })
    category = (await readOwnedRows<CodexCategory>(scope, 'codexCategories')).find(
      (item) => item.builtInKey === 'artifact',
    )
  }
  if (!category?.id) throw new Error('[mist-harbor] artifact 分类采纳失败')
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'codexEntries',
    mode: 'add-many',
    data: ARTIFACT_ROWS.map(([name, summary, description], order) => ({
      categoryId: category!.id!,
      name,
      summary,
      description,
      fields: {},
      refs: {},
      tags: ['雾港', '关键道具'],
      importance: 5 - order,
      order,
    })),
  })
  const relationRows = [
    [
      '林澈',
      '余砚',
      'ally',
      '真相同盟',
      '余砚掌握记录，林澈拥有进入钟楼的资格；两人需要彼此才能完成调查。',
      true,
    ],
    ['林澈', '顾潮生', 'rival', '守港理念冲突', '两人都想保护雾港，却对公开真相与维持秩序有相反判断。', true],
    [
      '余砚',
      '守钟人',
      'ally',
      '事故见证人与记录保管人',
      '余砚保存纸面证据，守钟人保存机械暗记；两人十年来各自守住同一真相的不同部分。',
      true,
    ],
    [
      '潮汐商人',
      '顾潮生',
      'other',
      '救援旧债',
      '黑潮事故当夜顾潮生为商船开放外堤，潮汐商人因此欠他一次救援人情，却反对他继续封锁失名者。',
      true,
    ],
  ] as const
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'characterRelations',
    mode: 'add-many',
    data: relationRows.map(([from, to, relationType, label, description, isBidirectional]) => ({
      fromCharacterId: characters.get(from)!,
      toCharacterId: characters.get(to)!,
      relationType,
      label,
      description,
      isBidirectional,
    })),
  })
  const arc = (await readOwnedRows<StoryArc>(scope, 'storyArcs')).find((item) => item.name === '失潮钟声主线')
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'storyArcs',
    ...(arc?.id ? { recordId: arc.id } : {}),
    mode: arc?.id ? 'replace' : 'add',
    data: {
      name: '失潮钟声主线',
      type: 'main',
      stages: STORY_ARC_STAGES,
      description: STORY_ARC_DESCRIPTION,
    },
  })
}

const GEOGRAPHY_OVERVIEW =
  '雾港位于长雾海北缘的凹形玄武岩海湾。城市依山势分成上城、潮灯中城与沿堤下港，五条防潮堤围出内港，北塔灯室和失声钟楼分别把守海湾两端。退潮时会露出通向旧泵站的石脊，黑潮来临时则全部没入海面。'
const WORLDVIEW = {
  politicsOverview:
    '港议会、巡潮队、守灯人和商港行会构成城市秩序。议会掌握钟机档案与封港权；巡潮队维护堤岸和宵禁；守灯人负责公共航标；行会控制物资与船位。普通港民依靠潮牌获得工作、配给和撤离顺序。',
  cultureOverview:
    '雾港没有神权组织。市民相信记录、灯火与公开见证能够抵抗遗忘。守灯人旧誓“灯未熄，港未沉”属于公共职责而非血统特权；葬礼会把逝者姓名写在耐盐铜片上，投入钟楼下的回声井。',
  economyOverview:
    '货币为雾铢与议会潮票；产业包括远洋转运、钟机维修、盐晶加工、潮灯制造；贸易依靠长雾海航线与限时开港窗口',
  worldOrigin:
    '这是一个以近代工业、海港自治和低度奇异科技为基础的架空世界。雾港由最早穿越长雾海的测潮船队建立，城市围绕一台能把月潮转化为机械动力的潮汐钟成长。奇异现象来自可测量的潮汐共振，不存在神明直接干预。',
  powerHierarchy:
    '力量不以个人修炼划分，而以对潮汐共振工学的理解和设备权限划分：普通港民只能使用潮灯与潮牌；钟机师可校准支线设备；守灯人与巡潮官持有关键设施通行权；只有三枚权限印记同时生效时，才能接管潮汐钟主轴。',
  divineDesign: {
    hasDivinity: false,
    divineRank: '无神明层级',
    divineNames: '无',
    divineRules:
      '所谓海神与潮语是港民对共振现象的民俗解释，剧情中的关键因果必须能由设备、制度、记录与人物选择追溯。',
  },
  worldStructure:
    '单一海洋星球上的沿海城市与近海群岛。当前故事聚焦雾港内港、北部灯塔、防波堤钟楼和可航行的长雾海；远方世界只以航线、商船与失踪记录出现。',
  worldDimensions:
    '雾港主城区东西约十二公里、南北约九公里；内港宽四公里。步行横穿城区约两小时，巡潮艇从码头抵达钟楼约二十分钟。',
  continentLayout:
    '雾港背靠北岸断崖，面向长雾海。西侧盐沼提供盐晶和药草，东侧黑礁群形成天然航道，南方外海是黑潮与远航线的来源。',
  regionDimensions:
    '上城约十八平方公里，中城约三十二平方公里，下港与堤岸设施约二十五平方公里；故事中的十个主要场景都处于一夜内可抵达的尺度。',
  mountainsRivers:
    '北岸断崖储存淡水，三条暗渠汇入地下泵站；城市没有大河，内外港水位完全依赖潮门、泵轮和五条防潮堤调节。',
  climateByRegion:
    '全年多雾、潮湿、低温。上城风强而干燥，中城常有盐雾凝露，下港受潮差影响最大；黑潮到来前会出现无风、灯焰向海面弯折和金属低鸣。',
  naturalResourceOverview:
    '主要资源是盐晶、耐盐苔、深水鱼油、黑礁铜矿和可储存共振的潮石。所有奇异材料都服务于航海与钟机工业，不形成脱离世界规则的万能魔法。',
  naturalResources: {
    rareCreatures: '雾鳐、回声鲸、黑礁盲鱼',
    herbs: '耐盐苔、雾薄荷、止潮藻',
    minerals: '黑礁铜、潮石、蓝盐晶',
    others: '鲸油、耐潮木、深海玻璃',
  },
  races:
    '主要居民均为人类。雾港人的差异来自职业、阶层、航线出身与是否经历黑潮，而非种族能力；远航船员、盐沼居民和上城议员拥有不同经验与利益。',
  factionLayout:
    '港议会控制行政与档案；巡潮队控制武装、宵禁和关键通道；守灯人维持航标与公共誓约；商港行会掌握船只、工匠和物资；失名者家属组成非正式的“铜片会”，要求公开死者名单。',
  internalConflicts:
    '核心矛盾有三层：公开真相与维持秩序的政治冲突；恢复潮汐与保存集体记忆的技术冲突；林澈寻找父亲与承担公共职责的私人冲突。余砚代表证据，顾潮生代表秩序，两人都不能被写成单纯工具人。',
  itemDesign:
    '关键道具全部具有制度或机械功能：黄铜潮汐钥匙重接主轴；守灯人徽章提供通行与授权；黑潮记录页证明事故因果。道具不能凭空解决危机，每件都必须通过调查、关系或选择获得。',
}

const WORLD_RULE_ENTRIES = {
  'era.period': {
    historicalAnchors: '近代工业港口、机械钟楼、城市议会与海贸行会。',
    fictionalAdaptations: '低度奇异科技让潮汐能被机械共振校准，并能编码姓名与记忆。',
    priority: 'balanced',
  },
  'era.divergence': {
    historicalAnchors: '蒸汽时代城市基础设施与档案官僚制。',
    fictionalAdaptations: '潮石替代部分燃煤动力，雾港由潮汐钟成为独立自治港。',
    priority: 'fictional',
  },
  'era.calendar': {
    historicalAnchors: '以城市重大工程落成为地方纪年起点。',
    fictionalAdaptations: '采用钟历与潮刻，一日八潮刻，失潮以分钟偏差被精确记录。',
    priority: 'balanced',
  },
  events: {
    historicalAnchors: '工业事故常伴随责任掩盖、档案删改与公共安全争议。',
    fictionalAdaptations: '黑潮事故导致姓名信息被钟机吸收，十年后以失名现象回返。',
    priority: 'balanced',
  },
  'geography.terrain': {
    historicalAnchors: '玄武岩海湾、断崖、盐沼与黑礁航道。',
    fictionalAdaptations: '退潮石脊可通往地下泵站，黑潮会改变近岸声学而不瞬间改写地形。',
    priority: 'historical',
  },
  'geography.cities': {
    historicalAnchors: '上城、中城、下港与堤岸设施按产业和地势分层。',
    fictionalAdaptations: '潮汐钟、北塔灯室和回声井共同构成城市的记忆基础设施。',
    priority: 'balanced',
  },
  'geography.water': {
    historicalAnchors: '潮门、泵站、防潮堤和内外港水位差。',
    fictionalAdaptations: '钟机共振可短时延迟潮峰，但能量代价必须落到设备、记忆或人员风险。',
    priority: 'historical',
  },
  'geography.roads': {
    historicalAnchors: '石板街、堤顶巡逻路、升降桥和近岸航道。',
    fictionalAdaptations: '失潮时开放石脊捷径，封港时巡潮队控制钟楼与北塔通道。',
    priority: 'balanced',
  },
  'climate.weather': {
    historicalAnchors: '冷湿海洋性气候、浓雾、盐雾与强风。',
    fictionalAdaptations: '黑潮前无风、金属低鸣、灯焰向海弯折，作为可重复识别的危机征兆。',
    priority: 'balanced',
  },
  'climate.disaster': {
    historicalAnchors: '风暴潮、海水倒灌、堤岸失效与航运中断。',
    fictionalAdaptations: '黑潮同时冲击水位与城市记录，但不能无条件抹除实体或复活死者。',
    priority: 'historical',
  },
  'politics.system': {
    historicalAnchors: '商港寡头议会、专业官署与紧急状态授权。',
    fictionalAdaptations: '关键钟机权力被拆分为三枚权限印记，避免单一角色轻易控制全城。',
    priority: 'balanced',
  },
  'politics.law': {
    historicalAnchors: '封港令、档案密级、宵禁、事故调查与公共听证。',
    fictionalAdaptations: '七日公开之约是具有记录效力的紧急契约，违约会触发议会席位复核。',
    priority: 'historical',
  },
  'economy.trade': {
    historicalAnchors: '转口贸易、船位、仓单、行会信用与海运保险。',
    fictionalAdaptations: '潮票价值与下一次可航潮窗绑定，失潮会造成即时信用危机。',
    priority: 'historical',
  },
  'technology.engineering': {
    historicalAnchors: '钟表机构、泵轮、液压闸门、灯塔光学与机械校准。',
    fictionalAdaptations: '潮石可储存低频共振，黄铜钥匙用于机械相位校准而非施法。',
    priority: 'balanced',
  },
  'culture.philosophy': {
    historicalAnchors: '海员共同体强调誓言、遇难者纪念、公共灯塔与姓名登记。',
    fictionalAdaptations: '雾港的主流公共伦理认为记录和见证能够抵抗遗忘，耐盐铜片与回声井把它变成可见仪式。',
    priority: 'historical',
  },
  'supernatural.system': {
    historicalAnchors: '不采用真实宗教作为超自然因果。',
    fictionalAdaptations: '所有异常均归入潮汐共振工学；若无法说明代价、载体和边界，就不能成为解法。',
    priority: 'fictional',
  },
} as const

const GEOGRAPHY_LOCATIONS = [
  {
    id: 'mist-harbor',
    name: '雾港',
    type: 'city',
    description: '长雾海北缘的商港自治城，由上城、中城、下港和五道防潮堤组成。',
    significance: '所有角色关系、制度矛盾与危机代价的共同容器。',
    parentId: null,
    order: 0,
  },
  {
    id: 'mist-dock',
    name: '雾港码头',
    type: 'building',
    description: '青石码头与搁浅船阵构成的失潮现场。',
    significance: '开场发现潮汐迟到、姓名褪色和黑潮征兆。',
    parentId: 'mist-harbor',
    order: 1,
  },
  {
    id: 'mist-market',
    name: '潮灯集市',
    type: 'building',
    description: '依靠悬挂潮灯照明的夜市，消息、零件和潮票在此流通。',
    significance: '民间证词与巡潮队秩序第一次正面冲突。',
    parentId: 'mist-harbor',
    order: 2,
  },
  {
    id: 'mist-archive',
    name: '旧档案馆',
    type: 'building',
    description: '半沉入防洪墙的石砌档案馆，蓝灯暗号标出被删记录。',
    significance: '找到黑潮记录页和钟机校准证据。',
    parentId: 'mist-harbor',
    order: 3,
  },
  {
    id: 'mist-pump',
    name: '地下泵站',
    type: 'ruin',
    description: '位于退潮石脊下方的旧泵轮与遇难者维护通道。',
    significance: '调查路线汇合，机械安全与死者姓名发生抉择。',
    parentId: 'mist-harbor',
    order: 4,
  },
  {
    id: 'mist-north-tower',
    name: '北塔灯室',
    type: 'building',
    description: '俯瞰海湾的公共灯塔，保存守灯徽章与林澈父亲的第七码。',
    significance: '私人真相、公共责任和同伴信任的情感锚点。',
    parentId: 'mist-harbor',
    order: 5,
  },
  {
    id: 'mist-bell',
    name: '失声钟楼',
    type: 'building',
    description: '防波堤尽头的巨型铜钟楼，主轴连接全城潮门。',
    significance: '三枚权限汇合并作出最终路线选择。',
    parentId: 'mist-harbor',
    order: 6,
  },
  {
    id: 'mist-black-tide',
    name: '长雾海外海',
    type: 'nature',
    description: '黑潮形成与远航失踪记录指向的未知海域。',
    significance: '远航结局把城市问题转化为更大世界的探索入口。',
    parentId: null,
    order: 7,
  },
] as const

const HISTORY_EVENTS = [
  {
    id: 'mist-history-01',
    era: '钟历',
    date: '钟历元年',
    title: '潮汐钟启用',
    description: '第一代测潮船队完成主钟与五道潮门的联动，雾港由季节性泊地成为常设商港。',
    impact: '建立钟历、港议会与守灯人制度。',
    order: 0,
  },
  {
    id: 'mist-history-02',
    era: '钟历',
    date: '钟历十二年',
    title: '五堤合围',
    description: '内港防潮堤全部落成，地下泵站接入淡水和货运系统。',
    impact: '城市人口扩大，生存开始依赖钟机基础设施。',
    order: 1,
  },
  {
    id: 'mist-history-03',
    era: '钟历',
    date: '钟历三十七年',
    title: '黑潮事故',
    description: '港议会强行提高钟机共振，黑潮提前抵港，四十七名钟机工与船员死亡。',
    impact: '原始记录被封存，余砚被调离钟楼，林澈父亲失踪，顾潮生失去兄长。',
    order: 2,
  },
  {
    id: 'mist-history-04',
    era: '钟历',
    date: '钟历三十八年',
    title: '封缄令生效',
    description: '事故被改写为极端天气，遇难者姓名从公共纪念册和维修记录中移除。',
    impact: '维持十年表面秩序，也让记忆债务积累在潮汐钟中。',
    order: 3,
  },
  {
    id: 'mist-history-05',
    era: '钟历',
    date: '钟历四十七年·失潮之夜',
    title: '潮汐迟到十三分钟',
    description: '潮声停止，登记册与人的记忆开始同时丢失姓名，黑潮在外海重新成形。',
    impact: '迫使林澈、余砚与顾潮生重新打开事故记录并接管钟楼。',
    order: 4,
  },
] as const

const CHAPTER_CONFIGS = [
  {
    title: '第一章　潮声迟到十三分钟',
    act: 0,
    nodes: ['entry'],
    summary:
      '守灯人林澈在雾港码头发现潮汐迟到、登记册姓名褪色和黑潮征兆，并在余砚留下的蓝灯暗号与集市骚动之间作出第一步调查选择。',
    location: '雾港码头',
    emotionArc: 'rising',
  },
  {
    title: '第二章　潮灯下的失名者',
    act: 0,
    nodes: ['market', 'patrol'],
    summary:
      '林澈在潮灯集市见证普通港民失去姓名与潮牌权利，顾潮生以封港秩序阻拦调查，三人的立场首次正面碰撞。',
    location: '潮灯集市',
    emotionArc: 'wave',
  },
  {
    title: '第三章　被抽走的记录页',
    act: 0,
    nodes: ['archive', 'vault'],
    summary: '余砚带林澈进入旧档案馆密库，复原黑潮记录页与十三分钟校准差，证明议会曾主动让潮汐钟过载。',
    location: '旧档案馆',
    emotionArc: 'rising',
  },
  {
    title: '第四章　退潮石脊之下',
    act: 1,
    nodes: ['undercity'],
    summary:
      '两条调查路线在下港石脊汇合。众人进入地下维护通道，看见钟机正在用全城姓名偿还十年前积累的能量债。',
    location: '下港石脊与维护隧道',
    emotionArc: 'rising',
  },
  {
    title: '第五章　泵轮与四十七个名字',
    act: 1,
    nodes: ['pump', 'shrine'],
    summary:
      '林澈必须在修复泵轮争取安全窗口与找回四十七名遇难者姓名之间分配时间，机械路线与纪念路线分别揭开不同代价。',
    location: '地下泵站与遇难者铜片室',
    emotionArc: 'wave',
  },
  {
    title: '第六章　北塔的三枚权限',
    act: 1,
    nodes: ['north-tower'],
    summary:
      '三人抵达北塔灯室，确认接管主钟需要守灯徽章、档案校准码和议会封缄印共同生效；同盟建立在互不相同的动机上。',
    location: '北塔灯室',
    emotionArc: 'rising',
  },
  {
    title: '第七章　父亲第七码与封缄令',
    act: 1,
    nodes: ['father-log', 'council-seal'],
    summary:
      '林澈可追读父亲留下的第七码，或先审视顾潮生携带的封缄令；私人失踪与制度责任被证明是同一事故的两面。',
    location: '北塔记录室',
    emotionArc: 'climax',
  },
  {
    title: '第八章　失声钟楼',
    act: 2,
    nodes: ['bell'],
    summary:
      '黑潮逼近，三枚权限同时接入潮汐钟。余砚要求公开，顾潮生要求限流撤离，林澈必须决定城市如何承担没有无代价答案的现实。',
    location: '失声钟楼主机室',
    emotionArc: 'climax',
  },
  {
    title: '第九章　把名字还给全城',
    act: 2,
    nodes: ['public-square'],
    summary:
      '若选择公开，档案、铜片与钟声在公共广场完成交叉见证；真相不再属于某个英雄，而成为全城必须共同记录的责任。',
    location: '议会前公共广场',
    emotionArc: 'climax',
  },
  {
    title: '第十章　雾散以前',
    act: 2,
    nodes: ['truth', 'home', 'sea'],
    summary:
      '故事以真相之钟、守灯人的黎明或向黑潮航行三种结局收束，分别回答公开、修复与追源三种价值选择，并保留未来世界扩展入口。',
    location: '雾港与长雾海外海',
    emotionArc: 'falling',
  },
] as const

const ACTS = [
  {
    title: '第一幕　失潮之夜',
    summary: '从码头异常、集市失名和档案缺页建立危机，确认潮汐钟正在用城市记忆维持运转。',
  },
  {
    title: '第二幕　城市的潮心',
    summary: '调查深入泵站和北塔，四十七名遇难者、父亲记录与三方权限把人物伤痕连接成制度真相。',
  },
  {
    title: '第三幕　让城市选择代价',
    summary: '在黑潮抵达前接管失声钟楼，让公开真相、限流守港和断钟远航形成三种可承担的结局。',
  },
] as const

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderChapterContent(config: (typeof CHAPTER_CONFIGS)[number]): string {
  const paragraphs = MIST_HARBOR_ROADSHOW_BEATS.filter((beat) =>
    (config.nodes as readonly string[]).includes(beat.nodeKey),
  ).map((beat) => {
    const text = escapeHtml(beat.text)
    if (beat.kind === 'dialogue' && beat.speaker)
      return `<p><strong>${escapeHtml(beat.speaker)}：</strong>${text}</p>`
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
      globalNote:
        '雾港采用“工业基础设施 + 低度奇异共振”的统一因果。任何新增设定都要说明载体、权限、代价和可验证证据；角色不能靠临时出现的超能力绕过公共选择。',
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'geographies',
    mode: 'replace',
    data: { overview: GEOGRAPHY_OVERVIEW, locations: GEOGRAPHY_LOCATIONS },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'histories',
    mode: 'replace',
    data: {
      overview:
        '雾港的历史不是背景年表，而是当夜危机的因果链：城市依赖潮汐钟繁荣，议会在十年前用过载换取安全，随后删除四十七名死者和事故责任；被压入钟机的记录在失潮之夜以姓名褪色的方式回返。',
      eraSystem:
        '采用“钟历”，以潮汐钟启用为元年；日常时间同时使用八个潮刻，精密钟机记录仍以小时和分钟标注，因此“迟到十三分钟”具有公开可核验性。',
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
      description:
        '通过潮石、黄铜谐振器、泵轮和大型钟机捕获月潮低频能量的工程体系。能力来自知识、设备和制度权限，而非个人魔力；同一原理既能照明、泵水和开辟航窗，也能在过载时损伤记录与记忆。',
      levels: [
        { id: 'civilian', name: '民用潮具', capability: '使用潮灯、潮牌和常规泵具' },
        { id: 'artisan', name: '钟机工', capability: '维护支线谐振器与读取潮位曲线' },
        { id: 'calibrator', name: '校准师', capability: '修改相位、编写校准码并判断过载风险' },
        { id: 'custodian', name: '设施持权人', capability: '凭正式印记进入北塔、泵站和钟楼控制区' },
        { id: 'triune', name: '三权接管', capability: '三枚权限共同生效后调整或关闭潮汐钟主轴' },
      ],
      rules:
        '共振必须有设备载体；能量转移必须留下可见代价；越过设施权限需要剧情证据；单人不能接管主钟；记忆损失不能被一句台词无条件复原；最终解法只能在公开、限流或断钟三条已建立的机制内演化。',
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'storyCores',
    mode: 'replace',
    data: {
      theme:
        '一个城市能否以遗忘受害者为代价维持安全；真正的守护不是替所有人隐瞒，而是让共同体看见并承担自己的选择。',
      centralConflict:
        '黑潮抵达前，林澈必须重启、限制或关闭正在吞噬姓名的潮汐钟；余砚坚持公开事故记录，顾潮生担心真相引发撤离崩溃，三人又必须合作取得接管权限。',
      plotPattern:
        '三幕式调查悬疑 + 路线汇合 + 价值选择多结局。第一幕发现异常与证据，第二幕追溯系统代价和人物旧伤，第三幕把技术危机转化为公开决策。',
      logline:
        '失潮之夜，能听懂钟声的守灯人必须与一名守秘档案员和一名封港巡潮官合作，在全城姓名消失前揭开十年前的黑潮旧案，并决定雾港愿意为安全、真相或自由付出什么代价。',
      concept:
        '把“城市记忆”落实为档案、身份牌、遇难者姓名和公共见证，再用一台吞噬记录的基础设施迫使玩家选择。谜团的答案不只是凶手或秘密，而是一个共同体如何处理被刻意删除的历史。',
      mainPlot:
        '林澈从码头失潮出发，经潮灯集市或旧档案馆取得民间证词与黑潮记录，在地下泵站确认记忆债务，在北塔集齐守灯徽章、校准码和封缄印，最终接管失声钟楼，走向真相之钟、七日公开之约或断钟远航。',
      subPlots:
        '林澈追寻父亲第七码并从私人执念转向公共责任；余砚从保存证据转为公开作证；顾潮生面对哥哥之死与秩序信念的冲突；四十七名遇难者姓名从被删去的数字恢复为可被城市共同见证的人。',
    },
  })
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'creativeRules',
    mode: 'replace',
    data: {
      writingStyle:
        '克制的工业海港悬疑。环境描写强调盐雾、黄铜、低频震动、灯焰和潮声；对白短而有信息差，每段对话都推动证据、关系或选择，不用旁白替角色宣布主题。',
      narrativePOV: 'third-limited',
      atmosphere:
        '冷湿、压迫而不绝望；前两幕以蓝灰与铜灯制造调查感，终幕让公共广场、黎明或外海分别释放不同情绪。',
      prohibitions: [
        '不新增无来源神力或万能道具',
        '不把顾潮生写成纯粹恶人',
        '不让父亲突然生还解决冲突',
        '不以梦境或失忆否定玩家已经获得的证据',
        '不绕过三枚权限直接控制主钟',
      ],
      consistencyRules: [
        '潮汐迟到固定为十三分钟',
        '黑潮事故死亡人数固定为四十七人',
        '主钟接管需要守灯徽章、档案校准码和议会封缄印',
        '奇异现象必须遵守潮汐共振工学的载体与代价',
        '林澈、余砚、顾潮生的冲突来自价值与经历而非信息降智',
      ],
      specialRequirements:
        '可玩投影必须保留证据获取、路线汇合、三方合作与三结局。AVG 可加强镜头和情绪表现，文字冒险可增加物品与地点交互，但不能改变正式世界因果。',
      citedReferenceIds: [],
      citedInsightIds: [],
    },
  })
}

async function ensureOutlineNode(
  scope: WorkspaceScope,
  data: Pick<OutlineNode, 'parentId' | 'type' | 'title' | 'summary' | 'order'>,
): Promise<OutlineNode & { id: number }> {
  let current = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes')).find(
    (item) =>
      (item.parentId ?? null) === data.parentId && item.type === data.type && item.title === data.title,
  )
  if (current?.id) {
    await adopt({
      projectId: scope.projectId,
      scope,
      target: 'outlineNodes',
      recordId: current.id,
      mode: 'replace',
      data,
    })
  } else {
    await adopt({ projectId: scope.projectId, scope, target: 'outlineNodes', mode: 'add', data })
    current = (await readOwnedRows<OutlineNode>(scope, 'outlineNodes')).find(
      (item) =>
        (item.parentId ?? null) === data.parentId && item.type === data.type && item.title === data.title,
    )
  }
  if (!current?.id) throw new Error(`[mist-harbor] 大纲节点写入失败:${data.title}`)
  return current as OutlineNode & { id: number }
}

async function ensureAuthoringStructure(
  scope: WorkspaceScope,
  characters: Map<string, number>,
): Promise<void> {
  const volume = await ensureOutlineNode(scope, {
    parentId: null,
    type: 'volume',
    title: '第一卷　失潮钟声',
    summary:
      '一夜之内，雾港从潮声停止与姓名褪色的局部异常，走向必须公开历史、限制系统或驶向未知的共同体选择。全卷采用三幕十章结构，对应可玩叙事的完整调查与三结局。',
    order: 0,
  })
  const acts: Array<OutlineNode & { id: number }> = []
  for (const [order, act] of ACTS.entries()) {
    acts.push(
      await ensureOutlineNode(scope, {
        parentId: volume.id,
        type: 'storyBlock',
        title: act.title,
        summary: act.summary,
        order,
      }),
    )
  }
  const chapterNodes: Array<OutlineNode & { id: number }> = []
  for (const [order, config] of CHAPTER_CONFIGS.entries()) {
    chapterNodes.push(
      await ensureOutlineNode(scope, {
        parentId: acts[config.act].id,
        type: 'chapter',
        title: config.title,
        summary: config.summary,
        order,
      }),
    )
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
    const existing = existingChapters.find(
      (item) => item.outlineNodeId === node.id || item.title === config.title,
    )
    const installerOwned =
      !existing?.content?.trim() || existing.content.includes('data-mist-harbor-roadshow=')
    if (!existing?.id)
      await adopt({ projectId: scope.projectId, scope, target: 'chapters', mode: 'add', data })
    else if (installerOwned)
      await adopt({
        projectId: scope.projectId,
        scope,
        target: 'chapters',
        recordId: existing.id,
        mode: 'replace',
        data,
      })
  }

  const chapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
  const chapterByOrder = CHAPTER_CONFIGS.map((config) => {
    const chapter = chapters.find((item) => item.title === config.title)
    if (!chapter?.id) throw new Error(`[mist-harbor] 章节写入失败:${config.title}`)
    return chapter as Chapter & { id: number }
  })
  const foreshadowRows = [
    {
      name: '迟到十三分钟',
      type: 'timeline',
      status: 'resolved',
      description: '开场潮位偏差与十年前过载记录使用同一数值，证明今夜危机是黑潮事故的延迟回返。',
      plantChapterId: chapterByOrder[0].id,
      echoChapterIds: [chapterByOrder[2].id, chapterByOrder[6].id],
      resolveChapterId: chapterByOrder[7].id,
      expectedResolveChapterId: chapterByOrder[7].id,
      notes: '数字必须始终保持十三分钟。',
      timelinePosition: 0.1,
      importance: 10,
      urgency: 'low',
    },
    {
      name: '被删去的四十七个名字',
      type: 'callback',
      status: 'resolved',
      description: '失名者、档案缺页和铜片室逐步把事故统计恢复为具体姓名，最终成为公共见证的核心。',
      plantChapterId: chapterByOrder[1].id,
      echoChapterIds: [chapterByOrder[2].id, chapterByOrder[4].id],
      resolveChapterId: chapterByOrder[8].id,
      expectedResolveChapterId: chapterByOrder[8].id,
      notes: '不要只把遇难者作为机关密码。',
      timelinePosition: 0.2,
      importance: 10,
      urgency: 'low',
    },
    {
      name: '父亲留下的第七码',
      type: 'character',
      status: 'resolved',
      description: '林澈父亲留下的校准节律既是私人线索，也是证明单人不应控制公共设施的警告。',
      plantChapterId: chapterByOrder[0].id,
      echoChapterIds: [chapterByOrder[5].id],
      resolveChapterId: chapterByOrder[6].id,
      expectedResolveChapterId: chapterByOrder[6].id,
      notes: '父亲不以突然现身的方式回归。',
      timelinePosition: 0.12,
      importance: 8,
      urgency: 'low',
    },
    {
      name: '三枚权限印记',
      type: 'chekhov',
      status: 'resolved',
      description:
        '守灯徽章、档案校准码与议会封缄印分别代表公共职责、证据和行政权，必须共同接入才能接管主钟。',
      plantChapterId: chapterByOrder[2].id,
      echoChapterIds: [chapterByOrder[5].id, chapterByOrder[6].id],
      resolveChapterId: chapterByOrder[7].id,
      expectedResolveChapterId: chapterByOrder[7].id,
      notes: '任何游戏投影都不得绕过三权接管条件。',
      timelinePosition: 0.3,
      importance: 10,
      urgency: 'low',
    },
  ] as const
  await adopt({
    projectId: scope.projectId,
    scope,
    target: 'foreshadows',
    mode: 'add-many',
    data: foreshadowRows.map((row) => ({ ...row })),
  })

  const foreshadows = await readOwnedRows<{ id?: number; name: string }>(scope, 'foreshadows')
  const foreshadowIds = foreshadows
    .filter((item) => foreshadowRows.some((row) => row.name === item.name))
    .flatMap((item) => item.id ?? [])
  const nodeByKey = new Map(MIST_HARBOR_ROADSHOW_NODES.map((item) => [item.key, item]))
  const existingDetails = await readOwnedRows<DetailedOutline>(scope, 'detailedOutlines')
  for (const [order, config] of CHAPTER_CONFIGS.entries()) {
    const node = chapterNodes[order]
    const characterIds = [
      ...new Set(
        MIST_HARBOR_ROADSHOW_BEATS.filter(
          (beat) => (config.nodes as readonly string[]).includes(beat.nodeKey) && beat.speaker,
        )
          .flatMap((beat) => (beat.speaker ? [characters.get(beat.speaker)] : []))
          .filter((id): id is number => typeof id === 'number'),
      ),
    ]
    const scenes = config.nodes.map((nodeKey, sceneOrder) => {
      const narrativeNode = nodeByKey.get(nodeKey)
      return {
        sceneId: `mist-roadshow-${String(order + 1).padStart(2, '0')}-${String(sceneOrder + 1).padStart(2, '0')}`,
        title: narrativeNode?.title ?? config.title,
        summary: narrativeNode?.summary ?? config.summary,
        characterIds,
        location: config.location,
        conflict: config.summary,
        pace:
          config.emotionArc === 'climax'
            ? 'climax'
            : config.emotionArc === 'falling'
              ? 'slow'
              : sceneOrder === config.nodes.length - 1
                ? 'fast'
                : 'medium',
        estimatedWords: Math.max(500, Math.round(1800 / config.nodes.length)),
        notes: `对应 NarrativeNode：${nodeKey}；保留证据、关系与选择后果。`,
      }
    })
    const detail = {
      outlineNodeId: node.id,
      scenes,
      openingHook:
        order === 0
          ? '午夜潮声没有按时抵达，林澈先听见了铜灯里不属于风的第二次震动。'
          : `承接上一章结果进入${config.location}，先展示已获得证据带来的现实变化。`,
      endingCliffhanger:
        order === CHAPTER_CONFIGS.length - 1
          ? '雾散以前，城市终于开始用自己的声音记录选择。'
          : CHAPTER_CONFIGS[order + 1].summary,
      sceneLocation: config.location,
      appearingCharacterIds: characterIds,
      foreshadowIds,
      emotionArc: config.emotionArc,
      prohibitions: ['不新增无来源解法', '不抹去已确认的证据', '不让角色为推进情节突然降智'],
      lastUsedSummary: config.summary,
    }
    const existing = existingDetails.find((item) => item.outlineNodeId === node.id)
    if (!existing?.id)
      await adopt({
        projectId: scope.projectId,
        scope,
        target: 'detailedOutlines',
        mode: 'add',
        data: detail,
      })
    else if (
      !Array.isArray(existing.scenes) ||
      existing.scenes.length === 0 ||
      existing.scenes.every((scene) => scene.sceneId.startsWith('mist-roadshow-'))
    ) {
      await adopt({
        projectId: scope.projectId,
        scope,
        target: 'detailedOutlines',
        recordId: existing.id,
        mode: 'replace',
        data: detail,
      })
    }
  }
}

/** Installs a separate authored world atomically; never changes the user's active workspace. */
export async function createMistHarborWorld() {
  const uid = 'WS-7a0b2b8b-b950-524f-8246-d840b07e2caa'
  const existing = await db.projects.filter((row) => row.workspaceUid === uid).first()
  const scope = existing
    ? await resolveWorkspaceScope(existing.id!)
    : await db.transaction(
        'rw',
        PROJECT_TABLES.map((spec) => spec.table),
        async () => {
          const created = await createWorkspace(
            {
              workspaceUid: uid,
              name: '雾港：失潮钟声',
              genres: ['fantasy'],
              status: 'drafting',
              targetWordCount: 10000,
              description: '失潮之夜，守灯人林澈调查正在吞噬姓名的潮汐钟。',
              enableMultiWorld: false,
            },
            { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' },
          )
          const characters = await ensureCharacters(created.scope)
          await ensureWorldAssets(created.scope, characters)
          await ensureSingletons(created.scope)
          await ensureAuthoringStructure(created.scope, characters)
          return created.scope
        },
      )
  const frozen = await db.worldReleases.where('worldId').equals(scope.worldId).first()
  if (frozen) return { scope, worldReleaseId: frozen.id! }
  const revision = await createWorldRevision({ scope, label: '雾港原稿 · 内置作品 v1' })
  const release = await publishWorldRevision(revision.id!)
  return { scope, worldReleaseId: release.id! }
}
