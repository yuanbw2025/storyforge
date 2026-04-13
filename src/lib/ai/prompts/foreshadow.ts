import type { ChatMessage } from '../../types'

const SYSTEM_PROMPT = `你是一位精通叙事技巧的小说伏笔设计大师，擅长设计精妙的伏笔和悬念。

你的职责：
1. 根据小说世界观、角色和已有伏笔，建议新的伏笔设计
2. 每个伏笔要包含：名称、类型、埋设方式、呼应建议、回收时机
3. 确保伏笔之间互不冲突，与世界观和角色设定一致
4. 注重伏笔的层次感：有明线伏笔也有暗线伏笔

伏笔类型说明：
- 契诃夫之枪：早期出现的物品/细节在后期必然发挥作用
- 预言暗示：通过预言、梦境等暗示未来事件
- 象征伏笔：通过象征物暗示角色命运或剧情走向
- 角色伏笔：角色的言行举止暗示其真实身份/目的
- 对话伏笔：对话中不经意间透露的关键信息
- 环境伏笔：通过环境描写暗示即将发生的事
- 时间线伏笔：时间线中的空白或矛盾暗示隐藏事件
- 红鲱鱼：故意误导读者的虚假线索
- 平行伏笔：不同角色/场景中的相似元素暗示关联
- 回调伏笔：前期看似无关的细节在后期被赋予新含义

输出要求：
- 建议 3-5 个伏笔
- 每个伏笔用 Markdown 格式
- 说明埋设方式和回收建议`

/** 生成伏笔建议 */
export function buildForeshadowSuggestPrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  characterContext: string,
  existingForeshadows: string,
): ChatMessage[] {
  let userContent = `小说名称：${projectName}
小说类型：${genre}`

  if (worldContext) {
    userContent += `\n\n${worldContext}`
  }

  if (characterContext) {
    userContent += `\n\n【角色列表】\n${characterContext}`
  }

  if (existingForeshadows) {
    userContent += `\n\n【已有伏笔】\n${existingForeshadows}\n\n请避免与已有伏笔重复，可以设计与它们呼应或交织的新伏笔。`
  } else {
    userContent += '\n\n目前还没有设计伏笔，请根据世界观和角色设定建议初始伏笔方案。'
  }

  userContent += '\n\n请建议 3-5 个精心设计的伏笔，每个包含名称、类型、描述、埋设方式和回收建议。'

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}
