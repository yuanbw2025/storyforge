import type { TtrpgRuntimeRestReceiptV2 } from "../types";
import { OnlineRoomAuthorityError } from "./room-authority";

export interface OnlineTtrpgRestCommandV1 {
  restKey: string;
  restKind: "short-rest" | "long-rest";
  actorKeys: string[];
  reason: string;
}

function fail(message: string): never {
  throw new OnlineRoomAuthorityError("domain_protocol", message);
}

function key(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const result = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) fail(`${label} 无效`);
  return result;
}

export function parseOnlineTtrpgRestCommandV1(value: unknown): OnlineTtrpgRestCommandV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("rest.complete.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  const expected = ["restKey", "restKind", "actorKeys", "reason"];
  const actual = Object.keys(row);
  if (actual.length !== expected.length || actual.some(field => !expected.includes(field))) {
    fail("rest.complete.payload 字段不符合闭集协议");
  }
  const restKind = String(row.restKind);
  if (restKind !== "short-rest" && restKind !== "long-rest") fail("restKind 无效");
  if (!Array.isArray(row.actorKeys) || !row.actorKeys.length || row.actorKeys.length > 100) {
    fail("actorKeys 无效");
  }
  const actorKeys = row.actorKeys.map((actor, index) => key(actor, `actorKeys[${index}]`));
  if (new Set(actorKeys).size !== actorKeys.length) fail("actorKeys 重复");
  if (typeof row.reason !== "string") fail("reason 必须是字符串");
  const reason = row.reason.trim().normalize("NFC");
  if (!reason || reason.length > 2_000) fail("reason 无效");
  return {
    restKey: key(row.restKey, "restKey"),
    restKind,
    actorKeys,
    reason,
  };
}

export function createOnlineTtrpgRestVisiblePayloadV1(receipt: TtrpgRuntimeRestReceiptV2): unknown {
  return {
    eventSequence: receipt.eventSequence,
    restKey: receipt.restKey,
    kind: receipt.kind,
    actorKeys: [...receipt.actorKeys],
    reason: receipt.reason,
    resetAbilityKeys: receipt.abilityChanges.map(change => change.abilityKey),
  };
}
