import { PRODUCT_RUNTIME_CHECKPOINT_PURPOSES_V1, type ProductRuntimeCheckpointPurposeV1 } from "../types";

const PRODUCT_RUNTIME_CHECKPOINT_SUBJECT_PURPOSES_V1 = new Set<ProductRuntimeCheckpointPurposeV1>([
  "combat-retry",
  "milestone",
]);

/**
 * Normalizes the only legacy checkpoint shape: a missing purpose is `manual`.
 * Product-specific callers still own validation of what an encounter or
 * milestone key refers to; this shared boundary owns the purpose/key pairing.
 */
export function normalizeProductRuntimeCheckpointPurposeV1(input: {
  purpose?: unknown;
  subjectKey?: unknown;
}): {
  purpose: ProductRuntimeCheckpointPurposeV1;
  subjectKey: string | null;
} {
  const rawPurpose = input.purpose;
  const purpose = rawPurpose === undefined
    ? "manual"
    : typeof rawPurpose === "string"
      && PRODUCT_RUNTIME_CHECKPOINT_PURPOSES_V1.includes(
        rawPurpose as ProductRuntimeCheckpointPurposeV1,
      )
      ? rawPurpose as ProductRuntimeCheckpointPurposeV1
      : null;
  if (!purpose) throw new Error("检查点用途无效。");

  const rawSubjectKey = input.subjectKey;
  const subjectKey = rawSubjectKey == null
    ? null
    : typeof rawSubjectKey === "string"
      ? rawSubjectKey.trim() || null
      : null;
  if (rawSubjectKey != null && typeof rawSubjectKey !== "string") {
    throw new Error("检查点对象必须是字符串。");
  }
  if (subjectKey && subjectKey.length > 200) {
    throw new Error("检查点对象不能超过 200 个字符。");
  }

  const requiresSubject = PRODUCT_RUNTIME_CHECKPOINT_SUBJECT_PURPOSES_V1.has(purpose);
  if (requiresSubject && !subjectKey) {
    throw new Error(`${purpose} 检查点必须绑定有效对象。`);
  }
  if (!requiresSubject && subjectKey != null) {
    throw new Error(`${purpose} 检查点不能绑定对象。`);
  }
  return { purpose, subjectKey };
}
