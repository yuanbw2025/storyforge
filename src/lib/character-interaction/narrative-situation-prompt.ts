/** Generation guidance only. Saved producers retain their original text;
 * source authority, discovery conditions and independent review stay unchanged. */
export function chatSituationResponseRulesV1(producerVersion: string | undefined): string[] {
  if ((producerVersion === 'chat-situation-construction-v19' || producerVersion === 'chat-situation-construction-v20' || producerVersion === 'chat-situation-construction-v21')) return chatSituationResponseRulesV1('chat-situation-construction-v18')
  if ((producerVersion === 'chat-situation-construction-v16' || producerVersion === 'chat-situation-construction-v17' || producerVersion === 'chat-situation-construction-v18')) return chatSituationResponseRulesV1('chat-situation-construction-v15')
  if (producerVersion === 'chat-situation-construction-v15') return chatSituationResponseRulesV1('chat-situation-construction-v14')
  if (producerVersion === 'chat-situation-construction-v14') return chatSituationResponseRulesV1('chat-situation-construction-v13')
    .map(rule => rule.replace('sourceEventSequence 的原问题', 'inquiryEvidence.questions 中实际对应当前方向的原问题，以及 sourceEventSequence 的请求或补充说明'))
  if (!['chat-situation-construction-v7', 'chat-situation-construction-v8', 'chat-situation-construction-v9', 'chat-situation-construction-v10', 'chat-situation-construction-v11', 'chat-situation-construction-v12', 'chat-situation-construction-v13', 'chat-situation-construction-v14'].includes(producerVersion ?? '')) return []
  return [
    '若 continued-thread 的已审查方向要求补足一次已经提出的询问之实际回应，先对照 sourceEventSequence 的原问题、已发生对话与交谈条件。问题已经提出，不等于答案已经确定；本步骤应在冻结创作权限内补足当前对象的有限实际回应，不能把“角色未预写答案”当作故事内不知道或不能回答的理由。仅可补足已确立交谈对象的普通局部回应，不能替玩家或其它可调度主角色作答、接受任务、完成后续调查或制定计划。',
    '回应须承接原问题的具体内容，并明确本次可以确认的部分与仍未知的部分。反问只有在原问题确有影响回答的歧义且原对话尚未说明时才有意义；不能给清楚的问题另造时间、范围或用词歧义，让角色重复澄清后继续等待同一答案。拒绝、无法确认或暂缓都可以成立，但必须有当前局面的具体依据，不能为了回避生成结果编造障碍，也不要求每次询问都获得线索或成功。',
    '询问回应仍受全部事实、听众、引用和发现规则约束。普通回应不是释放秘密的新权限：未满足 discovery 条件的真相及其局部含义不能借他人台词、新观察或暗示泄漏，不得为取得进展强造知情者、改写真相或排除未查范围。若当前授权不足以形成某项结果，保留那部分未知；仅在已有依据和权限内形成可承接的局部变化，不把未执行的后续行动写成完成。',
  ]
}
