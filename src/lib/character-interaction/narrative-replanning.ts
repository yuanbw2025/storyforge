import type {ChatNarrativeActionV1} from '../types/chat-narrative'

/** New instructions clarify existing, deterministic goal and situation APIs.
 * Never retrofit them into a saved producer, review, or expression-only repair. */
export function supportsChatReplanningPromptV1(version: string | undefined): boolean {
  return ['chat-narrative-action-v36', 'chat-narrative-action-v37', 'chat-narrative-action-v38', 'chat-narrative-action-v39', 'chat-narrative-action-v40', 'chat-narrative-action-v41', 'chat-narrative-action-v42', 'chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v26', 'chat-narrative-options-v27', 'chat-narrative-options-v28', 'chat-narrative-options-v29', 'chat-narrative-options-v30', 'chat-narrative-options-v31', 'chat-narrative-options-v32', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')
}
export function supportsChatReplanningReviewV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}

export const CHAT_REPLANNING_ACTION_RULES_V1 = [
  '原目标未完成时，先区分目标、已经试过的办法、实际所得与尚未知的条件，再选本轮行动。一次局部检查无结果，只排除实际看清的范围；一种办法受阻，不等于整个目标都无法继续。结合人物愿望与最近几轮，考虑不同证据来源、沟通或核实可接触条件，不无限细分同类检查，也不把谨慎反复说成进展。',
  '已有事实足以做自己的下一步，就直接做；真正缺少局部可行动条件时，可沿原目标和原剧情线提出有依据的 situationRequest，核实可用办法或可接触对象。请求可以保留“是否”的不确定性，不要求先知道答案才请求背景；但不得预定新人物在场、愿意回答、掌握线索、玩家参与或成功。不能从幕后答案倒推调查位置，不能把新事实、时间变化或许可写进请求当作既成事实。',
  '若原目标只是自己暂缓、没有 playerPause，而本轮依据支持换一种办法，可保留原 goalKey，用 goalStatus=active 和实际表达一起恢复；需要局部情境时可在同条行动附上 situationRequest。无需新建相同目标或填 resumeGoal。原阻碍没有因此消失：新办法须独立于仍存在的阻碍，原事实、检查结果、承诺和玩家选择全部保留。',
  '有 playerPause 时严格沿原 resumeGoal 授权恢复；明确休息、停止或尚待玩家决定的事项不能借重规划绕过。玩家不亲自参与不自动暂停角色自己的任务。continue/return 只给本轮选择机会，不表示玩家同意、时间流逝或外部条件改善。',
  '确有当前依据表明暂无可行办法，或人物有充分理由选择停止时，可以暂停或放弃，不要求每轮找出线索或达成目标。说明具体受阻范围与仍未完成的部分；需要等待的条件只能来自已有依据，不能虚构。对比最近几轮：若只是重述相同顾虑和未知范围，没有新的理由、信息、选择或后果，不把它包装成有意义推进，也不凭空制造危机来填空。',
]

/** Consolidate progress and replanning in new producers. Existing versions keep
 * their exact instructions, including the separate v42/v32 progress appendix. */
