import type { TtrpgCampaignContentV1 } from "../types";
import type { TtrpgCampaignContentV2 } from "./open-contract";

export type TtrpgRunFormat = "scripted" | "open";

/**
 * Dispatch only after the format-specific parser has validated the content.
 * In particular, absence of a discriminator on a damaged V2 is not legacy.
 */
export function resolveTtrpgRunFormatV1(
  campaign: TtrpgCampaignContentV1 | TtrpgCampaignContentV2 | unknown,
): TtrpgRunFormat {
  if (!campaign || typeof campaign !== "object" || Array.isArray(campaign)) {
    throw new Error("跑团内容必须是已验证的战役对象");
  }
  const value = campaign as Record<string, unknown>;
  if (value.schema !== "storyforge.ttrpg-campaign") {
    throw new Error("跑团战役 schema 不匹配");
  }
  if (value.version === 1 && !Object.prototype.hasOwnProperty.call(value, "runFormat")) {
    return "scripted";
  }
  if (value.version === 2 && value.runFormat === "open") return "open";
  throw new Error("跑团版本与运行格式不匹配");
}

export function assertTtrpgOpenOnlyV1(
  runFormat: string,
  operation: string,
): asserts runFormat is "open" {
  if (runFormat !== "open") {
    throw new Error(`${operation} 仅适用于 open 跑团`);
  }
}

export function assertTtrpgScriptedOnlyV1(
  runFormat: string,
  operation: string,
): asserts runFormat is "scripted" {
  if (runFormat !== "scripted") {
    throw new Error(`${operation} 仅适用于 scripted 兼容作品`);
  }
}

export function assertTtrpgPlayerProtocolV1(input: {
  runtimeProtocol: number;
  minimumPlayerVersion: number;
  playerVersion: number;
}): void {
  if (
    !Number.isSafeInteger(input.playerVersion) ||
    input.playerVersion < 1 ||
    (input.runtimeProtocol !== 1 && input.runtimeProtocol !== 2) ||
    input.minimumPlayerVersion !== input.runtimeProtocol
  ) {
    throw new Error("跑团播放器协议声明无效");
  }
  if (input.playerVersion < input.minimumPlayerVersion) {
    throw new Error(`此跑团需要播放器协议 ${input.minimumPlayerVersion}`);
  }
}
