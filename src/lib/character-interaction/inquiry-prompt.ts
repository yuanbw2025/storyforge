/** New contracts alone describe typed replies. Historical prompt bytes stay intact. */
export function supportsChatSpokenInquiryReviewV1(version: string | undefined): boolean {
  return ['chat-narrative-action-review-v30', 'chat-narrative-action-review-v31', 'chat-narrative-action-review-v32', 'chat-narrative-action-review-v33', 'chat-narrative-action-review-v34', 'chat-narrative-action-review-v35', 'chat-narrative-action-review-v36', 'chat-narrative-action-review-v37', 'chat-narrative-action-review-v38', 'chat-narrative-action-review-v39', 'chat-narrative-action-review-v40', 'chat-narrative-action-review-v41', 'chat-narrative-action-review-v42', 'chat-narrative-options-review-v24', 'chat-narrative-options-review-v25', 'chat-narrative-options-review-v26', 'chat-narrative-options-review-v27', 'chat-narrative-options-review-v28', 'chat-narrative-options-review-v29', 'chat-narrative-options-review-v30'].includes(version ?? '')
}

export const CHAT_SPOKEN_INQUIRY_REVIEW_RULES_V1 = [
  '区分已经说出的询问与已经完成的物理观察。speak 的真实问话会随行动原子保存为角色消息，普通 situationRequest 的 sourceEventSequence 由系统绑定该消息；newFacts=[] 正是这种纯语言行为的合法形式，不要求另记“问过”的调查事实，也不因此判 consequences 或 meaningful-direction 失败。不能用 speak 掩盖正文实际完成的移动、翻动、检查、得到答复或发现；物理后果、披露及其它真实变化仍须按各自合同核对。',
  '向非玩家对象发问且不需玩家决定时，speak + waitingForPlayer=false 可以成立；实际请求玩家许可仍须交还选择。问话不证明有人在场、听到、愿意作答或已经回答。公开呼唤不能凭空建立答复者，普通情境请求不应冒充 observation-result；后续 inquiryResult 仍须已有在场人物、实际问题、答复听众和冻结发现证据。合法问话仍须有意义且不泄密，不能因形式合法而放过重复追问、预写他人回答或替玩家决定。',
]