export const CHAT_REPLANNING_ACTION_RULES_V2 = [
  '选择行动前，对齐角色可见的 facts、investigations.discoveredFactKeys、自身 goals 与最近表达。已经确认的事实保留原文范围、传闻和不确定性；旧 beliefs/possibilities 或目标尚未完成不能把已确认内容退回未知。not-discovered/inconclusive 也不证明对象不存在。区分局部成果与剩余目标：已知位置不等于已经取回，收到答复不等于内容核实，自己知道不等于已告知玩家。',
  '承接实际所得，判断它使原事项中的哪个问题、选择或后果发生变化，再选择剩余的一步。尚未确定最终原因或尚未完成整个目标，不等于没有进展或没有可行方向；一种办法受阻也不等于所有办法都受阻。不重做已经完成的核实，不把同样的顾虑与未知范围反复解释成推进，也不无限细分同类检查。',
  '新的观察、答复或发现可以形成新的具体问题，必要时重新使用已有资料或可接触对象：须由新结果支持，且答案可能改变剩余选择；不能只是再查同一问题，也不能预定一定获得答案。已有条件足以做自己的下一步就实际做；真正缺少局部条件时，沿原目标和剧情线用有依据的 situationRequest 核实。请求可保留“是否”，但不预定人物在场、愿意合作、玩家参与、时间变化、许可或成功；不得从幕后答案倒推办法。',
  '玩家拒绝或尚未决定一种办法时，保留已有成果与真实拒绝范围；考虑不依赖该许可的行动、自己愿意给出的真实信息、必要且不重复的边界澄清或有依据的暂停。披露只走 disclosures 且限自己真实知道的部分，不自动公开隐情。不能换个说法重复索取同一决定，也不能把继续倾听当成参与或许可；仍须玩家决定的动作必须等待。',
  '可以因真实限制或人物有充分依据的自主选择而暂停、放弃或自然收束，不要求穷尽每个假想办法。停下时如实表达具体理由和仍未完成的部分：是选择暂不继续，还是哪些现有条件使行动不可行，不能混为一谈。不能仅从最终答案未知推断无路可走，也不能编造资料已穷尽、疲劳、时间或资源限制来解释停止；不为维持剧情而强造线索、矛盾或危机。',
  '原目标仅由自己暂缓且没有 playerPause 时，有实际新方向可沿原 goalKey 用 goalStatus=active 恢复，并按原权限请求局部情境；无需复制目标或填写 resumeGoal。原阻碍、结果、承诺和玩家边界保留。有 playerPause 时严格按 resumeGoal 的真实授权恢复；玩家不亲自参与不自动暂停角色任务，continue/return 只给行动机会，不代表同意、时间流逝或外部条件改善。',
  '上述区分用于选择本轮行动，不要求在台词中逐条说明规划过程。自然表达人物当下真正要做、要说或选择不做的事，保留必要的不确定性；实际行动、结果和承诺仍按各自合同登记，打算不算完成。',
]

