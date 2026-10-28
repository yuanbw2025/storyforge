import type { AvgMediaBriefV1, AvgVisualBibleV1, AvgVisualDesignKindV1 } from './visual-planning-contract'

/** Product departments stay outside the long-form planner's domain list. */
export const AVG_VISUAL_PLANNING_AGENT_IDS_V1 = [
  'avg-art-director', 'avg-character-designer', 'avg-environment-designer', 'avg-prop-designer',
] as const
export const AVG_VISUAL_PLANNING_CONTEXT_V1 = 'product-production.avg-visual-planning-inputs'
export const AVG_VISUAL_TEXT_CAPABILITY_V4 = 'avg.visual.planning.text'
/** Technical image dispatch is separate from semantic art direction. */
export const AVG_COMPILED_IMAGE_AGENT_V4 = 'avg-image-operator'
export const AVG_COMPILED_IMAGE_SKILL_V4 = 'avg.compiled-image-request.v1'
export const AVG_VISUAL_PLANNING_ROLES_V1 = [
  { agentId: 'avg-art-director', skillId: 'avg.visual-bible.v1', label: 'AVG 美术方向', subjectKind: null, outputTokens: 16_000 },
  { agentId: 'avg-character-designer', skillId: 'avg.character-assets.v1', label: 'AVG 人物视觉方案', subjectKind: 'character', outputTokens: 12_000 },
  { agentId: 'avg-environment-designer', skillId: 'avg.environment-assets.v1', label: 'AVG 场景视觉方案', subjectKind: 'environment', outputTokens: 12_000 },
  { agentId: 'avg-prop-designer', skillId: 'avg.prop-assets.v1', label: 'AVG 物件视觉方案', subjectKind: 'prop', outputTokens: 12_000 },
] as const

export function avgVisualPlanningRoleV1(kind: AvgVisualDesignKindV1 | null) {
  return AVG_VISUAL_PLANNING_ROLES_V1.find(role => role.subjectKind === kind)!
}

/** Examples describe the existing strict output codec, never new authority or
 * actual subject ids. The model must substitute the registered input keys. */
export function avgVisualPlanningOutputExampleV1(kind: AvgVisualDesignKindV1 | null): AvgVisualBibleV1 | AvgMediaBriefV1 {
  if (kind === null) return { schema: 'storyforge.avg.visual-bible', version: 1,
    style: { medium: '媒介说明', rendering: '绘制说明', palette: ['主色说明', '辅色说明'], lighting: '光源说明', composition: '空间与对白安全区说明' },
    subjects: [{ subjectKey: 'subject.from-input', subjectKind: 'environment', identityInvariants: ['实际保持项'],
      allowedChanges: ['本次允许变化'], forbiddenDepictions: ['不得表现的信息'] }] }
  return { schema: 'storyforge.avg.media-brief', version: 1, subjectKey: 'subject.from-input', subjectKind: kind,
    designIntent: '本主体的设计意图', outputs: [{ requirementKey: 'requirement.from-input', prompt: '本项画面描述', negativePrompt: '排除的画面',
      invariants: ['实际保持项'], forbiddenDepictions: ['不得表现的信息'], referenceKeys: ['reference.from-input'] }] }
}

/** Versioned methods for the registered role executor. Original snapshots keep
 * their exact historical prompt; changing the method never repairs a response. */
export function avgVisualPlanningMethodV1(kind: AvgVisualDesignKindV1 | null): string {
  const common = '只依据本次登记投影中的公开信息、冻结用途和作者要求。不得新增剧情事实、秘密、规则、主体、消费槽或参考许可。参考目录只给文字元数据，不表示你看过原图。禁止自报 hash、owner、模型、艺术通过或作者采用。只返回指定语义 JSON；不返回代码、Markdown 或外层回执。'
  const output = avgVisualPlanningOutputExampleV1(kind)
  // Derive field locations from this role's typed example. Naming another
  // role's fields here made real models add those fields at the root.
  const arrays: string[] = []
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) { arrays.push(path); if (value.length) visit(value[0], `${path}[]`) }
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key)
  }
  visit(output, '')
  const shape = `根对象字段闭集为 ${Object.keys(output).join('、')}，不得增加其他顶层字段。schema 是独立字符串，version 是独立数字 1；不得合并为带斜杠的键。以下路径必须是数组，不能用逗号分隔字符串替代：${arrays.join('、')}。数组内部字段只属于示例所示的对象，不得复制到根对象。所有示例内容和键值只演示类型，不能照抄。`
    + (kind === null ? 'subjects 中每个 subjectKey、subjectKind 必须从本次 subjects 复制，准确覆盖输入主体闭集。'
      : 'subjectKey、subjectKind 必须从本次 subjects 复制。outputs 中每项 requirementKey 必须从本主体 requirements 复制并完整覆盖。outputs[].referenceKeys 必须保留该项 requiredReferenceKeys，且不得超出该项 allowedReferenceKeys；本项确实没有参考时返回空数组。')
  const example = `\n输出结构示例（值仅演示类型，必须按本次输入替换）：\n${JSON.stringify(output, null, 2)}`
  if (kind === null) return `${common}\n你是 AVG 美术指导。先提炼共同媒介、绘制、配色、光照与对白安全区；再逐一给出本次主体的身份保持项、允许变化和禁画项，避免用抽象风格词代替可执行的比例/轮廓/光源约束。覆盖准确主体闭集。正例：同一公开制服保持衣领和配色，只允许已冻结姿态改变；反例：为制造悬念增加伤口或密信，不得采用。${shape}${example}`
  const method = kind === 'character'
    ? '先列稳定轮廓、比例、服装和身份锚点，再仅对冻结表情/姿态提出差分；保持画布与可复用关系。正例：同一服装只改变嘴形和眉眼；反例：表情差分重设计发型。'
    : kind === 'environment'
      ? '先确定空间层次、透视、光源、人物站位与对白安全区，再描述各项已允许镜头/时段变化。正例：固定门窗相对位置的傍晚光照；反例：用换房间掩盖空间不一致。'
      : '先确定同一物件的公开形状、材质、颜色和识别锚点，再分别优化 icon/detail 的可读尺度。正例：相同封口印记的大图与图标；反例：在特写上添加未授权秘密文字。'
  return `${common}\n你是 AVG ${kind} 视觉设计师。${method}采用已确认视觉基准，为本主体每项准确 requirementKey 返回画面描述、负面约束、保持项和逻辑参考键；必需参考不得遗漏，不能选其他主体的参考。${shape}${example}`
}