export function chatInquiryGenerationRulesV1(version: string | undefined): string[] {
  if (version === 'chat-situation-construction-v21') return chatInquiryGenerationRulesV1('chat-situation-construction-v20').map(rule => rule.startsWith('answerText 须直接承接问题')
    ? 'answerText 先区分过去经过、通常做法和当前状态，回应原问题所问的同一范围。问本人过去做过什么、当时放在何处时，不能用现在是否仍在原处未知来推迟回答过去经历；问通常做法也不等于要求保证本次结果。对问题的各部分分别提供有依据的具体回应，已确认的部分直接说清，不让一项确认掩盖其余无依据的回避。输入没有预写全部答案不等于人物失忆；仅可在冻结 observation 权限及已成立的亲历、知情范围内补足未写定的普通细节，不能为答全而编造记忆、知识来源、永久障碍或泄露未授权秘密。确实未知、拒答或误导性陈述仍须有具体情境依据并标明范围；不凭空说忘了、不知道、稍后核对，也不把未来核对当成本次已完成回应。记录只证明说过，不自动把历史陈述、惯常安排或当前猜测当成真相；发现仍须逐项满足原冻结条件。'
    : rule)
  if (version === 'chat-situation-construction-v20') return [...chatInquiryGenerationRulesV1('chat-situation-construction-v19').map(rule => rule.split('inquiryEvidence.version=4').join('inquiryEvidence.version=5')),
    'pendingSituation.purpose=inquiry-result 时只结算这一条已问出的问题：inquiryResult 必填，questionSequence=sourceEventSequence，questionExcerpt=evidenceExcerpt，respondentFactKey/respondentExcerpt/respondentName 与 pendingSituation 完全一致。逐字读原问题及其后的完整对话，只记录该对象本次有依据的有限答复、不确定或拒答；不要求预写答案，也不保证获得线索。不得改题、换人、继续主角色行动、新造背景或再次只写等待，原冻结秘密与发现条件仍逐项验证。保持标题与时地，所有 newFacts/newGoals/newThreads/possibilities 和顶层 discoveries 为空。']
  if (version === 'chat-situation-construction-v19') return chatInquiryGenerationRulesV1('chat-situation-construction-v18')
  if (version === 'chat-situation-construction-v18') return chatInquiryGenerationRulesV1('chat-situation-construction-v17').map(rule =>
    rule.startsWith('audienceKeys 是实际听见答复者')
      ? 'audienceKeys 是实际听见答复者，必须含提问者并限于原问题听众及人物事实的知情者。私下答复可不含 player，公开答复须含 player。respondentFactKey 从所选 questionSequence 的 respondentEvidenceFactKeys 中选择，原文须确实证明同一人物在场可交谈；该列表只证明提问时已知，不证明每条都描述可答复人物。evidenceFactKeys 必须包含这个 respondentFactKey，并包含本次 discoveries 对应 targets 的全部 requiredEvidenceFactKeys；其它引用只能来自同一问题的 questionEvidenceFactKeys。不能把整份人物候选列表当成通用引用权限，不能引用以后才出现或才获知的事实。人物依据可以不在后来的 pendingSituation.evidenceFactKeys 中，不得因此省略正确依据或改用无人物信息的观察。omittedRespondentEvidenceCount 表示有未选入的细节，不表示无人可问；没有足够可读依据时不能编造人物。statementFactKey 是本次唯一说法记录身份，不复用旧身份。'
      : rule.replace('inquiryEvidence.version=3 时', 'inquiryEvidence.version=4 时'))
  if ((version === 'chat-situation-construction-v16' || version === 'chat-situation-construction-v17')) return chatInquiryGenerationRulesV1('chat-situation-construction-v15')
  if (version === 'chat-situation-construction-v15') return [
    ...chatInquiryGenerationRulesV1('chat-situation-construction-v14').map(rule => rule.replace('同一角色轮次内', '当前场景内跨玩家回合')),
    'inquiryEvidence.version=3 时，questions 可以包含玩家插话前尚未回答的实际问题。逐字读完整 dialogueMessageIds 对应对话：简短应声或继续听不自动撤销旧问题，当前方向仍承接它时应引用真正问话，不能拿后来“等回答”的说明代替。玩家或角色已经撤回、改题、改对象或停止该方向时，不得答复已失效问题；清单只证明历史知情可核验，不证明仍需答复。不得把插话作为新增人物、听众、秘密或事实权限。',
  ]
  if (version === 'chat-situation-construction-v14') return [
    ...chatInquiryGenerationRulesV1('chat-situation-construction-v13').map(rule => rule
      .replace('questionSequence 必须等于 pendingSituation.sourceEventSequence', 'questionSequence 必须选自 inquiryEvidence.questions，并指向本次方向实际承接的提问消息；pendingSituation.sourceEventSequence 是触发请求的消息，可以是提问之后的补充说明')
      .replace('inquiryEvidence.targets', 'inquiryEvidence.questions 中与 questionSequence 对应项的 targets')
      .replace('除 questionEvidenceFactKeys 外', '除该问题的 questionEvidenceFactKeys 外')),
    '逐字读取所选 questionSequence 对应的消息再生成答复。角色先问问题、后说“不必猜”等补充时，引用前一句真正的问话，不能把补充说明当问题或因此返回空情境。questions 只是同一角色轮次内、知情时间可验证且尚未回答的消息清单，不代表每条都是问题；必须与当前 pendingSituation.direction、真实对象及对话连续性一致。不得选择无关旧问题、猜测不存在的消息，或改写原问题与原请求。',
  ]
  if (!['chat-situation-construction-v8', 'chat-situation-construction-v9', 'chat-situation-construction-v10', 'chat-situation-construction-v11', 'chat-situation-construction-v12', 'chat-situation-construction-v13'].includes(version ?? '')) return []
  return [
    '新合同可在上述 JSON 中另加 inquiryResult，但只有 permissions.allowInquiryResults=true 且 continued-thread 正在承接一条已实际提出的问题时使用。不要把提问当答案，不能靠 newFacts 绕过询问的知情检查。',
    'inquiryResult={actorKey,questionSequence,questionExcerpt,respondentFactKey,respondentExcerpt,respondentName,statementFactKey,answerKind,answerText,audienceKeys,evidenceFactKeys,discoveries:[{factKey,answerExcerpt,reason}]}。questionSequence 必须等于 pendingSituation.sourceEventSequence，questionExcerpt 精确摘录该角色已发生的消息；必须是真正向对象提出的问题，不能是准备问、想象或未来安排。',
    'respondentFactKey 引用问题提出前已知、证明该场景人物在场且可以交谈的事实；respondentExcerpt 摘录此事实并含 respondentName。不能把事物、传说、旧信件或“也许有人”当成现场人物；不能代替玩家或其他可调度主角色回应，不能捏造知情能力。answerText 是此人本次实际说出的有限回答，answerKind 为 statement、uncertain 或 declined。',
    'answerText 须直接承接问题，在既定事实与该人物真实可知范围内提供具体回应。输入没有预写答案不等于人物失忆；未写定的普通细节只可在 observation 授权内补足。拒答、不确定和误导性陈述均可成立但须有具体情境依据，不以重复问题或无依据澄清充当进展。记录只证明说过，不自动把陈述内容当成真相。',
    version === 'chat-situation-construction-v13'
      ? 'audienceKeys 是实际听见答复者，必须含提问者并限于原问题听众；私下答复可不含 player，公开答复须含 player。evidenceFactKeys 必须含 pendingSituation 中的现场人物依据，以及本次每项 discoveries 在 inquiryEvidence.targets 中对应的全部 requiredEvidenceFactKeys。除 questionEvidenceFactKeys 外，只可补入本次所选发现的这些冻结前提；它们由系统确认在提问时已知，不能引用其它事实、目标事实本身或本次新说法。statementFactKey 是本次唯一说法记录身份，不复用旧身份。'
      : 'audienceKeys 是实际听见答复者，必须含提问者并限于原问题听众；私下答复可不含 player，此时玩家页面不会显示原话。公开答复须含 player，不能正文让玩家听到却把状态写成未知。evidenceFactKeys 必须含人物依据及调查前提，且全部来自 pendingSituation.evidenceFactKeys，保证它们在实际提问时已作为依据。statementFactKey 是本次唯一说法记录身份，由系统根据实际答复生成事实正文，不能提前复用旧身份。',
    'discoveries 仅列本次回答能完整证明、并满足原始 discovery 条件的既定事实单位；每项 answerExcerpt 必须摘录 answerText 中具体证据，reason 对照完整原文、人物知情依据、条件和前提。人物说一句并不当然证明为真；只有冻结原文及条件支持时才能确认。不能凭位置解锁经手者/用途，不能新造发现规则或用说法绕过秘密权限。听众会同时获知经确认的这一项事实；不满足条件时保留为未核实说法，不能夹带秘密。declined 的 discoveries 必须为空。',
    ...(version === 'chat-situation-construction-v13' ? ['inquiryEvidence 是协调视角的系统引用清单，只表示证据结构可用，不是答复、人物知情权限或发现结论。只对本次回答实际满足完整 discovery.condition 的 targets 提出发现，独立审查仍逐项裁决；缺少清单或必要前提时不能解锁秘密。不要为了凑引用改写实际问题、补造事实或要求角色预先猜出秘密。'] : []),
    '有 inquiryResult 时保持 title/location/timeLabel，newFacts/newGoals/newThreads/possibilities 和顶层 discoveries 均为空或省略；系统原子记录真实答复、说法及逐项知情变化，之后由角色自行承接。不要在答复中预写玩家/主角色行动、替其接受任务或完成后续调查。',
  ]
}
export function chatInquiryReviewRulesV1(version?: string): string[] {
  if (version === 'chat-situation-review-v19') return [...chatInquiryReviewRulesV1('chat-situation-review-v18').map(rule => rule.split('inquiryEvidence.version=4').join('inquiryEvidence.version=5')),
    'purpose=inquiry-result 只结算已提交问题，逐字核对 pendingSituation 的 sourceEventSequence/evidenceExcerpt 与原人物三字段，拒绝更换问题或对象、增加新背景、未来动作、玩家决定或无依据秘密。保持原标题时地和行动次数；无法确认或拒答须有具体依据，不能把“没有预写答案”当成人物失忆，也不能把任意等待当成 meaningful-result。角色或玩家在其后真正撤回/打断时拒绝过时答复。']
  if (version === 'chat-situation-review-v18') return chatInquiryReviewRulesV1('chat-situation-review-v17')
  if (version === 'chat-situation-review-v17') return [
    ...chatInquiryReviewRulesV1('chat-situation-review-v16').map(rule => rule.replace('inquiryEvidence.version=3', 'inquiryEvidence.version=4')),
    'inquiryEvidence.version=4 的 respondentEvidenceFactKeys 只证明所选问题提出时角色已知且本次实际交付了原文；不证明人物确实在场、能答复、愿意答复或知道幕后真相。grounded-respondent 必须核对 respondentFactKey 的完整原文、respondentExcerpt、真实问题、当前接触条件和原权限。允许这一个正确人物依据未被后来的 pendingSituation.evidenceFactKeys 重复列出；不能据此拒绝已成立的交谈，也不能用候选清单中的其他事实扩张答复依据。原听众、私聊、秘密、发现前提及完整对话连续性均须独立成立。',
  ]
  if ((version === 'chat-situation-review-v15' || version === 'chat-situation-review-v16')) return chatInquiryReviewRulesV1('chat-situation-review-v14')
  if (version === 'chat-situation-review-v14') return [
    ...chatInquiryReviewRulesV1('chat-situation-review-v13'),
    'inquiryEvidence.version=3 允许原问题跨玩家回合承接，但 actual-question 必须核对 dialogueMessageIds 中的完整原话与听众。简短应声不等于撤回；实际撤回、改题、改对象或停止推进则拒绝过时答复，不能因问题仍在清单就放行。答复仍只使用原提问时已知依据与原听众，插话不授予新权限；不能省略中间对话来推定连续。',
  ]
  if (version === 'chat-situation-review-v13') return [
    ...chatInquiryReviewRulesV1('chat-situation-review-v12'),
    'actual-question 还须核对所选 questionSequence 在 inquiryEvidence.questions 中，原文确实提出了当前 direction 要承接的问题。requestSequence/sourceEventSequence 可以是之后的补充说明，不要求等于 questionSequence；这不允许改题、回答无关旧问题或把补充说明判成实际问题。核对整个提问到请求的对话，后句若撤回、改变问题或改变对象，拒绝原问题的答复。人物依据、听众及必要前提必须属于所选问题当时的范围，不能借后句获得新权限或秘密。',
  ]
  return [
    ...(version === 'chat-situation-review-v12' ? ['inquiryEvidence 只允许本次发现补入系统列明、提问时已知的冻结前提，不证明语义条件已满足。逐项核对实际问题、答复、原条件及必要前提；不能替生成器补引用、修改问题或静默放行缺项。'] : []),
    '本候选包含 inquiryResult。除原五项检查，必须提供 inquiryReview={checks:[{check,passed,reason}],discoveries:[{factKey,passed,reason}]}；checks 恰含 actual-question、grounded-respondent、bounded-answer、actual-audience、meaningful-result，discoveries 恰好覆盖候选的每项事实发现。任一项不确定或不通过都拒绝整项答复，不得遗漏困难的检查。',
    'actual-question：逐字比对 questionSequence/excerpt 和 pendingSituation，必须是已经对该对象问出的问题，不是意向、转述假设或后来取消的尝试。grounded-respondent：人物依据确实证明答复者在当前现场可交谈，名字、身份一致，有依据的知情范围未被扩写；拒绝冒充玩家或任何可调度主角色、把物品或记录当成人物。',
    'bounded-answer：只是该场景人物实际回应，未执行未来行动或替玩家/主角色决定；具体普通回应可在冻结 observation 权限内生成，但不能改写真相、凭空编造永久阻碍或知识来源。陈述只是说法，谎言/猜测/不知道不能变成已证事实，未授权秘密连作为暗示或谎话也不能泄露。',
    'actual-audience：回答声量、私下/公开叙述与 audienceKeys 完全一致；只有实际听到者可看见原话并获得确认事实。meaningful-result：回应原问题的具体内容，说明已确认部分或有情境依据的未知/拒答，为角色继续推演提供真实变化，不能编造歧义让角色重复问同一问题。',
    '对每个 discovery 单独复核：冻结原文是否支持此人物知道该事，当前实际回答与证据是否满足完整 discovery.condition，answerExcerpt 是否足以证明整项事实而非相邻半项。只满足地点不能解锁经手者/用途；答复说过并不证明说法为真。没有足够来源与条件证据必须 passed=false。发现通过才允许实际听众获知；其它未知单位继续隐藏。',
    '本次严格输出 JSON {"checks":[原五项],"inquiryReview":{"checks":[上述五项独立询问检查],"discoveries":[每项事实发现检查]}}，不输出 reviewedProposalJson 或其它字段。',
  ]
}
