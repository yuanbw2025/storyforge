import type { TtrpgRuntimeItemReceiptV2 } from "../types";
import type { TtrpgItemCommandV2 } from "../ttrpg/item-ledger";
import { OnlineRoomAuthorityError, type OnlineRoomMemberV1 } from "./room-authority";

function fail(message: string): never {
  throw new OnlineRoomAuthorityError("domain_protocol", message);
}

function row(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some(field => !fields.includes(field))) {
    fail(`${label} 字段不符合闭集协议`);
  }
}

function key(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value == null) return null;
  if (typeof value !== "string") fail(`${label} 必须是字符串`);
  const result = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result)) fail(`${label} 无效`);
  return result;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100_000) {
    fail(`${label} 无效`);
  }
  return Number(value);
}

/**
 * Converts a credential-free client operation into the formal item command.
 * commandId and grant eventId are always derived by the authoritative adapter.
 */
export function buildOnlineTtrpgItemCommandV1(input: {
  payload: unknown;
  commandId: string;
  eventSequence: number;
}): TtrpgItemCommandV2 {
  const payload = row(input.payload, "item.command.payload");
  exact(payload, ["operation"], "item.command.payload");
  const operation = row(payload.operation, "item.command.operation");
  const kind = String(operation.kind) as TtrpgItemCommandV2["kind"];
  const instanceId = key(operation.instanceId, "instanceId")!;
  if (kind === "grant") {
    exact(operation, ["kind", "instanceId", "definitionRef", "ownerRef", "locationRef", "quantity"], "grant operation");
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      definitionRef: key(operation.definitionRef, "definitionRef")!,
      ownerRef: key(operation.ownerRef, "ownerRef", true),
      locationRef: key(operation.locationRef, "locationRef", true),
      quantity: integer(operation.quantity, "quantity"),
      eventId: `event.${input.eventSequence}`,
    };
  }
  if (kind === "remove") {
    exact(operation, ["kind", "instanceId", "expectedOwnerRef", "quantity"], "remove operation");
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      expectedOwnerRef: key(operation.expectedOwnerRef, "expectedOwnerRef", true),
      quantity: integer(operation.quantity, "quantity"),
    };
  }
  if (kind === "transfer") {
    exact(operation, ["kind", "instanceId", "expectedOwnerRef", "destinationOwnerRef"], "transfer operation");
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      expectedOwnerRef: key(operation.expectedOwnerRef, "expectedOwnerRef", true),
      destinationOwnerRef: key(operation.destinationOwnerRef, "destinationOwnerRef", true),
    };
  }
  if (kind === "use") {
    exact(operation, ["kind", "instanceId", "expectedOwnerRef", "amount"], "use operation");
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      expectedOwnerRef: key(operation.expectedOwnerRef, "expectedOwnerRef", true),
      amount: integer(operation.amount, "amount"),
    };
  }
  if (kind === "equip") {
    exact(operation, ["kind", "instanceId", "expectedOwnerRef", "slots"], "equip operation");
    if (!Array.isArray(operation.slots) || !operation.slots.length || operation.slots.length > 20) {
      fail("slots 无效");
    }
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      expectedOwnerRef: key(operation.expectedOwnerRef, "expectedOwnerRef")!,
      slots: operation.slots.map((slot, index) => key(slot, `slots[${index}]`)!),
    };
  }
  if (kind === "unequip" || kind === "attune") {
    exact(operation, ["kind", "instanceId", "expectedOwnerRef"], `${kind} operation`);
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      expectedOwnerRef: key(operation.expectedOwnerRef, "expectedOwnerRef")!,
    };
  }
  if (kind === "damage" || kind === "repair") {
    exact(operation, ["kind", "instanceId", "amount"], `${kind} operation`);
    return {
      commandId: input.commandId,
      kind,
      instanceId,
      amount: integer(operation.amount, "amount"),
    };
  }
  fail("item operation kind 无效");
}

export function createOnlineTtrpgItemVisiblePayloadsV1(input: {
  receipt: TtrpgRuntimeItemReceiptV2;
  members: OnlineRoomMemberV1[];
  requesterMemberId: string;
}): {
  publicPayload: unknown;
  gmPrivatePayload: unknown;
  privatePayloadByMemberId: Record<string, unknown>;
} {
  const safeReceipt = structuredClone(input.receipt);
  const actorKeys = new Set([
    input.receipt.before?.ownerRef ?? null,
    input.receipt.after?.ownerRef ?? null,
  ].filter((value): value is string => value != null));
  const ownerMemberIds = input.members
    .filter(member => member.role === "player" && member.actorKey != null && actorKeys.has(member.actorKey))
    .map(member => member.memberId);
  const privateMemberIds = new Set([input.requesterMemberId, ...ownerMemberIds]);
  return {
    publicPayload: {
      operation: input.receipt.operation,
      itemInstanceId: input.receipt.itemInstanceId,
      changed: true,
    },
    gmPrivatePayload: safeReceipt,
    privatePayloadByMemberId: Object.fromEntries(
      [...privateMemberIds].map(memberId => [memberId, safeReceipt]),
    ),
  };
}