export function chatReplanningActionRulesV1(version: string | undefined, preserveExpression = false): string[] {
  if (!['chat-narrative-action-v43', 'chat-narrative-action-v44', 'chat-narrative-action-v45', 'chat-narrative-action-v46', 'chat-narrative-action-v47', 'chat-narrative-action-v48', 'chat-narrative-action-v50', 'chat-narrative-action-v51', 'chat-narrative-action-v52', 'chat-narrative-action-v53', 'chat-narrative-action-v54', 'chat-narrative-action-v55', 'chat-narrative-action-v56', 'chat-narrative-action-v57', 'chat-narrative-action-v58', 'chat-narrative-action-v59', 'chat-narrative-action-v60', 'chat-narrative-action-v61', 'chat-narrative-action-v62', 'chat-narrative-action-v63', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-action-v68', 'chat-narrative-action-v69', 'chat-narrative-action-v70', 'chat-narrative-action-v71', 'chat-narrative-action-v72', 'chat-narrative-options-v33', 'chat-narrative-options-v34', 'chat-narrative-options-v35', 'chat-narrative-options-v36', 'chat-narrative-options-v37', 'chat-narrative-options-v38', 'chat-narrative-options-v39', 'chat-narrative-options-v40', 'chat-narrative-options-v41', 'chat-narrative-options-v42'].includes(version ?? '')) return CHAT_REPLANNING_ACTION_RULES_V1
  return preserveExpression ? [] : CHAT_REPLANNING_ACTION_RULES_V2
}
export const CHAT_REPLANNING_REVIEW_RULES_V1 = [
  'meaningful-direction 须对照原目标、已经提交的观察/调查结果、现有打算和最近几轮表达，判断本次是在推进原事项、合理改变办法、回应玩家，还是只是重复。字段合法和未越界不足以证明有意义；连续重述同一顾虑、等待或未知范围而无新理由/信息/选择/后果，不能只因语气自然判通过。玩家明确要求休息、玩家暂停未解除、当前确有完整阻碍或自然的日常对话仍可合理回应，不要求虚构进展。',
  '暂停审查要区分一种办法受阻与原目标整体暂不可行：局部无结果不能证明所有范围都查完，出门受阻不能自动否定不依赖出门的办法。核对角色动机、当前可知条件与已获准的局部情境请求路径；仍有有依据且不重复的替代方向却无理由退回同一等待时，在 meaningful-direction 说明。没有事实支持的“替代办法”也不能强行要求执行，更不能依据审查者可见的隐情替角色规划或保证一定找到线索。',
  '没有 playerPause 的原目标可在同条行动中 goalStatus=active，再按已有权限请求有限情境；这是原责任换办法，不是新目标或事实。continuity/consequences 核对恢复表达与字段一致，旧阻碍、事实、约定及玩家边界仍在；含 playerPause 时继续严格核对真实解除依据。情境请求只核实尚未知的局部条件，不预定对象、答案或结果；审查理由应结合本次具体证据，不能用“允许暂停”概括替代连续性判断。',
]

/** Only new, frozen review contracts clarify the evaluation of an actual
 * self-pause candidate. This selects instructions; it never decides acceptance
 * or supplies a missing character motive. Old and non-pause requests keep bytes. */
export const CHAT_AUTONOMOUS_PAUSE_REVIEW_RULES_V1 = [
  '自主暂停须区分人物作出取舍与声称整个目标客观不可行。对没有接受玩家暂停请求的候选，核对本次实际表达、已发生结果及角色已有动机：若有具体依据选择暂不继续，并如实保留尚未完成的部分，不能仅因还有未尝试的办法就否决，也不要求穷尽每个假想办法。必须是本次文字已表达的有意义选择，不能由审查者替候选补写顾虑、虚构代价或承诺以后必定继续；仅复述同一顾虑、等待或未知范围而无新理由、信息、选择或后果仍须拒绝。',
  '若候选声称没有可行办法、所有范围都查完或整个目标受阻，仍须有支持这一范围的事实；一种办法无结果不能证明其它办法都不可行。否决自主暂停时，应指出候选实际缺失的依据、被忽略的现有责任或具体矛盾，不能只凭允许请求局部情境就要求无限寻找新人物、资料或途径。提出替代方向须有角色当前可知且不重复的依据，不预定他人、线索或成功，不依据审查者可见的隐情规划。玩家拒绝、明确休息、待决许可与原暂停/恢复合同仍严格保持；个人选择暂缓不解决共同事项，也不代替其他候选逐条审查。',
]

export function chatReplanningReviewRulesV1(version: string | undefined, actions: readonly ChatNarrativeActionV1[]): string[] {
  const autonomousPause = actions.some(action => !action.pauseGoal && !action.threadFollowupGoal?.pauseRequest
    && (action.kind === 'pause' || action.goalStatus === 'paused' || action.goalUpdates?.some(goal => goal.status === 'paused')))
  if (!['chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '') || !autonomousPause)
    return CHAT_REPLANNING_REVIEW_RULES_V1
  return [CHAT_REPLANNING_REVIEW_RULES_V1[0], ...CHAT_AUTONOMOUS_PAUSE_REVIEW_RULES_V1, CHAT_REPLANNING_REVIEW_RULES_V1[2]]
}

/** Interpret the existing actor-visible facts and investigation receipts. This
 * adds no source, inferred outcome, retry or access to coordinator reasoning.
 * Saved producers and author-preserved expressions keep their original rules. */
export function chatSettledProgressRulesV1(version: string | undefined, preserveExpression = false): string[] {
  if (preserveExpression || !['chat-narrative-action-v42', 'chat-narrative-options-v32'].includes(version ?? '')) return []
  return [
    '选择下一步前，对齐当前已知 facts、investigations.discoveredFactKeys 与自身尚未完成的 goals。discoveredFactKeys 对应的事实文本所明确表达的内容已经确认，不只是待核实的猜想；保留文本本身的限定、传闻或不确定性，不能扩成更多结论。不能仅因人物谨慎、旧 beliefs 或旧 possibilities 仍写着未知，就把已经确认的同一内容退回未知。not-discovered/inconclusive 仍不证明对象不存在。',
    '把原目标中已完成与尚未完成的部分分开：已知位置不等于已经取回，已收到答复不等于答复内容已核实，自己知道不等于已经告知玩家。按实际所得保留进度；目标尚未 fulfilled 不是重做已完成核实的理由。新的 situationRequest 必须针对确实影响剩余行动、当前仍未知的条件；重新检查已确认内容须有角色可知的新矛盾或真实疑点，不能凭空增添识别困难来制造任务。',
    '玩家拒绝一种办法后，承接已完成结果与拒绝范围，再选择剩余可行行动、合理的信息分享、必要的边界澄清或有依据的暂停。已知结果尚未向玩家表达且人物愿意告知时，可以沿 disclosures 只披露自己真实知道的部分；不要求玩家参与，也不自动公开隐情。不能为了换办法重新制造已解决的问题、绕过玩家拒绝或假装完成剩余目标；允许如实说明目前的局部成果与限制，不强造新矛盾。',
  ]
}
