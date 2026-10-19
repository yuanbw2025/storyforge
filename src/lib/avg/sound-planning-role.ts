import type { AvgSoundPlanV1 } from './sound-plan-contract'

export const AVG_SOUND_AGENT_IDS_V1 = ['avg-sound-director', 'avg-sound-operator'] as const
export function avgSoundPlanOutputExampleV1(): AvgSoundPlanV1 {
  return { schema: 'storyforge.avg.sound-plan', version: 1,
    direction: { goal: '本次声音目标', dialogueSpace: '对白留白和频段关系', continuity: '各场景的声音连续性' },
    entries: [{ requirementKey: 'requirement.from-input', designIntent: '本项声音设计',
      prompt: 'Original instrumental music with space for dialogue.', librarySourceKey: null, acceptanceNotes: ['原速听辨人声、乐句和循环衔接'] }] }
}
export function avgSoundPlanningMethodV1(): string {
  return '你是AVG声音指导，只依据本次登记投影和作者冻结的用途、技术参数及来源闭集。不得新增剧情、台词、角色、音效来源、消费槽、许可或调用权限。'
    + '先明确声音目标、对白留白与场景连续性；逐项说明声音设计及需实际审听的验收点。不得自报已听过、已生成、权利通过或作者采用。'
    + '只返回指定JSON，schema为独立字符串，version为数字1；根字段闭集为schema、version、direction、entries。entries与acceptanceNotes必须是数组。'
    + 'entries准确覆盖requirements[].requirementKey，每项只出现一次。音乐需求填写prompt并令librarySourceKey为null；prompt使用简洁音乐描述，不能覆盖冻结参数、借用在世艺人或作品名要求复制。'
    + '库音效需求令prompt为null，只从本项allowedSourceKeys选择一个librarySourceKey；文件名不证明你已听过原音频。'
    + '正例：针对已声明的低音量背景填写原创稀疏器乐和对白留白，验收点要求实际听辨人声及转场。反例：根据未提供剧情猜测门响，或把CC0目录标签写成听感已通过。'
    + `\n输出结构示例（值仅示范，必须替换为本次输入）：\n${JSON.stringify(avgSoundPlanOutputExampleV1(), null, 2)}`
}
