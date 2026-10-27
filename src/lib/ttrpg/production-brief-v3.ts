import { parseTtrpgCompatibleOpeningRevision, type TtrpgCompatibleOpeningRevision } from './open-compatible-opening-contract';
import type { ConfirmedProductBriefV1, ProductSourcePlanV1, WorldReferenceV1 } from "../types";
import { hashProductProductionValueV2 } from "../product-production/hash";
import {
  validateConfirmedProductBriefV1,
  validateProductSourcePlanV1,
} from "../product/source-contracts";
import { validatePortableWorldReferenceV1 } from "../world-engine/world-reference";
import { parseTtrpgAuthoringSettingsV2, type TtrpgAuthoringSettingsV2 } from "./authoring-contract-v2";
import type { RulePackV2 } from "./open-contract";
import { parseRulePackV2 } from "./rule-pack-v2";
import { assertTtrpgOpenAuthoringSeatPlanCurrentV1 } from './open-authoring-seat-plan';

/** Detached open handoff only. No DB writes, start command or model execution. */
export interface TtrpgProductionBriefContentV3 {
  schema: "storyforge.ttrpg-production-brief";
  version: 3;
  runFormat: "open";
  settingsRevision: number;
  settings: Extract<TtrpgAuthoringSettingsV2, { runFormat: "open" }>;
  rulePack: RulePackV2;
  rulePackHash: string;
  worldReference: WorldReferenceV1;
  sourcePlan: ProductSourcePlanV1;
  compatibleOpeningRevision?: TtrpgCompatibleOpeningRevision;
}

export interface TtrpgProductionBriefV3 extends TtrpgProductionBriefContentV3 {
  /** Evidence from the existing production start contract, never a new permission. */
  startAuthorization: ConfirmedProductBriefV1;
}

const CONTENT_FIELDS = [
  "schema", "version", "runFormat", "settingsRevision", "settings",
  "rulePack", "rulePackHash", "worldReference", "sourcePlan",
] as const;
function contentFields(value: unknown): string[] {
  return [...CONTENT_FIELDS, ...(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'compatibleOpeningRevision') ? ['compatibleOpeningRevision'] : [])];
}
const HASH = /^[a-f0-9]{64}$/;

