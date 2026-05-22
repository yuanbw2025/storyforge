import type { PromptVariableContext } from '../types'

/**
 * 实时预览用的样例变量字典。
 *
 * 覆盖 Phase 1 全部 13 条系统模板用到的所有变量。
 * 让用户在编辑模板时能即时看到"如果实战这模板长这样"。
 *
 * 条件块变量（isSummary / hasNoForeshadows）默认空字符串 → 条件块默认隐藏。
 */
export const PREVIEW_VARS: PromptVariableContext = {
  // 项目级
  projectName: '示例小说·剑破苍穹',
  genres: '玄幻',
  description: '一个少年从凡人崛起到天道的故事',
  // 世界观
  worldOrigin: '上古时代，天地未分，鸿蒙紫气化为三清...',
  naturalEnv: '九大灵脉环绕中央昆仑',
  humanityEnv: '九大宗门并立，正魔两道分庭抗礼',
  worldContext: '【世界观摘要】这是一个修真世界，灵气复苏，宗门林立，主角天生异象。',
  existingWorldview: '已有：地理 — 九州大陆；社会 — 宗门制度。',
  // 故事
  storyCore: '【故事核心】少年凡人觉醒上古血脉，对抗宿命，最终问鼎天道。',
  // 角色
  characters: '李逍遥（主角）：性格洒脱，擅长剑术，背负血海深仇。\n沈璃（女主）：清冷孤傲，琴艺超群。',
  existingCharacters: '李逍遥（主角）、沈璃（女主）',
  characterName: '林玄',
  characterInfo: '主角，凡人出身，天生灵根',
  // 创作规则
  rules: '风格：爽文 + 适度装逼；节奏：3 章一小爽 10 章一大爽',
  // 大纲
  volumeTitle: '第一卷 · 山门觉醒',
  volumeSummary: '主角拜入剑宗，初露锋芒，遭遇师门排挤，结交同伴，迎来第一次大战。',
  prevVolumeSummary: '（这是第一卷）',
  targetWordCount: 1000000,
  estimatedVolumes: 4,
  // 章节
  chapterTitle: '第一章 · 山雨欲来',
  chapterSummary: '主角醒来发现自己重生回十年前，决意改变命运。',
  previousChapterEnding: '黑衣人冷笑一声，转身没入夜色。',
  existingContent: '林玄缓缓睁开眼睛，发现窗外的月亮还是十年前的样子。\n他猛地坐起身，胸口剧烈起伏。这不是梦……他真的回来了。',
  // 编辑/润色
  text: '林玄拔剑，剑光闪过，敌人倒下。',
  instruction: '增加画面感和心理描写',
  // 伏笔
  existingForeshadows: '【已有】神秘玉佩 — 在第三章主角无意中得到，回收点未定。',
  hasNoForeshadows: '',
  // 概念地图
  overview: '九州大陆，灵气浓郁，宗门遍布。',
  locationList: '- 昆仑山（mountain）：天下第一灵脉所在\n- 长安城（city）：人族首都\n- 剑宗（faction）：九大宗门之首',
  locationNames: '昆仑山, 长安城, 剑宗, 紫云观, 落霞谷',
  locationTypes: 'mountain, city, faction',
  imageStyle: 'fantasy RPG world map, hand-drawn parchment style',
  // 通用
  dimension: '地理环境',
  userHint: '风格偏向悬疑',
  // 条件标志（默认空，预览不展示对应分支；用户可改样例字典查看分支）
  isSummary: '',
}
