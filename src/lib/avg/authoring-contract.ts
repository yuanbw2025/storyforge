/** AVG S2 author-owned settings. Frozen into the shared Brief, never into the source world. */
export interface AvgAuthoringSettingsV1 {
  version: 1;
  playerRole: string;
  openingSituation: string;
  experience: string;
  aspectRatio: "16:9" | "4:3";
  targetPlayMinutes: number;
  targetEndingCount: number;
  routes: string;
  variables: string;
  endings: string;
  choiceBoundaries: string;
  visualLevel: "none" | "key-scenes";
  audioLevel: "none" | "music-sfx";
  qualityProfile: "prototype" | "internal" | "commercial-candidate";
}
export const DEFAULT_AVG_SETTINGS: AvgAuthoringSettingsV1 = {
  version: 1,
  playerRole: "",
  openingSituation: "",
  experience: "",
  aspectRatio: "16:9",
  targetPlayMinutes: 30,
  targetEndingCount: 2,
  routes: "",
  variables: "",
  endings: "",
  choiceBoundaries: "",
  visualLevel: "key-scenes",
  audioLevel: "none",
  qualityProfile: "prototype",
};
export function parseAvgAuthoringSettingsV1(
  value: unknown,
): AvgAuthoringSettingsV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("AVG 方案必须是对象");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== Object.keys(DEFAULT_AVG_SETTINGS).length ||
    Object.keys(row).some((key) => !(key in DEFAULT_AVG_SETTINGS))
  )
    throw new Error("AVG 方案字段不完整或含未知字段");
  if (row.version !== 1) throw new Error("AVG 方案版本不支持");
  for (const key of [
    "playerRole",
    "openingSituation",
    "experience",
    "routes",
    "variables",
    "endings",
    "choiceBoundaries",
  ]) {
    if (typeof row[key] !== "string" || (row[key] as string).length > 5000)
      throw new Error(`AVG ${key} 最多 5000 字符`);
  }
  for (const [key, values] of Object.entries({
    aspectRatio: ["16:9", "4:3"],
    visualLevel: ["none", "key-scenes"],
    audioLevel: ["none", "music-sfx"],
    qualityProfile: ["prototype", "internal", "commercial-candidate"],
  })) {
    if (!values.includes(row[key] as string))
      throw new Error(`AVG ${key} 无效`);
  }
  for (const [key, max] of [
    ["targetPlayMinutes", 900],
    ["targetEndingCount", 8],
  ] as const) {
    if (
      !Number.isInteger(row[key]) ||
      Number(row[key]) < 1 ||
      Number(row[key]) > max
    )
      throw new Error(`AVG ${key} 必须为 1～${max} 的整数`);
  }
  return structuredClone(value) as AvgAuthoringSettingsV1;
}
export interface AvgAuthoringDraftV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  revision: number;
  settingsJson: string;
  /** A world-owned immutable local cache; no mutable world canon is copied. */
  worldReleaseId: number | null;
  sourcePurpose?: import('../world-engine/source-purpose-contract').WorldSourcePurposeProofV1;
  productionId: number | null;
  editorJson?: string;
  editorPreviewHash?: string;
  conversationJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface AvgDraftMediaV1 {
  id?: number;
  projectId: number;
  worldId: number;
  workId: number;
  blobObjectId: number;
  assetJson: string;
  createdAt: number;
}