function fail(message: string): never {
  throw new Error(`[ttrpg-brief-v3] ${message}`);
}
function object(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} 必须是对象`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) fail(`${label} 含未知字段或缺少必填字段`);
  return row;
}
function integer(value: unknown, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail(`${label} 无效`);
  return value as number;
}
function readJson(input: unknown): unknown {
  if (typeof input !== "string") return structuredClone(input);
  try { return JSON.parse(input); } catch { return fail("JSON 无效"); }
}
function parseWorldReferenceShape(input: unknown): WorldReferenceV1 {
  const row = object(input, [
    "schema", "version", "worldCode", "releaseUid", "releaseVersion", "releaseHash",
    "localReleaseRecordId", "manifestIdentity", "capabilityIdentity", "referenceHash",
  ], "WorldReference");
  object(row.manifestIdentity, ["schema", "version", "semanticContract", "schemaHash"], "manifestIdentity");
  object(row.capabilityIdentity, ["catalogHash", "profileHash"], "capabilityIdentity");
  return row as unknown as WorldReferenceV1;
}

/** Shape parsing is synchronous for the shared production envelope. It does not grant source rights or prove hashes. */
export function parseTtrpgProductionBriefContentShapeV3(input: unknown): TtrpgProductionBriefContentV3 {
  const row = object(input, contentFields(input), "Brief V3");
  if (row.schema !== "storyforge.ttrpg-production-brief" || row.version !== 3 || row.runFormat !== "open")
    fail("schema/version/runFormat 无效，Brief V3 只接受 open");
  const settingsRevision = integer(row.settingsRevision, 0, "Settings revision");
  const settings = parseTtrpgAuthoringSettingsV2(row.settings);
  if (settings.runFormat !== "open") fail("Brief V3 必须冻结 open Settings V2");
  // The frozen rule payload, not a host-local rule row, owns the rule identity.
  if (settings.wizard.savedRulePackId !== null) fail("冻结 Settings 不得含本地规则行 ID");
  if (!settings.openingSituation.trim() || !settings.playerRole.trim() || !settings.wizard.confirmAll)
    fail("正式 Brief 缺少开场、玩家身份或作者确认");
  const authoring = settings.openAuthoring;
  if (!authoring.companionPolicy || !authoring.stageClosurePolicy || !authoring.runtimePolicy ||
    !authoring.situationTemplates.length || !authoring.openingSituationKeys.length)
    fail("正式 Brief 的 openAuthoring 尚未完成");
  if (settings.authoringSeatPlan) assertTtrpgOpenAuthoringSeatPlanCurrentV1({ plan: settings.authoringSeatPlan,
    seats: settings.wizard.seats, companionPolicy: authoring.companionPolicy });
  const templates = new Set(authoring.situationTemplates.map((item) => item.templateKey));
  if (authoring.openingSituationKeys.some((key) => !templates.has(key)))
    fail("开局局势引用不存在");
  if (authoring.factPolicy.some((item) => !item.authorConfirmed))
    fail("正式 Brief 的事实候选尚未经作者确认");
  const rulePack = parseRulePackV2(row.rulePack);
  if (typeof row.rulePackHash !== "string" || !HASH.test(row.rulePackHash))
    fail("RulePack V2 canonical hash 不一致");
  const worldReference = parseWorldReferenceShape(row.worldReference);
  const planRow = object(row.sourcePlan, [
    "schema", "version", "productType", "productInstanceKey", "worldReference", "adapter",
    "requirements", "initialResourceKeys", "permission", "gatewayPolicy", "gatewayPolicyHash",
    "missingStrategy", "consultationContextManifests", "readiness", "createdAt", "planHash",
  ], "SourcePlan");
  parseWorldReferenceShape(planRow.worldReference);
  const sourcePlan = planRow as unknown as ProductSourcePlanV1;
  if (sourcePlan.schema !== 'storyforge.product-source-plan' || sourcePlan.version !== 1
    || sourcePlan.productType !== "ttrpg" || sourcePlan.adapter?.productType !== "ttrpg" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(sourcePlan.productInstanceKey))
    fail("SourcePlan 不属于有效的 ttrpg production");
  if (sourcePlan.readiness === "blocked" || !Array.isArray(sourcePlan.initialResourceKeys) || !sourcePlan.initialResourceKeys.length)
    fail("SourcePlan 尚未就绪");
  if (worldReference.referenceHash !== sourcePlan.worldReference.referenceHash ||
    worldReference.localReleaseRecordId !== sourcePlan.worldReference.localReleaseRecordId)
    fail("WorldReference 与 SourcePlan 不一致");
  return {
    schema: "storyforge.ttrpg-production-brief",
    version: 3,
    runFormat: "open",
    settingsRevision,
    settings,
    rulePack,
    rulePackHash: row.rulePackHash,
    worldReference,
    sourcePlan,
    ...(Object.prototype.hasOwnProperty.call(row, 'compatibleOpeningRevision') ? { compatibleOpeningRevision: parseTtrpgCompatibleOpeningRevision(row.compatibleOpeningRevision) } : {}),
  };
}

async function parseContent(input: unknown): Promise<TtrpgProductionBriefContentV3> {
  const content = parseTtrpgProductionBriefContentShapeV3(input);
  if (await hashProductProductionValueV2(content.rulePack) !== content.rulePackHash) fail("RulePack V2 canonical hash 不一致");
  const worldReference = await validatePortableWorldReferenceV1(content.worldReference);
  const sourcePlan = await validateProductSourcePlanV1(content.sourcePlan);
  await validatePortableWorldReferenceV1(sourcePlan.worldReference);
  return { ...content, worldReference, sourcePlan };
}

/** Full immutable proof for plan/save/start boundaries; caller must still verify actual local source resources. */
export async function validateTtrpgProductionBriefContentV3(input: unknown): Promise<TtrpgProductionBriefContentV3> {
  return parseContent(input);
}

function portableContent(content: TtrpgProductionBriefContentV3): TtrpgProductionBriefContentV3 {
  return {
    ...content,
    worldReference: { ...content.worldReference, localReleaseRecordId: 0 },
    sourcePlan: {
      ...content.sourcePlan,
      worldReference: { ...content.sourcePlan.worldReference, localReleaseRecordId: 0 },
    },
  };
}

/** Build a reviewable snapshot; this function never manufactures start authorization. */
export async function createTtrpgProductionBriefContentV3(input: {
  settingsRevision: number;
  settings: TtrpgAuthoringSettingsV2;
  rulePack: RulePackV2;
  worldReference: WorldReferenceV1;
  sourcePlan: ProductSourcePlanV1;
  compatibleOpeningRevision?: TtrpgCompatibleOpeningRevision;
}): Promise<TtrpgProductionBriefContentV3> {
  const snapshot = structuredClone(input);
  const settings = parseTtrpgAuthoringSettingsV2(snapshot.settings);
  settings.wizard.savedRulePackId = null;
  const rulePack = parseRulePackV2(snapshot.rulePack);
  return parseContent({
    schema: "storyforge.ttrpg-production-brief",
    version: 3,
    runFormat: "open",
    settingsRevision: snapshot.settingsRevision,
    settings,
    rulePack,
    rulePackHash: await hashProductProductionValueV2(rulePack),
    worldReference: snapshot.worldReference,
    sourcePlan: snapshot.sourcePlan,
    ...(snapshot.compatibleOpeningRevision ? { compatibleOpeningRevision: snapshot.compatibleOpeningRevision } : {}),
  });
}

/** Excludes the confirmation itself to avoid a circular hash; includes every frozen goal. */
export async function hashTtrpgProductionBriefContentV3(input: TtrpgProductionBriefContentV3): Promise<string> {
  return hashProductProductionValueV2(portableContent(await parseContent(structuredClone(input))));
}

export async function parseTtrpgProductionBriefV3(input: unknown): Promise<TtrpgProductionBriefV3> {
  const raw = readJson(input);
  const row = object(raw, [...contentFields(raw), "startAuthorization"], "Brief V3");
  const { startAuthorization: rawAuthorization, ...rawContent } = row;
  const content = await parseContent(rawContent);
  const authRow = object(rawAuthorization, [
    "schema", "version", "productType", "productInstanceKey", "sourcePlanHash", "briefRevision",
    "briefContentHash", "authorStartRevision", "confirmedBy", "confirmedAt", "confirmationHash",
  ], "startAuthorization");
  integer(authRow.briefRevision, 1, "Brief revision");
  integer(authRow.authorStartRevision, 1, "开始授权 revision");
  integer(authRow.confirmedAt, 1, "开始确认时间");
  if (authRow.confirmedBy !== "author") fail("必须由作者明确开始");
  const startAuthorization = await validateConfirmedProductBriefV1({
    brief: authRow as unknown as ConfirmedProductBriefV1,
    sourcePlan: content.sourcePlan,
  });
  if (startAuthorization.briefContentHash !== await hashProductProductionValueV2(portableContent(content)))
    fail("开始授权未绑定此 Brief 内容或 Settings revision 已 stale");
  return { ...content, startAuthorization };
}

/** Attach only an existing confirmed production contract; does not authorize or start a run. */
export async function createTtrpgProductionBriefV3(input: {
  content: TtrpgProductionBriefContentV3;
  startAuthorization: ConfirmedProductBriefV1;
}): Promise<TtrpgProductionBriefV3> {
  return parseTtrpgProductionBriefV3({ ...input.content, startAuthorization: input.startAuthorization });
}
