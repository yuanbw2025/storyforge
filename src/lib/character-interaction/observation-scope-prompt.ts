import {CHAT_BOUNDED_OBSERVATION_SITUATION_RULE_V1} from './bounded-observation-prompt'
/** Observation settlement follows the action actually committed. These rules
 * clarify semantic scope; structural guards and frozen discovery remain final. */
const LEGACY_GENERATION = [
  '若 pendingSituation.purpose=observation-result，只确认其 sourceEventSequence 已实际完成的观察能得到什么有限结果，不执行新的调查或动作。保持 title/location/timeLabel，newGoals/newThreads/possibilities 均为 []；newFacts 仅 observation，每项必须引用该事件已登记的 runtime-consequence 观察事实，并摘录 direction。仍未知的部分明确保留未知，不捏造箱内内容、他人动机或幕后答案。既定隐情只能按已有 discovery 条件判定。后来的玩家消息不改变已经完成的检查，但不等于接受任何未来行动。',
  '这个步骤负责补足获准观察的结果，不能因为前一步只记了检查动作、没有预写结果，就循环回答“检查未提供结果”。先核对全部既定事实和发现条件；对于尚未写定、位于已完成观察范围内的普通可见细节，可按 observation 创作权限生成有限、具体且不矛盾的私域结果。只说明这次实际看清了什么及其局限，不推断未检查部分、原因、性能保证或整体安全。没有发现明显异常也必须限定于实际检查范围，不能据此排除隐藏事实。',
  '不确定应来自故事中的具体观察限制，例如被遮挡、未打开、只看外表而未测试；结果须指出本次实际能确认的部分和仍缺的条件。既有事实未记录结果或输入没有答案，本身不是故事内的观察限制。不能为了交差编造阻碍或额外调查；既定真相仍走 discovery，不能用普通新观察重写、否定或变相泄漏它。',
]
const LEGACY_REVIEW = [
  'pendingSituation.purpose=observation-result 时仅补完 sourceEventSequence 已完成观察的有限结果：逐项对照同事件 runtime-consequence 事实、实际动作范围和 direction。不得通过结果新增动作、物品、目标、剧情线或打算，保持标题与时地；未知范围继续未知，既定隐情遵守冻结发现条件。玩家后来不参与或换话题不会撤销过去已经完成的观察，也不授权未来行动。',
  '对此类结果，meaningful-direction 必须区分实际不确定与生成空转：不能只因原动作没有写出结果、输入未提供答案，就认定“检查仍无结果”并让角色继续等同一个结果。获准的普通可见细节可由本步骤在已完成观察范围内补足，不必要求角色提前知道；核对全部既定事实，确保没有改写真相、排除未检查范围或借新观察泄漏隐情。具体观察所得或有真实依据的观察限制才是有效结果；没有依据地重复未知、编造阻碍或追加检查不能通过。',
]
const SCOPED_GENERATION = [
  '若 pendingSituation.purpose=observation-result，只结算 sourceEventSequence 已提交消息及同事件 runtime-consequence 观察事实实际完成的范围；direction 解释待核实问题，不能单独授权未做的查看、翻找、移动或测试。保持 title/location/timeLabel，newGoals/newThreads/possibilities 为 []；newFacts 仅 observation，每项引用该观察事实并摘录 direction。后来的玩家消息不撤销过去已完成动作，也不授权未来行动。',
  '先区分本次实际做了什么：只测试能否打开、接触或运行时，具体开合、接触或响应结果本身可以改变后续选择，不要求顺便辨认内部内容、验证性能或发现关键线索。已经明确查阅、辨认或检查内容时，则应给出该范围内具体所得或有故事依据的限制，不能退回只说动作已做或内容仍未知。按实际动作逐项判断，不能仅凭“打开”“查看”等单个词扩大或缩小范围。',
  '对于获准范围内尚未写定的普通可见细节，可生成有限、不矛盾的观察结果，不因前一步未预写答案而循环空转。具体结果和未知边界分开：未观察部分保持未知，无结果也须限定实际范围。不能编造阻碍、追加动作、新人物或物件来交差，不能用普通观察改写、否定或泄露既定隐情；箱内真相、他人动机等已确定但不可知内容仍受原 discovery 条件约束。',
]
const SCOPED_REVIEW = [
  'pendingSituation.purpose=observation-result 仅结算 sourceEventSequence 已提交消息和同事件观察事实实际完成的范围。direction 可说明问题，不能替代未实施的动作。核对保持标题/时地且不新增动作、人物、物品、目标、剧情线或打算；玩家后来拒绝或换话题不撤销已完成观察，也不允许继续其反对的未来动作。秘密仍按冻结发现条件处理。',
  'meaningful-direction 按本次实际检查范围审查：只测试可打开性、接触或运行响应时，具体开合、接触或响应结果可以成立，不能要求额外辨认内部、测试性能或发现线索；已明确查阅或辨认内容时，不能只确认动作完成、无依据重复未知或回避该范围内所得。不能凭单个动词机械判断范围。获准的未定普通可见细节由本步骤补足，已有具体所得可与未查部分未知并存；若以未知替代已经完成的内容检查，需要真实观察限制，输入未提供答案不算限制。拒绝改写真相、泄密、编造阻碍或追加动作，不强求成功。',
]
export function chatObservationScopeGenerationRulesV1(version: string | undefined): string[] {
  if ((version === 'chat-situation-construction-v19' || version === 'chat-situation-construction-v20' || version === 'chat-situation-construction-v21')) return chatObservationScopeGenerationRulesV1('chat-situation-construction-v18')
  if ((version === 'chat-situation-construction-v16' || version === 'chat-situation-construction-v17' || version === 'chat-situation-construction-v18')) return [SCOPED_GENERATION[0].replace('实际完成的范围', '实际实施的有限范围（尝试本身已完成，成功及所得待判定）'), CHAT_BOUNDED_OBSERVATION_SITUATION_RULE_V1, SCOPED_GENERATION[2]]
  return [...(['chat-situation-construction-v10', 'chat-situation-construction-v11', 'chat-situation-construction-v12', 'chat-situation-construction-v13', 'chat-situation-construction-v14', 'chat-situation-construction-v15', 'chat-situation-construction-v16', 'chat-situation-construction-v17', 'chat-situation-construction-v18'].includes(version ?? '') ? SCOPED_GENERATION : LEGACY_GENERATION)]
}
export function chatObservationScopeReviewRulesV1(version: string | undefined): string[] {
  if ((version === 'chat-situation-review-v18' || version === 'chat-situation-review-v19')) return chatObservationScopeReviewRulesV1('chat-situation-review-v17')
  if ((version === 'chat-situation-review-v15' || version === 'chat-situation-review-v16' || version === 'chat-situation-review-v17')) return [SCOPED_REVIEW[0].replace('实际完成的范围', '实际实施的有限范围（尝试本身已完成，成功及所得待判定）'), CHAT_BOUNDED_OBSERVATION_SITUATION_RULE_V1, SCOPED_REVIEW[1]]
  return [...(['chat-situation-review-v9', 'chat-situation-review-v10', 'chat-situation-review-v11', 'chat-situation-review-v12', 'chat-situation-review-v13', 'chat-situation-review-v14', 'chat-situation-review-v15', 'chat-situation-review-v16', 'chat-situation-review-v17'].includes(version ?? '') ? SCOPED_REVIEW : LEGACY_REVIEW)]
}
