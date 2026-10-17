import type {
  ProductReleaseManifestV1,
  ProductRuntimePackageV1,
  RulePackV1,
  TtrpgRuntimeContentV1,
} from "../types";
import { hashProductProductionValueV2, isSha256Hash } from "../product-production/hash";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import { parseRulePackV1 } from "./rule-pack";
import { parseTtrpgCampaignContentV2 } from "./campaign-v2";
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from "./rule-pack-v2";
import type { RulePackV2, TtrpgCampaignContentV2 } from "./open-contract";
import { assertTtrpgPlayerProtocolV1 } from "./run-format";
import { parseTtrpgFrozenContentCachedV1 } from './frozen-content-cache'

export interface TtrpgRuntimeContentV2 {
  rulePack: { content: RulePackV2; contentHash: string };
  campaign: TtrpgCampaignContentV2;
  compatibility: { runtimeProtocol: 2; minimumPlayerVersion: 2 };
}

export type TtrpgVersionedRuntimeContent = TtrpgRuntimeContentV1 | TtrpgRuntimeContentV2;
export type ProductRuntimePackageWithTtrpgV2 =
  Omit<ProductRuntimePackageV1, "ttrpg"> & { ttrpg?: TtrpgVersionedRuntimeContent };
export type ProductReleaseManifestWithTtrpgV2 =
  Omit<ProductReleaseManifestV1, "runtimePackage"> & {
    runtimePackage: ProductRuntimePackageWithTtrpgV2;
  };

export function isTtrpgRuntimeContentV2(
  value: TtrpgVersionedRuntimeContent,
): value is TtrpgRuntimeContentV2 {
  return value.campaign.version === 2;
}

export function isTtrpgRuntimeContentV1(
  value: TtrpgVersionedRuntimeContent,
): value is TtrpgRuntimeContentV1 {
  return value.campaign.version !== 2;
}

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))) {
    throw new Error(`${label} 字段不符合合同`);
  }
  return row;
}

/** Parse raw protocol content only. No defaults or mechanical projection enter identity hashing. */
export function parseTtrpgRuntimeContentVersionedV1(
  value: unknown,
  sourceWorldHash: string,
  playerVersion: 1 | 2,
): TtrpgVersionedRuntimeContent {
  return parseTtrpgFrozenContentCachedV1(value, sourceWorldHash, playerVersion, parseTtrpgRuntimeContentUncachedV1)
}

function parseTtrpgRuntimeContentUncachedV1(
  value: unknown,
  sourceWorldHash: string,
  playerVersion: 1 | 2,
): TtrpgVersionedRuntimeContent {
  const raw = object(value, ["rulePack", "campaign", "compatibility"], "ttrpg");
  const frozen = object(raw.rulePack, ["content", "contentHash"], "ttrpg.rulePack");
  const compatibility = object(raw.compatibility, ["runtimeProtocol", "minimumPlayerVersion"], "ttrpg.compatibility");
  if (!isSha256Hash(frozen.contentHash) || !isSha256Hash(sourceWorldHash)) {
    throw new Error("跑团来源 hash 无效");
  }
  const protocol = compatibility.runtimeProtocol;
  if ((protocol !== 1 && protocol !== 2) || compatibility.minimumPlayerVersion !== protocol) {
    throw new Error("跑团协议版本不匹配");
  }
  assertTtrpgPlayerProtocolV1({
    runtimeProtocol: protocol,
    minimumPlayerVersion: protocol,
    playerVersion,
  });
  let parsed: TtrpgVersionedRuntimeContent;
  if (protocol === 1) {
    const content = parseRulePackV1(frozen.content);
    parsed = {
      rulePack: { content, contentHash: frozen.contentHash },
      campaign: parseTtrpgCampaignContentV1(raw.campaign, content),
      compatibility: { runtimeProtocol: 1, minimumPlayerVersion: 1 },
    };
  } else {
    const content = parseRulePackV2(frozen.content);
    parsed = {
      rulePack: { content, contentHash: frozen.contentHash },
      campaign: parseTtrpgCampaignContentV2(raw.campaign, content),
      compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 },
    };
  }
  if (parsed.campaign.sourceWorld.contentHash !== sourceWorldHash ||
      !isSha256Hash(parsed.campaign.sourceWorld.bundleHash)) {
    throw new Error("跑团战役来源与 RuntimePackage 不一致");
  }
  return parsed;
}

/** Frozen runtime snapshots only. Authoring/parser callers keep independent mutable values above. */
export function parseTtrpgFrozenRuntimeContentV1(value: unknown, sourceWorldHash: string): TtrpgVersionedRuntimeContent {
  return parseTtrpgFrozenContentCachedV1(value, sourceWorldHash, 2, parseTtrpgRuntimeContentUncachedV1, true)
}

export type TtrpgVerifiedContentViewV1 =
  | { runFormat: "scripted"; rawContent: TtrpgRuntimeContentV1; mechanicalRulePack: RulePackV1 }
  | { runFormat: "open"; rawContent: TtrpgRuntimeContentV2; mechanicalRulePack: RulePackV1 };

export async function hashTtrpgFrozenPredicateIndexV1(
  index: TtrpgCampaignContentV2["frozenWorldPredicateIndex"],
): Promise<string> {
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  const entries = [...index.entries].sort((left, right) =>
    compare(left.subjectRef, right.subjectRef) ||
    compare(left.predicateKey, right.predicateKey) ||
    compare(left.objectRef ?? "", right.objectRef ?? "") ||
    compare(left.factKey, right.factKey),
  );
  return hashProductProductionValueV2({ worldReleaseHash: index.worldReleaseHash, entries });
}

export async function verifyTtrpgFrozenContentHashesV1(
  content: TtrpgVersionedRuntimeContent,
): Promise<void> {
  if (await hashProductProductionValueV2(content.rulePack.content) !== content.rulePack.contentHash) {
    throw new Error("TTRPG RulePack contentHash 校验失败");
  }
  if (content.campaign.version === 2) {
    const index = content.campaign.frozenWorldPredicateIndex;
    if (await hashTtrpgFrozenPredicateIndexV1(index) !== index.indexHash) {
      throw new Error("TTRPG frozen indexHash 校验失败");
    }
  }
}

/** Call after the enclosing package/release identity has been verified. */
export async function createTtrpgVerifiedContentViewV1(
  rawContent: TtrpgVersionedRuntimeContent,
): Promise<TtrpgVerifiedContentViewV1> {
  // Reparse and hash before projecting; never trust a TypeScript annotation as validation.
  const parsed = parseTtrpgRuntimeContentVersionedV1(
    rawContent,
    rawContent.campaign.sourceWorld.contentHash,
    2,
  );
  await verifyTtrpgFrozenContentHashesV1(parsed);
  if (isTtrpgRuntimeContentV2(parsed)) {
    const open = parsed;
    return {
      runFormat: "open",
      rawContent: open,
      mechanicalRulePack: projectTtrpgRulePackMechanicalCoreV1(open.rulePack.content),
    };
  }
  const scripted = parsed;
  return {
    runFormat: "scripted",
    rawContent: scripted,
    mechanicalRulePack: structuredClone(scripted.rulePack.content),
  };
}
