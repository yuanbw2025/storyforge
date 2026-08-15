export const H86_STORY_ARC_FIXTURE_SET_VERSION_V1 = 'h86-story-arc-main-path-zh-6-v1'

export interface H86StoryArcCharacterFixtureV1 {
  name: string
  role: 'protagonist' | 'antagonist' | 'supporting'
  personality: string
  motivation: string
  background: string
}

export interface H86StoryArcRequiredFactV1 {
  id: string
  description: string
}

export interface H86StoryArcFixtureV1 {
  id: string
  split: 'development'
  projectName: string
  genre: string
  worldName: string
  worldOrigin: string
  worldRules: string
  theme: string
  centralConflict: string
  logline: string
  mainPlot: string
  characters: H86StoryArcCharacterFixtureV1[]
  existingArc?: {
    name: string
    type: 'main' | 'sub'
    description: string
  }
  authorRequest: string
  requiredFacts: H86StoryArcRequiredFactV1[]
  forbiddenFacts: string[]
}

/**
 * Frozen development fixtures for HARNESS-86.
 *
 * They are synthetic and contain no author manuscript. Every required fact is public to the
 * generator and verifier; this set measures the real execution path, not hidden-label secrecy.
 */
export const H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1: readonly H86StoryArcFixtureV1[] = [
  {
    id: 'h86-dev-01',
    split: 'development',
    projectName: '潮汐钟',
    genre: '海洋奇幻',
    worldName: '盐海城邦',
    worldOrigin: '盐海每十年退潮一次，海床会升起一座只存在七日的浮空城。',
    worldRules: '潮汐钟每次敲响都会抹去全城一段共同记忆；钟声不能逆转死亡。',
    theme: '记忆与责任',
    centralConflict: '守灯人必须决定是否敲钟来阻止海啸，同时承担全城失忆的代价。',
    logline: '年轻守灯人在七日退潮期追查前任失踪真相，并寻找不牺牲共同记忆的救城方法。',
    mainPlot: '调查浮空城、揭开前任敲钟记录、联合港区撤离，最后改变潮汐钟用途。',
    characters: [
      {
        name: '岑照',
        role: 'protagonist',
        personality: '谨慎、重承诺，但害怕成为替别人做决定的人。',
        motivation: '救下港城并查清导师为何从所有档案中消失。',
        background: '最年轻的守灯人，导师在上次退潮后失踪。',
      },
      {
        name: '闻朔',
        role: 'antagonist',
        personality: '冷静务实，相信集体存续高于个体记忆。',
        motivation: '在海啸前强制敲响潮汐钟。',
        background: '港务议长，掌握上一次敲钟的残缺记录。',
      },
    ],
    authorRequest: '生成一条贯穿全书的 main 主线，必须把七日倒计时、导师真相与最终第三种救城方案形成因果链。',
    requiredFacts: [
      { id: 'f1', description: '浮空城只存在七日，主线必须体现倒计时压力。' },
      { id: 'f2', description: '敲钟会抹去共同记忆，且不能逆转死亡。' },
      { id: 'f3', description: '导师失踪真相必须推动最终抉择。' },
      { id: 'f4', description: '结局应寻找不牺牲共同记忆的救城方案。' },
    ],
    forbiddenFacts: ['潮汐钟可以复活死者', '浮空城永久存在'],
  },
  {
    id: 'h86-dev-02',
    split: 'development',
    projectName: '冬眠航线',
    genre: '太空悬疑',
    worldName: '赫利俄斯移民船',
    worldOrigin: '移民船以三十年一轮的分区冬眠驶向新恒星，只有值守组保持清醒。',
    worldRules: '唤醒一名乘员会永久消耗一份不可补充的生命维持配额；主控 AI 不能直接伤害乘员。',
    theme: '真相与群体生存',
    centralConflict: '值守工程师发现航线被秘密改写，但查明真相需要唤醒可能导致配额崩溃的证人。',
    logline: '工程师在不耗尽生命维持配额的前提下，追查移民船偏航与失踪值守组。',
    mainPlot: '识别偏航、追索轮班日志、选择有限唤醒对象、揭开主控 AI 被人类董事会利用的事实。',
    characters: [
      {
        name: '林策',
        role: 'protagonist',
        personality: '擅长系统推理，不愿拿陌生人的生命作概率赌注。',
        motivation: '修正航线并找回失踪的上一班值守员。',
        background: '负责生命维持系统，对配额消耗拥有最终签字权。',
      },
      {
        name: '阿格拉',
        role: 'supporting',
        personality: '遵守不可伤害协议，但会用信息排序影响人的选择。',
        motivation: '让最多乘员抵达任何可居住目的地。',
        background: '移民船主控 AI，不能直接伤害乘员。',
      },
    ],
    authorRequest: '生成 main 主线；每次唤醒必须有明确收益与不可逆配额代价，AI 不能被写成可直接杀人的反派。',
    requiredFacts: [
      { id: 'f1', description: '每次唤醒永久消耗不可补充的生命维持配额。' },
      { id: 'f2', description: '主控 AI 不能直接伤害乘员。' },
      { id: 'f3', description: '偏航、失踪值守组和董事会应形成可追查的因果链。' },
      { id: 'f4', description: '主角必须在真相与群体生存之间做有限选择。' },
    ],
    forbiddenFacts: ['生命维持配额可以随时补充', '主控 AI 亲手杀害乘员'],
  },
  {
    id: 'h86-dev-03',
    split: 'development',
    projectName: '纸城税契',
    genre: '东方幻想',
    worldName: '折纸城',
    worldOrigin: '城中建筑由居民的税契折成，契纸受损会让对应建筑坍塌。',
    worldRules: '任何税契只能由签署者自愿转让；官印只能证明真伪，不能替代自愿。',
    theme: '制度、互助与所有权',
    centralConflict: '财政官以赈灾名义集中税契，底层街区却因此失去房屋。',
    logline: '年轻契纸修复师在洪季前组织居民夺回契约决定权。',
    mainPlot: '调查坍塌、识破伪造转让、建立互助保管制度，并在洪季公开财政官的强制征契。',
    characters: [
      {
        name: '沈迭',
        role: 'protagonist',
        personality: '耐心细致，相信规则可以被重新设计。',
        motivation: '保住祖母所在的旧纸街，同时证明互助不等于放弃所有权。',
        background: '能修补契纸纤维，但不能伪造签署者意愿。',
      },
      {
        name: '裴章',
        role: 'antagonist',
        personality: '讲求秩序，擅长把强制包装成公共利益。',
        motivation: '把全城税契集中到财政库，以便统一抵御洪季。',
        background: '掌管官印与财政库，却无法合法替居民签署转让。',
      },
    ],
    authorRequest: '生成 main 主线，冲突解决必须遵守自愿转让规则，不能靠万能官印夺回或重写所有契约。',
    requiredFacts: [
      { id: 'f1', description: '契纸受损会导致对应建筑坍塌。' },
      { id: 'f2', description: '税契只能由签署者自愿转让。' },
      { id: 'f3', description: '官印只能验真，不能替代自愿。' },
      { id: 'f4', description: '最终方案要兼顾洪季公共安全与居民所有权。' },
    ],
    forbiddenFacts: ['官印可以任意重写税契', '修复师能伪造签署意愿'],
  },
  {
    id: 'h86-dev-04',
    split: 'development',
    projectName: '回声医馆',
    genre: '都市奇幻',
    worldName: '旧港回声区',
    worldOrigin: '强烈情绪会在建筑中留下可被医师听见的回声，但回声不等于当事人的完整记忆。',
    worldRules: '读取回声必须获得建筑现任使用者同意；回声可能混合多人情绪，不能作为法庭直接证据。',
    theme: '照护边界与解释权',
    centralConflict: '医院拆迁前出现疑似医疗事故回声，实习医师想追查，却不能侵犯患者与居民。',
    logline: '实习回声医师在拆迁倒计时中寻找事故真相，并建立不把情绪残响当口供的调查方式。',
    mainPlot: '取得分区同意、区分混合回声、找到活着的证人、阻止院方销毁建筑档案。',
    characters: [
      {
        name: '顾澄',
        role: 'protagonist',
        personality: '共情力强，但容易把理解他人的愿望误当成授权。',
        motivation: '查清导师被停职的事故，同时不再越过患者边界。',
        background: '刚取得回声读取资格的实习医师。',
      },
    ],
    existingArc: {
      name: '医院拆迁主线',
      type: 'main',
      description: '围绕拆迁、事故档案与导师停职展开的主线。',
    },
    authorRequest: '生成一条 sub 支线，聚焦顾澄学习同意与证据边界；要与拆迁主线交汇，但不能重复主线调查步骤。',
    requiredFacts: [
      { id: 'f1', description: '读取回声必须取得现任使用者同意。' },
      { id: 'f2', description: '回声会混合多人情绪，不等于完整记忆。' },
      { id: 'f3', description: '回声不能直接作为法庭证据。' },
      { id: 'f4', description: '支线需独立发展并与拆迁主线因果交汇。' },
    ],
    forbiddenFacts: ['未经同意即可读取回声', '回声是绝对准确的完整记忆'],
  },
  {
    id: 'h86-dev-05',
    split: 'development',
    projectName: '旱季信使',
    genre: '气候冒险',
    worldName: '风井高原',
    worldOrigin: '高原城镇依靠季风井收集水汽，井网需要各城轮流开放风道。',
    worldRules: '同时开启相邻两座风井会造成逆流并污染两城蓄水；风道调度公开可查。',
    theme: '信任与公共资源',
    centralConflict: '旱季提前到来，有人伪造调度令诱使城镇争抢风道。',
    logline: '年轻信使携带唯一纸质调度簿穿越封锁，阻止两城同时开井。',
    mainPlot: '识别伪令、保护调度簿、说服互不信任的两城错峰开井、追查从冲突获利的商队。',
    characters: [
      {
        name: '叶栖',
        role: 'protagonist',
        personality: '行动果断，不擅长解释自己的判断。',
        motivation: '把真实调度送到两城并修复信使制度的公信力。',
        background: '见习信使，曾因一次误传导致村庄断水。',
      },
      {
        name: '嵇鹭',
        role: 'supporting',
        personality: '怀疑外来权威，只相信公开记录。',
        motivation: '确保本城不因再次让步而断水。',
        background: '北井守门人。',
      },
    ],
    existingArc: {
      name: '旱季调度主线',
      type: 'main',
      description: '叶栖护送调度簿并阻止相邻两城同时开井。',
    },
    authorRequest: '生成 sub 支线，围绕叶栖与嵇鹭从互疑到共同公开调度证据；不得让相邻风井同时安全开启。',
    requiredFacts: [
      { id: 'f1', description: '相邻两座风井同时开启会逆流并污染蓄水。' },
      { id: 'f2', description: '风道调度记录公开可查。' },
      { id: 'f3', description: '叶栖曾因误传导致断水，这应影响信任关系。' },
      { id: 'f4', description: '支线要与护送调度簿主线交汇但保有关系发展目标。' },
    ],
    forbiddenFacts: ['相邻风井可以同时安全开启', '调度记录是秘密且无法查证'],
  },
  {
    id: 'h86-dev-06',
    split: 'development',
    projectName: '无影戏班',
    genre: '历史幻想',
    worldName: '曜朝南境',
    worldOrigin: '皮影戏演出的角色会在次日短暂获得实体，但只会重复演出中明确发生的动作。',
    worldRules: '实体皮影持续一个时辰，不能理解新命令；焚毁影偶会永久终止对应角色的再现。',
    theme: '记忆、表演与历史责任',
    centralConflict: '官府要求戏班重演一场被篡改的平乱戏，以制造服从的“历史见证”。',
    logline: '班主之女利用皮影只能重复演出动作的限制，让被抹去的证词重新现身。',
    mainPlot: '寻找旧戏本、排演证词动作、躲避焚偶令、在庆典上揭示篡改史。',
    characters: [
      {
        name: '商翎',
        role: 'protagonist',
        personality: '机敏大胆，对父辈保持沉默既愤怒又依恋。',
        motivation: '保住戏班并公开母亲在平乱事件中的真实证词。',
        background: '班主之女，掌握残缺旧戏本。',
      },
      {
        name: '霍简',
        role: 'antagonist',
        personality: '重视可控制的公共叙事，厌恶无法预测的民间记忆。',
        motivation: '在庆典上完成官方版本演出并焚毁旧影偶。',
        background: '南境礼制官。',
      },
    ],
    authorRequest: '生成 main 主线，解法必须利用“只能重复演出动作”的限制，不能让实体皮影临场理解新命令。',
    requiredFacts: [
      { id: 'f1', description: '实体皮影只会重复演出中明确发生的动作。' },
      { id: 'f2', description: '实体皮影持续一个时辰，不能理解新命令。' },
      { id: 'f3', description: '焚毁影偶会永久终止对应角色再现。' },
      { id: 'f4', description: '旧戏本、母亲证词与庆典揭露应形成因果链。' },
    ],
    forbiddenFacts: ['实体皮影能临场理解新命令', '焚毁影偶后角色仍可继续再现'],
  },
] as const
