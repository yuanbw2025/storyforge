import type { TtrpgRuntimeHumanResponseV2 } from "../types";
import { OnlineRoomAuthorityError } from "./room-authority";

export interface OnlineTtrpgHumanResponseCommandV1 {
  actionSequence: number;
  actionReceiptKey: string;
  responseKind: "speak" | "act-narratively" | "decline";
  text: string;
  audience: "party" | "gm-only";
}

function fail(message: string): never {
  throw new OnlineRoomAuthorityError("domain_protocol", message);
}

function stableKey(value: unknown, label: string): string {
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized)) {
    fail(`${label} 无效`);
  }
  return normalized;
}

/** Closed protocol parser shared by browser-hosted and durable room adapters. */
export function parseOnlineTtrpgHumanResponseCommandV1(
  value: unknown,
): OnlineTtrpgHumanResponseCommandV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("human.response.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  const expected = [
    "actionSequence",
    "actionReceiptKey",
    "responseKind",
    "text",
    "audience",
  ];
  const actual = Object.keys(row);
  if (
    actual.length !== expected.length ||
    actual.some((field) => !expected.includes(field))
  ) {
    fail("human.response.payload 字段不符合闭集协议");
  }
  if (!Number.isInteger(row.actionSequence) || Number(row.actionSequence) < 1) {
    fail("actionSequence 无效");
  }
  const responseKind = String(row.responseKind);
  if (!["speak", "act-narratively", "decline"].includes(responseKind)) {
    fail("responseKind 无效");
  }
  const audience = String(row.audience);
  if (audience !== "party" && audience !== "gm-only") {
    fail("audience 无效");
  }
  if (typeof row.text !== "string") fail("text 必须是字符串");
  const text = row.text.trim().normalize("NFC");
  if (
    text.length > 10_000 ||
    (responseKind !== "decline" && !text) ||
    (responseKind === "decline" && text.length > 0)
  ) {
    fail("text 与 responseKind 不匹配");
  }
  return {
    actionSequence: Number(row.actionSequence),
    actionReceiptKey: stableKey(row.actionReceiptKey, "actionReceiptKey"),
    responseKind:
      responseKind as OnlineTtrpgHumanResponseCommandV1["responseKind"],
    text,
    audience: audience as OnlineTtrpgHumanResponseCommandV1["audience"],
  };
}

export function createOnlineTtrpgHumanResponseVisiblePayloadsV1(input: {
  response: TtrpgRuntimeHumanResponseV2;
  ownerMemberId: string;
}): {
  publicPayload: unknown;
  gmPrivatePayload: unknown;
  privatePayloadByMemberId: Record<string, unknown>;
} {
  const safeResponse = {
    responseKey: input.response.responseKey,
    eventSequence: input.response.eventSequence,
    actionSequence: input.response.actionSequence,
    actionReceiptKey: input.response.actionReceiptKey,
    actorKey: input.response.actorKey,
    kind: input.response.kind,
    text: input.response.text,
    audience: input.response.audience,
  };
  return {
    publicPayload:
      input.response.audience === "party"
        ? safeResponse
        : {
            actionSequence: input.response.actionSequence,
            actorKey: input.response.actorKey,
            audience: "gm-only",
            recorded: true,
          },
    gmPrivatePayload: safeResponse,
    privatePayloadByMemberId: {
      [input.ownerMemberId]: safeResponse,
    },
  };
}
