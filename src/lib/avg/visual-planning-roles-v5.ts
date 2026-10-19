import { AVG_VISUAL_PLANNING_ROLES_V1,avgVisualPlanningMethodV1 } from './visual-planning-roles'
import type { AvgVisualDesignKindV1 } from './visual-planning-contract'

export const AVG_VISUAL_PLANNING_CONTEXT_V5='product-production.avg-visual-planning-inputs-v5'
export const AVG_VISUAL_PLANNING_ROLES_V5=AVG_VISUAL_PLANNING_ROLES_V1.map(role=>({...role,skillId:role.skillId.replace(/\.v1$/,'.v2')}))
export const avgVisualPlanningRoleV5=(kind:AvgVisualDesignKindV1|null)=>AVG_VISUAL_PLANNING_ROLES_V5.find(role=>role.subjectKind===kind)!

/** Canonical semantic outputs remain V1. This distinct method freezes the new
 * reference policy; an old sealed request keeps its original method bytes. */
export function avgVisualPlanningMethodV5(kind:AvgVisualDesignKindV1|null):string{
  return `${avgVisualPlanningMethodV1(kind)}\n本次每张参考的 permittedFeatures 是唯一允许取用的可见特征，excludedFeatures 必须逐项排除；allowedChange 只说明本次允许变化，不能扩大取用范围。不能因为参考图上有道具、文字、光源或其他主体就复制它们。参考仅披露经系统核验的文字声明，你没有看过原图，不得声称已经观察或通过身份/连续性评审。把本用途所需的允许特征转成具体画面约束，把排除项保留到禁画约束；参考策略、主体、家族变体、消费槽和要求冲突时不得自行改约束。family 只标明冻结的主体/家族/变体，不能创造新变体或替换其他主体。`
}
