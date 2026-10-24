/** Semantic scope of a performed, finite observation attempt. Structure,
 * permissions, source evidence, discovery and adoption keep their own guards. */
export const CHAT_BOUNDED_OBSERVATION_ACTION_RULE_V1 = '已实际动手进行的有限检查可登记为本次 observation，并用 purpose=observation-result 请求判定结果；记录完成的是这次尝试，不是成功、看见答案或解决目标。正文、事实与请求须一致写清实际动作、对象和停止边界。例如已经借灯试着正常打开并查看同一获准木箱，可请求确认是否打开、正常打开后本次直接看到什么；打不开则止于开合结果，不强拆。仅说打算查看、试试能否打开、等许可再看，不包含实际内容检查。请求不得增加正文未实施的翻找、取物、移动、第二对象、他人行为或未来决定；引用本次观察事实并完整摘录其原文，秘密仍等待冻结发现条件判定。'

export const CHAT_BOUNDED_OBSERVATION_ACTION_REVIEW_RULE_V1 = 'observation-result 专门区分完成一次检查尝试与已经成功：正文和同次 observation 若明确已经动手尝试正常打开并查看同一获准对象，direction 可同时请求开合结果及正常打开时本次直接可见的内容。不能要求角色先断言打开成功或知道内容才允许判定；这不预定成功，也不由结果步骤发起新的选择或动作。若正文仅测试可打开性、表达未来计划、等待玩家许可，或内容查看只出现在 direction，则不能据此结算内容。逐项核对实际动作、对象、获准范围及停止边界；拒绝追加翻找取物、强拆、转移场所、检查第二对象、他人动作或新决定。所有事实引用、秘密发现、玩家自主权与失败否决保持。'

export const CHAT_BOUNDED_OBSERVATION_SITUATION_RULE_V1 = '同一已提交动作若明确实际尝试正常打开并查看获准对象，结算的是这次有限尝试的结果：可正常打开时，只确认本次直接可见且确在原查看范围内的内容；有真实开合或视线阻碍时，只确认实际能观察的部分及限制，不强拆、不翻找、不继续尝试。原文只测试可打开性、只提出计划或等许可时，不包括内容查看；direction 单独增加的动作无效。完整原文决定范围，不能仅凭“尝试”否定已实施检查，也不能仅凭“查看”扩大范围。不得捏造阻碍回避结果，不能保证成功、追加选择、执行未来动作或越过冻结发现条件。'
