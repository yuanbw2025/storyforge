import { hashCanonicalValue } from "../agent/run/hash";
import { hashProductProductionValueV2 } from "../product-production/hash";
import {
  applyProductRuntimeEvent,
  classifyTtrpgSubmittedIntentV2,
  parseProductRuntimeState,
} from "../ttrpg/runtime-api";
import { parseTtrpgCampaignContentV1 } from "../ttrpg/campaign";
import {
  parseRulePackV1,
  resolveRulePackCheckV1,
  resolveRulePackDiceModelV1,
} from "../ttrpg/rule-pack";
import { createInitialTtrpgProductStateV1 } from "../ttrpg/runtime";
import { spendTtrpgActionEconomyV2 } from "../ttrpg/action-economy";
import {
  applyTtrpgItemCommandV2,
  ttrpgItemDefinitionFromRuleV1,
} from "../ttrpg/item-ledger";
import {
  resetTtrpgAbilityUsageV2,
  ttrpgAbilityStateKeyV2,
  consumeTtrpgAbilityV2,
} from "../ttrpg/ability-ledger";
import {
  createTtrpgAutomaticSessionRecapsV2,
  createTtrpgViewerProjectionV1,
} from "../ttrpg/viewer-projection";
import { createTtrpgActionReceiptV2 } from "../ttrpg/action-feedback";
import {
  applyTtrpgEffectPlanToRuntimeV2,
  proposeTtrpgEffectChoiceToRuntimeV2,
  resolveTtrpgEffectChoiceToRuntimeV2,
} from "../ttrpg/effect-runtime";
import type {
  RulePackV1,
  ProductRuntimeEvent,
  ProductRuntimeEventType,
  ProductRuntimeState,
  TtrpgRuntimeHumanResponseV2,
  TtrpgRuntimeRestReceiptV2,
  TtrpgRuntimeRuleActionResultV1,
  TtrpgRuntimeIntentReceiptV2,
  TtrpgCampaignContentV1,
  TtrpgRuntimeContentV1,
} from "../types";
import {
  OnlineRoomAuthorityError,
  type OnlineRoomCommandKindV1,
  type OnlineRoomDomainAdapterV1,
  type OnlineRoomDomainEventV1,
  type OnlineRoomMemberV1,
} from "./room-authority";
import {
  VerifiableOnlineDiceV1,
  type OnlineDiceCommitmentSeriesV1,
  type OnlineDiceServerCheckpointV1,
} from "./verifiable-dice";
import {
  createPrivateTtrpgActorActionEventV1,
  createPublicTtrpgActionEventV1,
} from "./ttrpg-public-action";
import {
  createOnlineTtrpgHumanResponseVisiblePayloadsV1,
  parseOnlineTtrpgHumanResponseCommandV1,
} from "./ttrpg-human-response";
import {
  buildOnlineTtrpgItemCommandV1,
  createOnlineTtrpgItemVisiblePayloadsV1,
} from "./ttrpg-item-command";
import {
  createOnlineTtrpgRestVisiblePayloadV1,
  parseOnlineTtrpgRestCommandV1,
} from "./ttrpg-rest-command";
import {
  buildOnlineTtrpgEffectCommandV1,
  buildOnlineTtrpgEffectChoiceProposalCommandV1,
  createOnlineTtrpgEffectChoiceVisiblePayloadsV1,
  createOnlineTtrpgEffectVisiblePayloadsV1,
  parseOnlineTtrpgEffectChoiceResolutionCommandV1,
} from "./ttrpg-effect-command";
import {
  parseOnlineTtrpgCampaignSessionCompleteV1,
  parseOnlineTtrpgCampaignSessionStartV1,
} from "./ttrpg-campaign-session-command";
import {
  parseOnlineTtrpgAiPlayerObjectiveV1,
  parseOnlineTtrpgAiPlayerProposalV1,
  type OnlineTtrpgAiPlayerServiceV1,
} from "./ttrpg-ai-player-service";
import {
  parseOnlineTtrpgAiGmActorObjectiveV1,
  parseOnlineTtrpgAiGmActorProposalV1,
  parseOnlineTtrpgAiGmObjectiveV1,
  parseOnlineTtrpgAiGmProposalV1,
  type OnlineTtrpgAiGmServiceV1,
} from "./ttrpg-ai-gm-service";

interface DurableTtrpgChatEntryV1 {
  sequence: number;
  memberId: string;
  displayName: string;
  role: OnlineRoomMemberV1["role"];
  actorKey: string | null;
  text: string;
}

export interface DurableFormalTtrpgCheckpointV1 {
  schema: "storyforge.durable-formal-ttrpg-checkpoint";
  version: 1;
  roomId: string;
  releaseHash: string;
  rulePackHash: string;
  campaignHash: string;
  seed: string;
  state: ProductRuntimeState;
  chat: DurableTtrpgChatEntryV1[];
  dice: OnlineDiceServerCheckpointV1;
  integrityHash: string;
}

function fail(code: string, message: string): never {
  throw new OnlineRoomAuthorityError(code, message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("domain_protocol", `${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((field) => !expected.includes(field))
  ) {
    fail("domain_protocol", `${label} 字段不符合闭集协议`);
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string")
    fail("domain_protocol", `${label} 必须是字符串`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized.length > maximum)
    fail("domain_protocol", `${label} 无效`);
  return normalized;
}

function key(value: unknown, label: string): string {
  const normalized = text(value, label, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized))
    fail("domain_protocol", `${label} 无效`);
  return normalized;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value == null) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1_000_000
  ) {
    fail("domain_protocol", `${label} 无效`);
  }
  return value;
}

function publicEvent(
  kind: OnlineRoomCommandKindV1,
  payload: unknown,
): Pick<OnlineRoomDomainEventV1, "eventType" | "publicPayload"> {
  return {
    eventType: `ttrpg.${kind}`,
    publicPayload: structuredClone(payload),
  };
}

function initialRuntimeState(
  content: TtrpgRuntimeContentV1,
): ProductRuntimeState {
  const entities: ProductRuntimeState["entities"] = {};
  for (const template of content.campaign.characterTemplates) {
    entities[template.characterKey] = {
      entityKey: template.characterKey,
      kind: template.role === "player" ? "player" : "npc",
      name: template.name,
      lifecycleStatus: "active",
      locationKey: null,
      attributes: { identity: template.description },
    };
  }
  for (const scene of content.campaign.scenes) {
    if (scene.locationKey && !entities[scene.locationKey]) {
      entities[scene.locationKey] = {
        entityKey: scene.locationKey,
        kind: "location",
        name: scene.locationKey,
        lifecycleStatus: "active",
        locationKey: null,
        attributes: {},
      };
    }
  }
  return createInitialTtrpgProductStateV1({
    initialState: {
      version: 1,
      clock: 0,
      entities,
      memories: [],
      narratives: [],
      ttrpg: null,
      interaction: null,
      narrative: null,
      adventure: null,
      presentation: null,
      openWorldEvolution: null,
      openWorld: null,
      lastSequence: 0,
    },
    content,
  });
}

/**
 * Service-side formal TTRPG adapter. Unlike the browser bridge, it owns a
 * portable deterministic state and implements checkpoint export/restore, so a
 * room snapshot and its domain state can be committed by the same CAS.
 */
export class DurableFormalTtrpgRoomAdapterV1 implements OnlineRoomDomainAdapterV1 {
  private state: ProductRuntimeState;
  private chat: DurableTtrpgChatEntryV1[] = [];
  private dice!: VerifiableOnlineDiceV1;

  private constructor(
    private readonly roomId: string,
    private readonly releaseHash: string,
    private readonly rulePackHash: string,
    private readonly campaignHash: string,
    private readonly seed: string,
    private readonly rulePack: RulePackV1,
    private readonly campaign: TtrpgCampaignContentV1,
    state: ProductRuntimeState,
    private readonly memberIdForActor: (actorKey: string) => string | null,
    private readonly aiPlayerService: OnlineTtrpgAiPlayerServiceV1 | null,
    private readonly aiGmService: OnlineTtrpgAiGmServiceV1 | null,
  ) {
    this.state = state;
  }

  static async create(input: {
    roomId: string;
    releaseHash: string;
    content: TtrpgRuntimeContentV1;
    selectedCharacterKeys: string[];
    seed?: string;
    maximumCommittedRolls?: number;
    memberIdForActor?: (actorKey: string) => string | null;
    aiPlayerService?: OnlineTtrpgAiPlayerServiceV1 | null;
    aiGmService?: OnlineTtrpgAiGmServiceV1 | null;
  }): Promise<DurableFormalTtrpgRoomAdapterV1> {
    const roomId = key(input.roomId, "roomId");
    if (!/^[a-f0-9]{64}$/.test(input.releaseHash))
      fail("release_mismatch", "releaseHash 无效");
    const rulePack = parseRulePackV1(input.content.rulePack.content);
    const calculatedRulePackHash = await hashProductProductionValueV2(rulePack);
    if (calculatedRulePackHash !== input.content.rulePack.contentHash) {
      fail("release_mismatch", "冻结 RulePack hash 不一致");
    }
    const campaign = parseTtrpgCampaignContentV1(
      input.content.campaign,
      rulePack,
    );
    const campaignHash = await hashProductProductionValueV2(campaign);
    const selected = [
      ...new Set(
        input.selectedCharacterKeys.map((value) =>
          key(value, "selectedCharacterKey"),
        ),
      ),
    ];
    const players = new Set(
      campaign.characterTemplates
        .filter((item) => item.role === "player")
        .map((item) => item.characterKey),
    );
    if (
      selected.length < campaign.playerCount.minimum ||
      selected.length > campaign.playerCount.maximum ||
      selected.some((characterKey) => !players.has(characterKey))
    ) {
      fail(
        "domain_configuration",
        `房间角色编组必须为 ${campaign.playerCount.minimum}–${campaign.playerCount.maximum} 名冻结玩家角色`,
      );
    }
    let state = initialRuntimeState({
      rulePack: { content: rulePack, contentHash: calculatedRulePackHash },
      campaign,
      compatibility: structuredClone(input.content.compatibility),
    });
    const adapter = new DurableFormalTtrpgRoomAdapterV1(
      roomId,
      input.releaseHash,
      calculatedRulePackHash,
      campaignHash,
      input.seed?.trim() || `room:${roomId}:${input.releaseHash}`,
      rulePack,
      campaign,
      state,
      input.memberIdForActor ?? (() => null),
      input.aiPlayerService ?? null,
      input.aiGmService ?? null,
    );
    state = adapter.commitRuntimeTransition(
      "ttrpg.session-zero.completed",
      "gm",
      campaign.campaignKey,
      {
        acceptedItemKeys: state.ttrpg!.product!.sessionZero.requiredItemKeys,
        selectedCharacterKeys: selected,
        completedBy: "gm",
      },
      "room.session-zero",
    );
    adapter.state = state;
    adapter.dice = await VerifiableOnlineDiceV1.create({
      roomId,
      releaseHash: input.releaseHash,
      maximumRolls: input.maximumCommittedRolls,
    });
    return adapter;
  }

  inspect(): {
    state: ProductRuntimeState;
    commitments: OnlineDiceCommitmentSeriesV1;
  } {
    return {
      state: structuredClone(this.state),
      commitments: structuredClone(this.dice.commitments),
    };
  }

  async apply(
    input: Parameters<OnlineRoomDomainAdapterV1["apply"]>[0],
  ): Promise<OnlineRoomDomainEventV1> {
    if (input.roomId !== this.roomId || input.releaseHash !== this.releaseHash)
      fail("release_mismatch", "房间或 Release 不匹配");
    const payload = record(
      input.command.payload,
      `${input.command.kind}.payload`,
    );
    const commandId = `online:${input.member.memberId}:${input.command.requestId}`;
    let visible = publicEvent(input.command.kind, { accepted: true });
    let gmPrivatePayload: unknown = null;
    let privatePayloadByMemberId: Record<string, unknown> | undefined;
    try {
      if (
        input.command.kind !== "safety.resume" &&
        input.command.kind !== "safety.pause" &&
        input.command.kind !== "chat.message" &&
        this.state.ttrpg?.product?.safety.status === "paused"
      ) {
        fail("domain_rejected", "战役处于安全暂停状态");
      }
      if (
        input.command.kind === "safety.pause" ||
        input.command.kind === "safety.resume"
      ) {
        const paused = input.command.kind === "safety.pause";
        exact(
          payload,
          paused ? ["reason"] : [],
          `${input.command.kind}.payload`,
        );
        const reason = paused ? text(payload.reason, "reason", 2_000) : null;
        this.state = this.commitRuntimeTransition(
          "ttrpg.safety.changed",
          input.member.actorKey ?? input.member.memberId,
          this.campaign.campaignKey,
          {
            status: paused ? "paused" : "active",
            reason,
            changedBy: input.member.actorKey ?? input.member.memberId,
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, {
          status: paused ? "paused" : "active",
          reason,
        });
      } else if (input.command.kind === "scene.open") {
        exact(payload, ["sceneKey"], "scene.open.payload");
        const sceneKey = key(payload.sceneKey, "sceneKey");
        const scene = this.campaign.scenes.find(
          (item) => item.sceneKey === sceneKey,
        );
        const product = this.state.ttrpg?.product;
        if (
          !scene ||
          !product ||
          (!this.state.ttrpg?.scene && sceneKey !== product.openingSceneKey)
        ) {
          fail("domain_rejected", "场景不是冻结开场");
        }
        if (this.state.ttrpg?.scene?.sceneKey) {
          const current = this.campaign.scenes.find(
            (item) => item.sceneKey === this.state.ttrpg?.scene?.sceneKey,
          );
          if (!current?.nextSceneKeys.includes(sceneKey))
            fail("domain_rejected", "只能打开冻结后继场景");
        }
        const allPlayers = new Set(
          this.campaign.characterTemplates
            .filter((item) => item.role === "player")
            .map((item) => item.characterKey),
        );
        const participants = (
          scene.participantKeys.length
            ? scene.participantKeys
            : product.sessionZero.selectedCharacterKeys
        ).filter(
          (actorKey) =>
            !allPlayers.has(actorKey) ||
            product.sessionZero.selectedCharacterKeys.includes(actorKey),
        );
        if (!participants.length) fail("domain_rejected", "场景没有可用行动者");
        const nextSequence = this.state.lastSequence + 1;
        const initiativeEntries = await Promise.all(
          participants.map(async (actorKey) => {
            const modifier = Number(
              this.state.entities[actorKey]?.attributes[
                this.rulePack.turnStructure.initiativeAttributeKey
              ],
            );
            if (!Number.isFinite(modifier))
              fail("domain_rejected", `角色缺少先攻属性:${actorKey}`);
            const rolled = await resolveRulePackDiceModelV1({
              rulePack: this.rulePack,
              diceModelKey: this.rulePack.turnStructure.initiativeDiceModelKey,
              seed: this.seed,
              nonce: `${commandId}:${nextSequence}:initiative:${actorKey}`,
              modifier,
            });
            return {
              actorKey,
              rolledDice: rolled.dice,
              keptDice: rolled.keptDice,
              modifier,
              total: rolled.total,
              rollTrace: rolled.rollTrace,
              seedCommitment: rolled.seedCommitment,
              nonce: rolled.nonce,
              proofHash: rolled.proofHash,
            };
          }),
        );
        initiativeEntries.sort(
          (left, right) =>
            right.total - left.total ||
            left.actorKey.localeCompare(right.actorKey),
        );
        const turnOrder = initiativeEntries.map((entry) => entry.actorKey);
        const abilityResets = Object.entries(
          product.abilityStates ?? {},
        ).flatMap(([stateKey, before]) => {
          const action = this.rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("scene")) return [];
          return [
            {
              stateKey,
              before,
              after: resetTtrpgAbilityUsageV2({
                definition: {
                  abilityKey: action.key,
                  actionDefinitionKey: action.key,
                  usage: action.usage,
                },
                state: before,
                trigger: "scene",
                eventId: `event.${nextSequence}`,
              }),
            },
          ];
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.scene.opened",
          turnOrder[0],
          scene.locationKey,
          {
            scene: {
              sceneId: `campaign-scene:${scene.sceneKey}:${this.state.lastSequence + 1}`,
              sceneKey: scene.sceneKey,
              title: scene.title,
              description: scene.description,
              locationKey: scene.locationKey,
              status: "active",
            },
            turnOrder,
            abilityResets,
            initiative: {
              sceneKey: scene.sceneKey,
              diceModelKey: this.rulePack.turnStructure.initiativeDiceModelKey,
              attributeKey: this.rulePack.turnStructure.initiativeAttributeKey,
              entries: initiativeEntries,
            },
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, {
          sceneKey: scene.sceneKey,
          title: scene.title,
          description: scene.description,
          locationKey: scene.locationKey,
        });
      } else if (input.command.kind === "rule.action") {
        exact(
          payload,
          ["actionKey", "targetKey", "difficulty", "situationalModifier"],
          "rule.action.payload",
        );
        const actorKey =
          input.command.actorKey == null
            ? ""
            : key(input.command.actorKey, "actorKey");
        if (!actorKey) fail("domain_protocol", "rule.action 必须绑定 actorKey");
        const actorTemplate = this.campaign.characterTemplates.find(
          character => character.characterKey === actorKey,
        );
        if (
          input.member.role === "gm" &&
          actorTemplate?.role === "npc" &&
          (this.campaign.gmMode ?? "human") === "ai"
        ) {
          fail("domain_rejected", "AI KP 控制的 NPC 不能通过真人直提入口行动");
        }
        const result = await this.resolveAction({
          commandId,
          actionKey: key(payload.actionKey, "actionKey"),
          actorKey,
          targetKey:
            payload.targetKey == null
              ? null
              : key(payload.targetKey, "targetKey"),
          difficulty: optionalNumber(payload.difficulty, "difficulty"),
          situationalModifier:
            optionalNumber(
              payload.situationalModifier,
              "situationalModifier",
            ) ?? 0,
          rollVisibility: "public",
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.rule.action.resolved",
          actorKey,
          result.targetKey,
          { result },
          commandId,
        );
        visible = publicEvent(
          input.command.kind,
          createPublicTtrpgActionEventV1(result),
        );
        gmPrivatePayload = result;
        const targetMemberId = input.members.find(
          (member) => member.role === "player" && member.actorKey === actorKey,
        )?.memberId ?? this.memberIdForActor(actorKey);
        if (targetMemberId)
          privatePayloadByMemberId = {
            [targetMemberId]: createPrivateTtrpgActorActionEventV1(result),
          };
      } else if (input.command.kind === "intent.submit") {
        exact(
          payload,
          [
            "intentKey",
            "rawInput",
            "actionKey",
            "targetKey",
            "goal",
            "method",
            "difficulty",
            "situationalModifier",
            "rollVisibility",
          ],
          "intent.submit.payload",
        );
        const actorKey =
          input.command.actorKey == null
            ? ""
            : key(input.command.actorKey, "actorKey");
        if (!actorKey) fail("domain_protocol", "intent.submit 必须绑定 actorKey");
        const actorTemplate = this.campaign.characterTemplates.find(
          character => character.characterKey === actorKey,
        );
        if (
          input.member.role === "gm" &&
          actorTemplate?.role === "npc" &&
          (this.campaign.gmMode ?? "human") === "ai"
        ) {
          fail("domain_rejected", "AI KP 控制的 NPC 不能通过真人意图入口行动");
        }
        const intentKey = key(payload.intentKey, "intentKey");
        const rawInput = text(payload.rawInput, "rawInput", 10_000);
        const actionKey =
          payload.actionKey == null ? null : key(payload.actionKey, "actionKey");
        const targetKey =
          payload.targetKey == null ? null : key(payload.targetKey, "targetKey");
        const goal = payload.goal == null ? null : text(payload.goal, "goal", 2_000);
        const method =
          payload.method == null ? null : text(payload.method, "method", 2_000);
        const rollVisibility =
          payload.rollVisibility == null ? "public" : payload.rollVisibility;
        if (rollVisibility !== "public" && rollVisibility !== "gm-only")
          fail("domain_protocol", "rollVisibility 无效");
        const classification = classifyTtrpgSubmittedIntentV2({
          state: this.state,
          campaign: this.campaign,
          rulePack: this.rulePack,
          actorKey,
          actionKey,
          targetKey,
        });
        let terminal: TtrpgRuntimeRuleActionResultV1 | TtrpgRuntimeIntentReceiptV2;
        if (classification.status == null && actionKey) {
          const result = await this.resolveAction({
            commandId,
            actionKey,
            actorKey,
            targetKey,
            difficulty: optionalNumber(payload.difficulty, "difficulty"),
            situationalModifier:
              optionalNumber(payload.situationalModifier, "situationalModifier") ?? 0,
            rollVisibility,
            declaredIntent: { intentKey, rawInput, goal, method },
          });
          this.state = this.commitRuntimeTransition(
            "ttrpg.rule.action.resolved",
            actorKey,
            result.targetKey,
            { result },
            commandId,
          );
          terminal = result;
          visible = publicEvent(
            input.command.kind,
            createPublicTtrpgActionEventV1(result),
          );
        } else {
          const sequence = this.state.lastSequence + 1;
          const receipt: TtrpgRuntimeIntentReceiptV2 = {
            schema: "storyforge.ttrpg-intent-receipt",
            version: 2,
            receiptKey: `intent-receipt.${sequence}`,
            eventSequence: sequence,
            intentKey,
            actorKey,
            rawInput,
            proposedActionKey: actionKey,
            targetKey,
            terminalStatus: classification.status ?? "rejected-illegal",
            reason:
              classification.status == null
                ? "行动没有可执行的规则动作。"
                : classification.reason,
            suggestedActionKeys: classification.suggestedActionKeys,
          };
          this.state = this.commitRuntimeTransition(
            "ttrpg.intent.receipted",
            actorKey,
            targetKey,
            { receipt },
            commandId,
          );
          terminal = receipt;
          visible = publicEvent(input.command.kind, {
            actorKey,
            terminalStatus: receipt.terminalStatus,
            receiptKey: receipt.receiptKey,
          });
        }
        gmPrivatePayload = terminal;
        const targetMemberId = input.members.find(
          (member) => member.role === "player" && member.actorKey === actorKey,
        )?.memberId ?? this.memberIdForActor(actorKey);
        if (targetMemberId)
          privatePayloadByMemberId = {
            [targetMemberId]:
              "actionKey" in terminal
                ? createPrivateTtrpgActorActionEventV1(terminal)
                : terminal,
          };
      } else if (input.command.kind === "human.response") {
        const responseCommand = parseOnlineTtrpgHumanResponseCommandV1(payload);
        const actorKey =
          input.command.actorKey == null
            ? ""
            : key(input.command.actorKey, "actorKey");
        if (
          !actorKey ||
          input.member.role !== "player" ||
          input.member.actorKey !== actorKey
        ) {
          fail("forbidden", "真人回应必须来自角色本人的已认证玩家席位");
        }
        const product = this.state.ttrpg?.product;
        const sourceAction = product?.actionHistory.find(
          (action) => action.eventSequence === responseCommand.actionSequence,
        );
        const sourceReceipt = sourceAction?.receipt;
        const observer = sourceReceipt?.context.observers.find(
          (item) => item.actorKey === actorKey,
        );
        const promptWindow = sourceReceipt?.context.reactionWindows.some(
          (window) =>
            window.status !== "closed" &&
            window.layer === "immediate-character" &&
            window.humanConfirmationRequiredActorKeys.includes(actorKey),
        );
        if (
          !product?.sessionZero.completed ||
          product.ending ||
          product.safety.status !== "active" ||
          !product.sessionZero.selectedCharacterKeys.includes(actorKey)
        ) {
          fail("domain_rejected", "当前战役或席位不能提交真人角色回应");
        }
        if (
          !sourceReceipt ||
          sourceReceipt.receiptKey !== responseCommand.actionReceiptKey
        ) {
          fail("domain_rejected", "真人回应绑定的 ActionReceipt 不存在或已变化");
        }
        if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
          fail("domain_rejected", "该角色没有属于本人的开放回应窗口");
        }
        if (
          (product.humanResponses ?? []).some(
            (response) =>
              response.actionSequence === responseCommand.actionSequence &&
              response.actorKey === actorKey,
          )
        ) {
          fail("domain_rejected", "该真人角色已经回应本次行动");
        }
        const response: TtrpgRuntimeHumanResponseV2 = {
          schema: "storyforge.ttrpg-human-response",
          version: 2,
          responseKey: `human-response.${responseCommand.actionSequence}.${actorKey}`,
          eventSequence: this.state.lastSequence + 1,
          actionSequence: responseCommand.actionSequence,
          actionReceiptKey: responseCommand.actionReceiptKey,
          actorKey,
          kind: responseCommand.responseKind,
          text:
            responseCommand.responseKind === "decline"
              ? "本角色选择不作额外回应。"
              : responseCommand.text,
          audience: responseCommand.audience,
          viewerKey: `viewer.online:${input.member.memberId}`,
        };
        this.state = this.commitRuntimeTransition(
          "ttrpg.human-response.recorded",
          actorKey,
          sourceAction?.actorKey ?? null,
          { response },
          commandId,
        );
        const routed = createOnlineTtrpgHumanResponseVisiblePayloadsV1({
          response,
          ownerMemberId: input.member.memberId,
        });
        visible = publicEvent(input.command.kind, routed.publicPayload);
        gmPrivatePayload = routed.gmPrivatePayload;
        privatePayloadByMemberId = routed.privatePayloadByMemberId;
      } else if (input.command.kind === "item.command") {
        const actorKey =
          input.member.role === "gm"
            ? "gm"
            : input.command.actorKey == null
              ? ""
              : key(input.command.actorKey, "actorKey");
        if (!actorKey) fail("domain_protocol", "item.command 必须绑定操作者");
        const product = this.state.ttrpg?.product;
        if (!product?.sessionZero.completed || product.ending || !product.inventory) {
          fail("domain_rejected", "当前正式战役没有可操作库存");
        }
        const command = buildOnlineTtrpgItemCommandV1({
          payload,
          commandId,
          eventSequence: this.state.lastSequence + 1,
        });
        const prior = product.inventory.items[command.instanceId];
        if (
          input.member.role === "player" &&
          (!product.sessionZero.selectedCharacterKeys.includes(actorKey) ||
            !prior ||
            prior.ownerRef !== actorKey ||
            command.kind === "grant" ||
            command.kind === "remove")
        ) {
          fail("forbidden", "玩家只能操作自己持有的物品，授予与移除由 GM 负责");
        }
        const entityRefs =
          command.kind === "grant"
            ? [command.ownerRef, command.locationRef]
            : command.kind === "transfer"
              ? [command.expectedOwnerRef, command.destinationOwnerRef]
              : "expectedOwnerRef" in command
                ? [command.expectedOwnerRef]
                : [];
        if (entityRefs.some(ref => ref != null && !this.state.entities[ref])) {
          fail("domain_rejected", "物品所有者或地点不属于当前冻结运行时");
        }
        const definitions = Object.fromEntries(
          this.rulePack.items.map(item => [item.key, ttrpgItemDefinitionFromRuleV1(item)]),
        );
        const applied = applyTtrpgItemCommandV2({
          state: product.inventory,
          definitions,
          command,
        });
        if (applied.replayed) fail("domain_rejected", "物品命令已经执行");
        this.state = this.commitRuntimeTransition(
          "ttrpg.item.changed",
          actorKey,
          command.kind === "transfer"
            ? command.destinationOwnerRef
            : (prior?.ownerRef ?? command.instanceId),
          {
            command,
            requestedBy: {
              role: input.member.role === "gm" ? "gm" : "player",
              actorKey,
            },
            definitions: Object.fromEntries(
              this.rulePack.items.map(item => [item.key, item]),
            ),
          },
          commandId,
        );
        const receipt = this.state.ttrpg?.product?.itemHistory?.find(
          item => item.eventSequence === this.state.lastSequence,
        );
        if (!receipt) fail("domain_state", "物品命令没有生成正式回执");
        const routed = createOnlineTtrpgItemVisiblePayloadsV1({
          receipt,
          members: input.members,
          requesterMemberId: input.member.memberId,
        });
        visible = publicEvent(input.command.kind, routed.publicPayload);
        gmPrivatePayload = routed.gmPrivatePayload;
        privatePayloadByMemberId = routed.privatePayloadByMemberId;
      } else if (input.command.kind === "rest.complete") {
        const rest = parseOnlineTtrpgRestCommandV1(payload);
        const ttrpg = this.state.ttrpg;
        const product = ttrpg?.product;
        if (
          !product?.sessionZero.completed ||
          !product.abilityStates ||
          product.ending ||
          ttrpg?.encounter?.status === "active" ||
          (product.restHistory ?? []).some(item => item.restKey === rest.restKey) ||
          rest.actorKeys.some(actorKey => !product.sessionZero.selectedCharacterKeys.includes(actorKey))
        ) {
          fail("domain_rejected", "当前战役不能完成这次休息");
        }
        const nextSequence = this.state.lastSequence + 1;
        const abilityChanges: TtrpgRuntimeRestReceiptV2["abilityChanges"] =
          Object.entries(product.abilityStates).flatMap(([stateKey, before]) => {
            if (!rest.actorKeys.includes(before.actorInstanceId)) return [];
            const action = this.rulePack.actions.find(item => item.key === before.abilityKey);
            if (!action?.usage.reset.includes(rest.restKind)) return [];
            return [{
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after: resetTtrpgAbilityUsageV2({
                definition: {
                  abilityKey: action.key,
                  actionDefinitionKey: action.key,
                  usage: action.usage,
                },
                state: before,
                trigger: rest.restKind,
                eventId: `event.${nextSequence}`,
              }),
            }];
          });
        const receipt: TtrpgRuntimeRestReceiptV2 = {
          schema: "storyforge.ttrpg-rest-receipt",
          version: 2,
          eventSequence: nextSequence,
          restKey: rest.restKey,
          kind: rest.restKind,
          actorKeys: rest.actorKeys,
          completedBy: "gm",
          reason: rest.reason,
          abilityChanges,
        };
        this.state = this.commitRuntimeTransition(
          "ttrpg.rest.completed",
          "gm",
          rest.restKey,
          { receipt, rulePack: this.rulePack },
          commandId,
        );
        visible = publicEvent(
          input.command.kind,
          createOnlineTtrpgRestVisiblePayloadV1(receipt),
        );
        gmPrivatePayload = receipt;
      } else if (input.command.kind === "effects.apply") {
        const effectCommand = buildOnlineTtrpgEffectCommandV1({
          payload,
          commandId,
        });
        const product = this.state.ttrpg?.product;
        if (
          !product?.sessionZero.completed ||
          product.ending ||
          !product.effectLedger
        ) {
          fail("domain_rejected", "当前正式战役没有可提交的效果账本");
        }
        const sourceAction = product.actionHistory.find(
          action => action.eventSequence === effectCommand.actionSequence,
        );
        if (
          !sourceAction ||
          effectCommand.plan.sourceEventId !== `event.${effectCommand.actionSequence}` ||
          effectCommand.plan.ruleRef !== sourceAction.actionKey
        ) {
          fail("domain_rejected", "行动后果必须精确引用已经提交的规则行动");
        }
        const expectedDegree = sourceAction.outcome === "automatic"
          ? "success"
          : sourceAction.outcome;
        if (effectCommand.plan.degree !== expectedDegree) {
          fail("domain_rejected", "行动后果等级与冻结判定结果不一致");
        }
        if (product.effectLedger.entries.some(
          entry => entry.sourceEventId === effectCommand.plan.sourceEventId,
        ) || product.effectLedger.pendingChoices.some(
          choice => choice.plan.sourceEventId === effectCommand.plan.sourceEventId,
        )) {
          fail("domain_rejected", "该规则行动已经提交过唯一后果计划");
        }
        applyTtrpgEffectPlanToRuntimeV2({
          state: this.state,
          rulePack: this.rulePack,
          plan: effectCommand.plan,
          eventSequence: this.state.lastSequence + 1,
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.effects.applied",
          effectCommand.plan.audience.startsWith("actor:")
            ? effectCommand.plan.audience.slice("actor:".length)
            : null,
          effectCommand.plan.effects[0]?.targetRef ?? product.campaignKey,
          { plan: effectCommand.plan, rulePack: this.rulePack },
          commandId,
        );
        const entry = this.state.ttrpg?.product?.effectLedger?.entries.find(
          item => item.eventSequence === this.state.lastSequence,
        );
        if (!entry) fail("domain_state", "后果计划没有生成正式效果账本回执");
        const routed = createOnlineTtrpgEffectVisiblePayloadsV1({
          entry,
          members: input.members,
        });
        visible = publicEvent(input.command.kind, routed.publicPayload);
        gmPrivatePayload = routed.gmPrivatePayload;
        privatePayloadByMemberId = routed.privatePayloadByMemberId;
      } else if (input.command.kind === "effects.choice.propose") {
        const proposal = buildOnlineTtrpgEffectChoiceProposalCommandV1({ payload, commandId });
        const proposed = proposeTtrpgEffectChoiceToRuntimeV2({
          state: this.state,
          plan: proposal.plan,
          actionSequence: proposal.actionSequence,
          ownerActorKey: proposal.ownerActorKey,
          eventSequence: this.state.lastSequence + 1,
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.effects.choice.proposed",
          "gm",
          proposal.ownerActorKey,
          {
            plan: proposal.plan,
            actionSequence: proposal.actionSequence,
            ownerActorKey: proposal.ownerActorKey,
          },
          commandId,
        );
        const choice = this.state.ttrpg?.product?.effectLedger?.pendingChoices.find(
          item => item.choiceKey === proposed.choice.choiceKey,
        );
        if (!choice) fail("domain_state", "后果选择提议没有进入正式账本");
        const routed = createOnlineTtrpgEffectChoiceVisiblePayloadsV1({ choice, members: input.members });
        visible = publicEvent(input.command.kind, routed.publicPayload);
        gmPrivatePayload = routed.gmPrivatePayload;
        privatePayloadByMemberId = routed.privatePayloadByMemberId;
      } else if (input.command.kind === "effects.choice.resolve") {
        const resolution = parseOnlineTtrpgEffectChoiceResolutionCommandV1(payload);
        const choice = this.state.ttrpg?.product?.effectLedger?.pendingChoices.find(
          item => item.choiceKey === resolution.choiceKey,
        );
        if (!choice || input.command.actorKey !== choice.ownerActorKey) {
          fail("domain_rejected", "待选择后果不存在或不属于该角色");
        }
        const playerTemplate = this.campaign.characterTemplates.find(
          item => item.role === "player" && item.characterKey === choice.ownerActorKey,
        );
        if (input.member.role === "gm" && playerTemplate?.controller !== "ai") {
          fail("domain_rejected", "GM 只能代纯 AI 玩家席位确认后果选择");
        }
        if (input.member.role === "player" && input.member.actorKey !== choice.ownerActorKey) {
          fail("domain_rejected", "玩家只能确认自己角色的后果选择");
        }
        const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
          state: this.state,
          rulePack: this.rulePack,
          choiceKey: resolution.choiceKey,
          selectedEffectKey: resolution.selectedEffectKey,
          commandId,
          eventSequence: this.state.lastSequence + 1,
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.effects.applied",
          choice.ownerActorKey,
          resolved.plan.effects[0].targetRef,
          {
            choiceKey: resolution.choiceKey,
            selectedEffectKey: resolution.selectedEffectKey,
            requestedBy: { role: input.member.role, actorKey: choice.ownerActorKey },
            plan: resolved.plan,
            rulePack: this.rulePack,
          },
          commandId,
        );
        const entry = this.state.ttrpg?.product?.effectLedger?.entries.find(
          item => item.eventSequence === this.state.lastSequence,
        );
        if (!entry) fail("domain_state", "玩家后果选择没有生成正式效果账本回执");
        const routed = createOnlineTtrpgEffectVisiblePayloadsV1({ entry, members: input.members });
        visible = publicEvent(input.command.kind, routed.publicPayload);
        gmPrivatePayload = routed.gmPrivatePayload;
        privatePayloadByMemberId = routed.privatePayloadByMemberId;
      } else if (input.command.kind === "campaign.session.start") {
        const start = parseOnlineTtrpgCampaignSessionStartV1(payload);
        const ttrpg = this.state.ttrpg;
        const product = ttrpg?.product;
        const campaignState = ttrpg?.campaign;
        if (
          !product?.sessionZero.completed ||
          product.ending ||
          !campaignState ||
          campaignState.activeSessionKey != null
        ) fail("domain_rejected", "当前正式战役不能开始新的长期分场");
        const participantKeys = campaignState.roster
          .filter(entry => entry.status === "active")
          .map(entry => entry.characterKey);
        if (!participantKeys.length) fail("domain_rejected", "长期分场没有活动角色编组");
        const ordinal = campaignState.playSessions.length + 1;
        const sessionKey = `session.${ordinal}`;
        this.state = this.commitRuntimeTransition(
          "ttrpg.campaign.session.started",
          "gm",
          product.campaignKey,
          {
            playSession: {
              sessionKey,
              ordinal,
              title: start.title,
              status: "active",
              participantKeys,
              startedSequence: this.state.lastSequence + 1,
              completedSequence: null,
              summary: "",
              rulePackContentHash: product.rulePackContentHash,
              campaignKey: product.campaignKey,
            },
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, {
          sessionKey, ordinal, title: start.title, participantKeys, status: "active",
        });
        gmPrivatePayload = { sessionKey, ordinal, title: start.title, participantKeys };
      } else if (input.command.kind === "campaign.session.complete") {
        const completion = parseOnlineTtrpgCampaignSessionCompleteV1(payload);
        const ttrpg = this.state.ttrpg;
        const product = ttrpg?.product;
        const campaignState = ttrpg?.campaign;
        const sessionKey = campaignState?.activeSessionKey;
        const playSession = campaignState?.playSessions.find(item => item.sessionKey === sessionKey);
        if (!product?.sessionZero.completed || !campaignState || !sessionKey || !playSession) {
          fail("domain_rejected", "当前没有可完成的长期战役分场");
        }
        if (
          completion.memoryAudience.startsWith("actor:") &&
          !playSession.participantKeys.includes(completion.memoryAudience.slice("actor:".length))
        ) fail("domain_protocol", "跨场私人记忆必须属于本场参与角色");
        const automatic = createTtrpgAutomaticSessionRecapsV2({
          state: this.state,
          campaign: this.campaign,
          rulePack: this.rulePack,
          sessionKey,
          participantKeys: playSession.participantKeys,
        });
        const summary = completion.publicNote
          ? `${automatic.publicSummary}\n主持公开补充：${completion.publicNote}`.slice(0, 20_000)
          : automatic.publicSummary;
        const nextSequence = this.state.lastSequence + 1;
        const memories = [
          ...automatic.memories,
          ...(completion.memorySummary ? [{
            memoryKey: `memory.${sessionKey}.online.${nextSequence}`,
            subjectKey: completion.memoryAudience.startsWith("actor:")
              ? completion.memoryAudience.slice("actor:".length)
              : product.campaignKey,
            summary: completion.memorySummary,
            audience: completion.memoryAudience,
          }] : []),
        ].map(memory => ({
          ...memory,
          sourceSessionKey: sessionKey,
          updatedSequence: nextSequence,
        }));
        const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
          ([stateKey, before]) => {
            const action = this.rulePack.actions.find(item => item.key === before.abilityKey);
            if (!action?.usage.reset.includes("session")) return [];
            return [{
              stateKey,
              before: structuredClone(before),
              after: resetTtrpgAbilityUsageV2({
                definition: { abilityKey: action.key, actionDefinitionKey: action.key, usage: action.usage },
                state: before,
                trigger: "session",
                eventId: `event.${nextSequence}`,
              }),
            }];
          },
        );
        this.state = this.commitRuntimeTransition(
          "ttrpg.campaign.session.completed",
          "gm",
          sessionKey,
          { sessionKey, summary, memories, abilityResets },
          commandId,
        );
        visible = publicEvent(input.command.kind, { sessionKey, status: "completed", summary });
        gmPrivatePayload = {
          sessionKey, status: "completed", summary,
          gmSummary: automatic.gmSummary,
          privateMemory: completion.memorySummary || null,
          privateMemoryAudience: completion.memorySummary ? completion.memoryAudience : null,
        };
      } else if (input.command.kind === "ai.player.run") {
        const objective = parseOnlineTtrpgAiPlayerObjectiveV1(payload);
        if (!this.aiPlayerService) {
          fail("domain_configuration", "权威房间没有配置 AI 玩家模型服务");
        }
        const actorKey = this.state.ttrpg?.activeActorKey;
        const template = this.campaign.characterTemplates.find(
          character => character.characterKey === actorKey,
        );
        if (
          !actorKey ||
          !template ||
          template.role !== "player" ||
          template.controller !== "ai" ||
          input.members.some(member => member.role === "player" && member.actorKey === actorKey)
        ) {
          fail("domain_rejected", "当前行动者不是无人类占用的冻结 AI 玩家席位");
        }
        const participantControllers = Object.fromEntries(
          this.campaign.characterTemplates.flatMap(character =>
            character.role === "player"
              ? [[character.characterKey, character.controller === "ai" ? "ai" : character.controller === "open" ? "vacant" : "human"]]
              : [],
          ),
        ) as Record<string, "human" | "ai" | "vacant">;
        const projection = createTtrpgViewerProjectionV1({
          state: this.state,
          campaign: this.campaign,
          rulePack: this.rulePack,
          role: "player",
          actorKey,
          participantControllers,
        });
        const contextManifestHash = await hashCanonicalValue({
          releaseHash: this.releaseHash,
          baseSequence: this.state.lastSequence,
          actorKey,
          projection,
        });
        const proposal = parseOnlineTtrpgAiPlayerProposalV1({
          value: await this.aiPlayerService.propose({
            roomId: this.roomId,
            releaseHash: this.releaseHash,
            actorKey,
            objective,
            projection,
          }),
          projection,
          actorKey,
        });
        const candidateHash = await hashCanonicalValue({
          runId: proposal.runId,
          actorKey,
          objective,
          contextManifestHash,
          actionKey: proposal.actionKey,
          targetKey: proposal.targetKey,
          approach: proposal.approach,
          spokenIntent: proposal.spokenIntent,
        });
        const action = projection.availableActions.find(item => item.actionKey === proposal.actionKey)!;
        const result = await this.resolveAction({
          commandId,
          actionKey: proposal.actionKey,
          actorKey,
          targetKey: proposal.targetKey,
          difficulty: action.defaultDifficulty ?? undefined,
          situationalModifier: 0,
          rollVisibility: "public",
          declaredIntent: {
            intentKey: `online-ai.${proposal.runId}.${this.state.lastSequence + 1}`,
            rawInput: proposal.spokenIntent
              ? `${proposal.approach}\n角色发言：${proposal.spokenIntent}`
              : proposal.approach,
            goal: objective,
            method: proposal.approach,
          },
          actorAuthority: {
            source: "ai-player",
            viewerKey: `viewer.online-ai:${actorKey}`,
            runId: proposal.runId,
            candidateHash,
            contextManifestHash,
            approach: proposal.approach,
            spokenIntent: proposal.spokenIntent,
          },
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.rule.action.resolved",
          actorKey,
          result.targetKey,
          { result },
          commandId,
        );
        visible = publicEvent(input.command.kind, createPublicTtrpgActionEventV1(result));
        gmPrivatePayload = result;
      } else if (input.command.kind === "ai.gm.act") {
        const objective = parseOnlineTtrpgAiGmActorObjectiveV1(payload);
        if (!this.aiGmService) {
          fail("domain_configuration", "权威房间没有配置 AI GM 模型服务");
        }
        const actorKey = this.state.ttrpg?.activeActorKey;
        const template = this.campaign.characterTemplates.find(
          character => character.characterKey === actorKey,
        );
        const gmMode = this.campaign.gmMode ?? "human";
        if (!actorKey || template?.role !== "npc" || !["ai", "hybrid"].includes(gmMode)) {
          fail("domain_rejected", "当前行动者不是 AI / 混合 KP 控制的冻结 NPC");
        }
        const participantControllers = Object.fromEntries(
          this.campaign.characterTemplates.flatMap(character =>
            character.role === "player"
              ? [[character.characterKey, character.controller === "ai" ? "ai" : character.controller === "open" ? "vacant" : "human"]]
              : [],
          ),
        ) as Record<string, "human" | "ai" | "vacant">;
        const projection = createTtrpgViewerProjectionV1({
          state: this.state,
          campaign: this.campaign,
          rulePack: this.rulePack,
          role: "gm",
          actorKey: null,
          participantControllers,
        });
        const contextManifestHash = await hashCanonicalValue({
          releaseHash: this.releaseHash,
          baseSequence: this.state.lastSequence,
          actorKey,
          projection,
        });
        const proposal = parseOnlineTtrpgAiGmActorProposalV1({
          value: await this.aiGmService.act({
            roomId: this.roomId,
            releaseHash: this.releaseHash,
            actorKey,
            objective,
            projection,
          }),
          projection,
          actorKey,
        });
        const candidateHash = await hashCanonicalValue({
          runId: proposal.runId,
          actorKey,
          objective,
          contextManifestHash,
          actionKey: proposal.actionKey,
          targetKey: proposal.targetKey,
          approach: proposal.approach,
          spokenIntent: proposal.spokenIntent,
        });
        const action = projection.availableActions.find(
          item => item.actionKey === proposal.actionKey,
        )!;
        const result = await this.resolveAction({
          commandId,
          actionKey: proposal.actionKey,
          actorKey,
          targetKey: proposal.targetKey,
          difficulty: action.defaultDifficulty ?? undefined,
          situationalModifier: 0,
          rollVisibility: "public",
          declaredIntent: {
            intentKey: `online-ai-gm.${proposal.runId}.${this.state.lastSequence + 1}`,
            rawInput: proposal.spokenIntent
              ? `${proposal.approach}\n角色发言：${proposal.spokenIntent}`
              : proposal.approach,
            goal: objective,
            method: proposal.approach,
          },
          actorAuthority: {
            source: gmMode === "ai" ? "ai-gm-npc" : "hybrid-gm-confirmed",
            viewerKey: "viewer.online-gm",
            runId: proposal.runId,
            candidateHash,
            contextManifestHash,
            approach: proposal.approach,
            spokenIntent: proposal.spokenIntent,
          },
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.rule.action.resolved",
          actorKey,
          result.targetKey,
          { result },
          commandId,
        );
        visible = publicEvent(input.command.kind, createPublicTtrpgActionEventV1(result));
        gmPrivatePayload = result;
      } else if (input.command.kind === "ai.gm.narrate") {
        const objective = parseOnlineTtrpgAiGmObjectiveV1(payload);
        if (!this.aiGmService) fail("domain_configuration", "权威房间没有配置 AI GM 模型服务");
        const product = this.state.ttrpg?.product;
        const action = product?.actionHistory[product.actionHistory.length - 1];
        const receipt = action?.receipt;
        if (
          !product?.sessionZero.completed ||
          product.ending ||
          !action ||
          !receipt ||
          product.gmNarrations.some(item => item.actionSequence === action.eventSequence)
        ) fail("domain_rejected", "当前没有等待 AI GM 反馈的最近规则行动");
        const projection = createTtrpgViewerProjectionV1({
          state: this.state,
          campaign: this.campaign,
          rulePack: this.rulePack,
          role: "gm",
          actorKey: null,
        });
        const proposal = parseOnlineTtrpgAiGmProposalV1({
          value: await this.aiGmService.narrate({
            roomId: this.roomId,
            releaseHash: this.releaseHash,
            objective,
            projection,
            action: structuredClone(action),
          }),
          action,
          receipt,
        });
        const candidateHash = await hashCanonicalValue({
          runId: proposal.runId,
          releaseHash: this.releaseHash,
          baseSequence: this.state.lastSequence,
          actionSequence: action.eventSequence,
          objective,
          text: proposal.text,
          synthesisFrame: proposal.synthesisFrame,
          modelEvidence: proposal.modelEvidence,
        });
        this.state = this.commitRuntimeTransition(
          "ttrpg.gm.response.recorded",
          null,
          action.actorKey,
          {
            actionSequence: action.eventSequence,
            checkSequence: action.check?.eventSequence ?? null,
            text: proposal.text,
            candidateHash,
            runId: proposal.runId,
            modelEvidence: proposal.modelEvidence,
            modelCalls: [proposal.modelEvidence],
            repairApplied: false,
            synthesisFrame: proposal.synthesisFrame,
            source: "ai-confirmed",
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, {
          actionSequence: action.eventSequence,
          text: proposal.text,
          source: "ai-confirmed",
        });
        gmPrivatePayload = {
          actionSequence: action.eventSequence,
          text: proposal.text,
          source: "ai-confirmed",
          runId: proposal.runId,
          candidateHash,
          modelEvidence: proposal.modelEvidence,
          synthesisFrame: proposal.synthesisFrame,
        };
      } else if (input.command.kind === "clue.reveal") {
        exact(
          payload,
          ["clueKey", "actorKey", "visibility"],
          "clue.reveal.payload",
        );
        const clueKey = key(payload.clueKey, "clueKey");
        const actorKey = key(payload.actorKey, "actorKey");
        const visibility = payload.visibility;
        if (visibility !== "private" && visibility !== "party")
          fail("domain_protocol", "visibility 无效");
        const scene = this.campaign.scenes.find(
          (item) => item.sceneKey === this.state.ttrpg?.scene?.sceneKey,
        );
        const clue = this.campaign.clues.find(
          (item) => item.clueKey === clueKey,
        );
        if (
          !scene?.clueKeys.includes(clueKey) ||
          !clue ||
          clue.visibility === "gm-only" ||
          (clue.visibility === "public" && visibility !== "party")
        )
          fail("domain_rejected", "当前场景不能公开该线索");
        this.state = this.commitRuntimeTransition(
          "ttrpg.clue.discovered",
          actorKey,
          clueKey,
          { clueKey, actorKey, visibility },
          commandId,
        );
        const disclosed = {
          clueKey,
          title: clue.title,
          description: clue.description,
          conclusionKey: clue.conclusionKey,
          actorKey,
          visibility,
        };
        if (visibility === "party")
          visible = publicEvent(input.command.kind, disclosed);
        else {
          visible = publicEvent(input.command.kind, {
            visibility: "private",
            discovered: true,
          });
          gmPrivatePayload = disclosed;
          const targetMemberId =
            input.member.role === "player"
              ? input.member.memberId
              : (input.members.find(
                  (member) =>
                    member.role === "player" && member.actorKey === actorKey,
                )?.memberId ?? this.memberIdForActor(actorKey));
          if (targetMemberId)
            privatePayloadByMemberId = { [targetMemberId]: disclosed };
        }
      } else if (input.command.kind === "gm.narrate") {
        exact(payload, ["actionSequence", "text"], "gm.narrate.payload");
        if (
          !Number.isInteger(payload.actionSequence) ||
          Number(payload.actionSequence) < 1
        )
          fail("domain_protocol", "actionSequence 无效");
        const narration = text(payload.text, "text", 20_000);
        const latest =
          this.state.ttrpg?.product?.actionHistory[
            this.state.ttrpg.product.actionHistory.length - 1
          ];
        if (!latest || latest.eventSequence !== Number(payload.actionSequence))
          fail("domain_rejected", "叙事必须绑定最近规则行动");
        this.state = this.commitRuntimeTransition(
          "ttrpg.gm.response.recorded",
          input.member.memberId,
          null,
          {
            actionSequence: latest.eventSequence,
            checkSequence: latest.check?.eventSequence ?? null,
            text: narration,
            source: "human-gm",
            candidateHash: null,
            runId: null,
            modelEvidence: null,
            modelCalls: [],
            repairApplied: false,
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, {
          actionSequence: latest.eventSequence,
          text: narration,
          source: "human-gm",
        });
      } else if (input.command.kind === "ending.choose") {
        exact(payload, ["endingKey"], "ending.choose.payload");
        const endingKey = key(payload.endingKey, "endingKey");
        const ending = this.campaign.endings.find(
          (item) => item.endingKey === endingKey,
        );
        const product = this.state.ttrpg?.product;
        const scene = this.campaign.scenes.find(
          (item) => item.sceneKey === this.state.ttrpg?.scene?.sceneKey,
        );
        if (
          !ending ||
          !product ||
          scene?.nextSceneKeys.length !== 0 ||
          product.questProgress.some((item) => item.status !== "completed")
        )
          fail("domain_rejected", "结局条件未满足");
        const awardedMilestones = product.advancement.milestones
          .filter(
            (item) =>
              !product.advancement.awardedMilestoneKeys.includes(
                item.milestoneKey,
              ),
          )
          .map((item) => ({
            milestoneKey: item.milestoneKey,
            award: item.award,
          }));
        this.state = this.commitRuntimeTransition(
          "ttrpg.campaign.ended",
          input.member.memberId,
          endingKey,
          {
            endingKey,
            title: ending.title,
            epilogue: ending.epilogue,
            awardedMilestones,
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, {
          endingKey,
          title: ending.title,
          epilogue: ending.epilogue,
        });
      } else if (input.command.kind === "chat.message") {
        exact(payload, ["text"], "chat.message.payload");
        const entry: DurableTtrpgChatEntryV1 = {
          sequence: input.sequence,
          memberId: input.member.memberId,
          displayName: input.member.displayName,
          role: input.member.role,
          actorKey: input.member.actorKey,
          text: text(payload.text, "text", 4_000),
        };
        this.chat.push(entry);
        if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500);
        visible = publicEvent(input.command.kind, entry);
      } else if (input.command.kind === "dice.request") {
        exact(payload, ["expression"], "dice.request.payload");
        const receipt = await this.dice.roll(
          text(payload.expression, "expression", 32),
        );
        visible = publicEvent(input.command.kind, {
          actorKey: input.command.actorKey,
          requestedBy: input.member.memberId,
          receipt,
        });
      } else if (
        input.command.kind === "tabletop.move" ||
        input.command.kind === "tabletop.fog" ||
        input.command.kind === "tabletop.layer"
      ) {
        const operation =
          input.command.kind === "tabletop.move"
            ? (exact(payload, ["tokenKey", "x", "y"], "tabletop.move.payload"),
              {
                kind: "move-token" as const,
                tokenKey: key(payload.tokenKey, "tokenKey"),
                x: optionalNumber(payload.x, "x")!,
                y: optionalNumber(payload.y, "y")!,
              })
            : input.command.kind === "tabletop.fog"
              ? (exact(payload, ["fogKey", "revealed"], "tabletop.fog.payload"),
                {
                  kind: "set-fog" as const,
                  fogKey: key(payload.fogKey, "fogKey"),
                  revealed: payload.revealed === true,
                })
              : (exact(
                  payload,
                  ["layerKey", "visible"],
                  "tabletop.layer.payload",
                ),
                {
                  kind: "set-layer" as const,
                  layerKey: key(payload.layerKey, "layerKey"),
                  visible: payload.visible === true,
                });
        if (
          (input.command.kind === "tabletop.fog" &&
            typeof payload.revealed !== "boolean") ||
          (input.command.kind === "tabletop.layer" &&
            typeof payload.visible !== "boolean")
        ) {
          fail("domain_protocol", "桌面布尔字段无效");
        }
        const actorKey =
          input.member.role === "gm"
            ? input.member.memberId
            : (input.command.actorKey ?? input.member.memberId);
        const operationTarget =
          operation.kind === "move-token"
            ? operation.tokenKey
            : operation.kind === "set-fog"
              ? operation.fogKey
              : operation.layerKey;
        this.state = this.commitRuntimeTransition(
          "ttrpg.tabletop.updated",
          actorKey,
          operationTarget,
          {
            role: input.member.role === "gm" ? "gm" : "player",
            actorKey,
            operation,
          },
          commandId,
        );
        visible = publicEvent(input.command.kind, { tabletopUpdated: true });
      }
    } catch (error) {
      if (error instanceof OnlineRoomAuthorityError) throw error;
      fail(
        "domain_rejected",
        error instanceof Error ? error.message : "正式 TTRPG 命令被拒绝",
      );
    }
    const resultingStateHash = await hashCanonicalValue({
      releaseHash: this.releaseHash,
      roomSequence: input.sequence,
      productRuntimeState: this.state,
      chat: this.chat,
      diceNextRollIndex: this.dice.exportServerCheckpoint().nextRollIndex,
    });
    return {
      ...visible,
      gmPrivatePayload,
      privatePayloadByMemberId,
      resultingStateHash,
    };
  }

  async project(
    input: Parameters<OnlineRoomDomainAdapterV1["project"]>[0],
  ): Promise<unknown> {
    if (input.roomId !== this.roomId || input.releaseHash !== this.releaseHash)
      fail("release_mismatch", "投影房间或 Release 不匹配");
    return {
      schema: "storyforge.online-ttrpg-projection",
      version: 1,
      roomSequence: input.sequence,
      campaign: createTtrpgViewerProjectionV1({
        state: this.state,
        campaign: this.campaign,
        rulePack: this.rulePack,
        role: input.member.role,
        actorKey: input.member.actorKey,
      }),
      recentChat: structuredClone(this.chat.slice(-100)),
      diceCommitments: structuredClone(this.dice.commitments),
    };
  }

  async exportCheckpoint(): Promise<DurableFormalTtrpgCheckpointV1> {
    const body = {
      schema: "storyforge.durable-formal-ttrpg-checkpoint" as const,
      version: 1 as const,
      roomId: this.roomId,
      releaseHash: this.releaseHash,
      rulePackHash: this.rulePackHash,
      campaignHash: this.campaignHash,
      seed: this.seed,
      state: structuredClone(this.state),
      chat: structuredClone(this.chat),
      dice: this.dice.exportServerCheckpoint(),
    };
    return { ...body, integrityHash: await hashCanonicalValue(body) };
  }

  async restoreCheckpoint(value: unknown): Promise<void> {
    const checkpoint = record(
      value,
      "checkpoint",
    ) as unknown as DurableFormalTtrpgCheckpointV1;
    const { integrityHash, ...body } = checkpoint;
    if (
      checkpoint.schema !== "storyforge.durable-formal-ttrpg-checkpoint" ||
      checkpoint.version !== 1 ||
      checkpoint.roomId !== this.roomId ||
      checkpoint.releaseHash !== this.releaseHash ||
      checkpoint.rulePackHash !== this.rulePackHash ||
      checkpoint.campaignHash !== this.campaignHash ||
      checkpoint.seed !== this.seed ||
      typeof integrityHash !== "string" ||
      (await hashCanonicalValue(body)) !== integrityHash ||
      !Array.isArray(checkpoint.chat) ||
      checkpoint.chat.length > 500
    )
      fail("snapshot_corrupt", "TTRPG domain checkpoint 无效或损坏");
    this.state = parseProductRuntimeState(checkpoint.state);
    this.chat = structuredClone(checkpoint.chat);
    this.dice = await VerifiableOnlineDiceV1.restore(checkpoint.dice);
  }

  private commitRuntimeTransition(
    type: ProductRuntimeEventType,
    actorKey: string | null,
    targetKey: string | null,
    payload: unknown,
    commandId: string,
  ): ProductRuntimeState {
    const event: ProductRuntimeEvent = {
      projectId: 0,
      sessionId: 0,
      sequence: this.state.lastSequence + 1,
      type,
      actorKey,
      targetKey,
      commandId,
      payloadJson: JSON.stringify(payload),
      createdAt: Date.now(),
    };
    return applyProductRuntimeEvent(this.state, event);
  }

  private async resolveAction(input: {
    commandId: string;
    actionKey: string;
    actorKey: string;
    targetKey: string | null;
    difficulty?: number;
    situationalModifier: number;
    rollVisibility: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal: string | null;
      method: string | null;
    } | null;
    actorAuthority?: TtrpgRuntimeRuleActionResultV1["actorAuthority"];
  }): Promise<TtrpgRuntimeRuleActionResultV1> {
    const ttrpg = this.state.ttrpg;
    const product = ttrpg?.product;
    const scene = this.campaign.scenes.find(
      (item) => item.sceneKey === ttrpg?.scene?.sceneKey,
    );
    const action = this.rulePack.actions.find(
      (item) => item.key === input.actionKey,
    );
    const template = this.campaign.characterTemplates.find(
      (item) => item.characterKey === input.actorKey,
    );
    if (
      !ttrpg ||
      !product ||
      !scene ||
      !action ||
      !template ||
      !scene.actionKeys.includes(action.key)
    )
      fail("domain_rejected", "当前角色/场景/回合没有该冻结行动");
    if (
      input.rollVisibility === "gm-only" &&
      product.hiddenDicePolicy === "never"
    ) {
      fail("domain_rejected", "冻结 CampaignPack 不允许暗骰");
    }
    let economyTransition: ReturnType<typeof spendTtrpgActionEconomyV2> | null =
      null;
    try {
      economyTransition = product.actionEconomy
        ? spendTtrpgActionEconomyV2({
            economy: product.actionEconomy,
            turnOrder: ttrpg.turnOrder,
            actorKey: input.actorKey,
            phase: action.phase,
          })
        : null;
    } catch (cause) {
      fail(
        "domain_rejected",
        cause instanceof Error ? cause.message : "行动经济拒绝该行动",
      );
    }
    if (!economyTransition && ttrpg.activeActorKey !== input.actorKey) {
      fail("domain_rejected", "当前还没轮到该行动者");
    }
    const inventoryItemKeys =
      product.inventory == null
        ? template.itemKeys
        : Object.values(product.inventory.items)
            .filter(
              (item) =>
                item.ownerRef === input.actorKey &&
                !item.stateTags.includes("broken"),
            )
            .map((item) => item.definitionRef);
    const granted =
      template.actionKeys.includes(action.key) ||
      inventoryItemKeys.some((itemKey) =>
        this.rulePack.items
          .find((item) => item.key === itemKey)
          ?.grantedActionKeys.includes(action.key),
      );
    if (!granted) fail("domain_rejected", "角色卡没有该行动");
    let targetKey = input.targetKey;
    if (action.target === "self") targetKey = input.actorKey;
    else if (action.target === "scene") targetKey = null;
    else if (
      !targetKey ||
      targetKey === input.actorKey ||
      !ttrpg.turnOrder.includes(targetKey)
    ) {
      fail("domain_rejected", "单体行动必须选择当前场景中的另一名目标");
    }
    const resourceChanges: TtrpgRuntimeRuleActionResultV1["resourceChanges"] =
      [];
    const resourceCurrent = (entityKey: string, resourceKey: string) => {
      const prior = [...resourceChanges]
        .reverse()
        .find(
          (item) =>
            item.entityKey === entityKey && item.resourceKey === resourceKey,
        );
      if (prior) return { current: prior.after, maximum: prior.maximum };
      const entity = this.state.entities[entityKey];
      const current = entity?.attributes[`resource.${resourceKey}`];
      const maximum = entity?.attributes[`resourceMax.${resourceKey}`];
      if (
        !Number.isInteger(current) ||
        !Number.isInteger(maximum) ||
        Number(maximum) <= 0
      ) {
        fail("domain_rejected", `角色缺少规则资源:${entityKey}.${resourceKey}`);
      }
      return { current: Number(current), maximum: Number(maximum) };
    };
    const addResource = (
      entityKey: string,
      resourceKey: string,
      delta: number,
      proofHash: string | null,
    ) => {
      const { current, maximum } = resourceCurrent(entityKey, resourceKey);
      const after = Math.max(0, Math.min(maximum, current + delta));
      resourceChanges.push({
        entityKey,
        resourceKey,
        before: current,
        delta,
        after,
        maximum,
        proofHash,
      });
    };
    const sequence = this.state.lastSequence + 1;
    const abilityStateKey = ttrpgAbilityStateKeyV2(
      input.actorKey,
      input.actionKey,
    );
    const beforeAbility = product.abilityStates?.[abilityStateKey];
    if (!beforeAbility)
      fail("domain_rejected", `角色缺少冻结能力次数账本:${abilityStateKey}`);
    const sharedPoolKey = action.usage.sharedPoolKey;
    const beforeSharedPool =
      sharedPoolKey == null
        ? null
        : (product.usagePools?.[sharedPoolKey] ?? null);
    const abilityUse = consumeTtrpgAbilityV2({
      definition: {
        abilityKey: action.key,
        actionDefinitionKey: action.key,
        usage: action.usage,
      },
      state: beforeAbility,
      eventId: `event.${sequence}`,
      currentRound: ttrpg.round,
      resourceCurrent:
        action.usage.resourceKey == null
          ? null
          : resourceCurrent(input.actorKey, action.usage.resourceKey).current,
      sharedPool: beforeSharedPool,
    });
    if (abilityUse.resourceDelta !== 0 && action.usage.resourceKey) {
      addResource(
        input.actorKey,
        action.usage.resourceKey,
        abilityUse.resourceDelta,
        null,
      );
    }
    const abilityChange: TtrpgRuntimeRuleActionResultV1["abilityChange"] = {
      stateKey: abilityStateKey,
      before: structuredClone(beforeAbility),
      after: abilityUse.state,
      sharedPoolKey,
      sharedPoolBefore:
        beforeSharedPool == null ? null : structuredClone(beforeSharedPool),
      sharedPoolAfter: abilityUse.sharedPool,
    };
    if (action.costResourceKey && action.costAmount > 0) {
      if (
        resourceCurrent(input.actorKey, action.costResourceKey).current <
        action.costAmount
      ) {
        fail("domain_rejected", `${action.name}所需资源不足`);
      }
      addResource(
        input.actorKey,
        action.costResourceKey,
        -action.costAmount,
        null,
      );
    }
    const checkEffect = action.effects.filter(
      (effect): effect is Extract<typeof effect, { kind: "check" }> =>
        effect.kind === "check",
    );
    if (checkEffect.length > 1)
      fail("domain_rejected", "v1 规则行动最多包含一个检定");
    const activeConditions = product.conditions[input.actorKey] ?? [];
    const conditionModifier = activeConditions.reduce(
      (sum, condition) =>
        sum +
        (this.rulePack.conditions.find(
          (item) => item.key === condition.conditionKey,
        )?.checkModifier ?? 0) *
          condition.stacks,
      0,
    );
    let check: TtrpgRuntimeRuleActionResultV1["check"] = null;
    let outcome: TtrpgRuntimeRuleActionResultV1["outcome"] = "automatic";
    if (checkEffect[0]) {
      const actorSkillValue = Number(
        product.characterCustomizations.find(
          (item) => item.characterKey === input.actorKey,
        )?.characterSheet?.rules.skills[input.actionKey] ??
          template.characterSheet?.rules.skills[input.actionKey] ??
          template.skills[input.actionKey] ??
          0,
      );
      if (!Number.isFinite(actorSkillValue))
        fail("domain_rejected", `角色技能值无效:${input.actorKey}.${input.actionKey}`);
      const targetTemplate =
        targetKey == null
          ? null
          : this.campaign.characterTemplates.find(
              (item) => item.characterKey === targetKey,
            );
      const opponentSkillValue =
        targetKey == null || targetTemplate == null
          ? 0
          : Number(
              product.characterCustomizations.find(
                (item) => item.characterKey === targetKey,
              )?.characterSheet?.rules.skills[input.actionKey] ??
                targetTemplate.characterSheet?.rules.skills[input.actionKey] ??
                targetTemplate.skills[input.actionKey] ??
                0,
            );
      if (!Number.isFinite(opponentSkillValue))
        fail("domain_rejected", `目标技能值无效:${targetKey}.${input.actionKey}`);
      const resolution = await resolveRulePackCheckV1({
        rulePack: this.rulePack,
        checkKey: checkEffect[0].checkKey,
        attributeKey: checkEffect[0].attributeKey,
        attributes: Object.fromEntries(
          [...this.rulePack.attributes, ...this.rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              Number(
                this.state.entities[input.actorKey]?.attributes[attribute.key],
              ),
            ],
          ),
        ),
        seed: this.seed,
        nonce: `${input.commandId}:${sequence}:${input.actionKey}`,
        difficulty: input.difficulty,
        situationalModifier:
          input.situationalModifier + conditionModifier + actorSkillValue,
        contestantRef: input.actorKey,
        opponent:
          targetKey == null
            ? undefined
            : {
                contestantRef: targetKey,
                attributeKey: checkEffect[0].attributeKey,
                situationalModifier: opponentSkillValue,
                attributes: Object.fromEntries(
                  [
                    ...this.rulePack.attributes,
                    ...this.rulePack.derivedStats,
                  ].map((attribute) => [
                    attribute.key,
                    Number(
                      this.state.entities[targetKey]?.attributes[attribute.key],
                    ),
                  ]),
                ),
              },
      });
      const model = this.rulePack.diceModels.find(
        (item) => item.key === resolution.diceModelKey,
      )!;
      const modifier = ["total-vs-target", "opposed"].includes(resolution.mode)
        ? resolution.attributeModifier + resolution.situationalModifier
        : 0;
      outcome = resolution.degree;
      check = {
        eventSequence: sequence,
        actorKey: input.actorKey,
        skill: action.name,
        expression: `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`,
        dice: resolution.keptDice,
        modifier,
        total: resolution.total,
        dc: resolution.difficulty,
        success: [
          "partial-success",
          "success",
          "hard-success",
          "extreme-success",
          "critical-success",
        ].includes(resolution.degree),
        visibility: input.rollVisibility,
        rule: {
          actionKey: input.actionKey,
          checkKey: resolution.checkKey,
          attributeKey: resolution.attributeKey,
          skillKey: input.actionKey,
          skillValue: actorSkillValue,
          diceModelKey: resolution.diceModelKey,
          rolledDice: resolution.dice,
          keptDice: resolution.keptDice,
          degree: resolution.degree,
          mode: resolution.mode,
          successes: resolution.successes,
          winnerRef: resolution.winnerRef,
          tiedRefs: resolution.tiedRefs,
          calculationTrace: resolution.calculationTrace,
          opponent:
            resolution.opponent == null
              ? null
              : {
                  contestantRef: resolution.opponent.contestantRef,
                  attributeKey: resolution.opponent.attributeKey,
                  rolledDice: resolution.opponent.dice,
                  keptDice: resolution.opponent.keptDice,
                  attributeModifier: resolution.opponent.attributeModifier,
                  total: resolution.opponent.total,
                  degree: resolution.opponent.degree,
                  rollTrace: resolution.opponent.rollTrace,
                  proofHash: resolution.opponent.proofHash,
                },
          rollTrace: resolution.rollTrace,
          seedCommitment: resolution.seedCommitment,
          nonce: resolution.nonce,
          proofHash: resolution.proofHash,
          rulePackContentHash: this.rulePackHash,
        },
      };
    }
    const effectTargetKey = targetKey ?? input.actorKey;
    const conditionChanges: TtrpgRuntimeRuleActionResultV1["conditionChanges"] =
      [];
    if (check == null || check.success) {
      for (const [effectIndex, effect] of action.effects.entries()) {
        if (effect.kind === "resource")
          addResource(effectTargetKey, effect.resourceKey, effect.delta, null);
        else if (effect.kind === "damage") {
          const modifier =
            effect.modifierAttributeKey == null
              ? 0
              : Number(
                  this.state.entities[input.actorKey]?.attributes[
                    effect.modifierAttributeKey
                  ],
                );
          if (!Number.isFinite(modifier))
            fail(
              "domain_rejected",
              `伤害修正属性无效:${effect.modifierAttributeKey}`,
            );
          const damage = await resolveRulePackDiceModelV1({
            rulePack: this.rulePack,
            diceModelKey: effect.diceModelKey,
            seed: this.seed,
            nonce: `${input.commandId}:${sequence}:${input.actionKey}:damage:${effectIndex}`,
            modifier,
          });
          addResource(
            effectTargetKey,
            effect.resourceKey,
            -Math.max(0, damage.total),
            damage.proofHash,
          );
        } else if (effect.kind === "condition") {
          const definition = this.rulePack.conditions.find(
            (item) => item.key === effect.conditionKey,
          )!;
          const existing = product.conditions[effectTargetKey]?.find(
            (item) => item.conditionKey === effect.conditionKey,
          );
          const stacks =
            definition.stacking === "replace"
              ? Math.min(definition.maximumStacks, effect.stacks)
              : Math.min(
                  definition.maximumStacks,
                  (existing?.stacks ?? 0) + effect.stacks,
                );
          conditionChanges.push({
            entityKey: effectTargetKey,
            conditionKey: effect.conditionKey,
            stacks,
            duration: definition.defaultDurationRounds,
          });
        }
      }
    }
    const completesTurn = economyTransition
      ? economyTransition.nextActorKey != null
      : action.phase === "action";
    if (completesTurn) {
      for (const condition of activeConditions) {
        if (condition.duration == null) continue;
        const duration = condition.duration - 1;
        conditionChanges.push({
          entityKey: input.actorKey,
          conditionKey: condition.conditionKey,
          stacks: duration > 0 ? condition.stacks : 0,
          duration: duration > 0 ? duration : null,
        });
      }
    }
    const currentIndex = ttrpg.turnOrder.indexOf(input.actorKey);
    const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
    const advances = action.phase === "action";
    const nextActorKey =
      economyTransition?.nextActorKey ??
      (advances ? ttrpg.turnOrder[nextIndex] : null);
    const nextRound =
      economyTransition?.nextRound ??
      (advances ? ttrpg.round + (nextIndex === 0 ? 1 : 0) : ttrpg.round);
    const receipt = createTtrpgActionReceiptV2({
      state: this.state,
      campaign: this.campaign,
      rulePack: this.rulePack,
      sequence,
      sceneKey: scene.sceneKey,
      action,
      actorKey: input.actorKey,
      targetKey,
      check,
      outcome,
      resourceChanges,
      conditionChanges,
      abilityChange,
      nextActorKey,
      nextRound,
      declaredIntent: input.declaredIntent ?? null,
      participantControllers: Object.fromEntries(
        this.campaign.characterTemplates.flatMap((character) => {
          if (character.role !== "player") return [];
          const controller =
            character.controller === "open"
              ? "vacant"
              : character.controller === "ai"
                ? "ai"
                : "human";
          return [[character.characterKey, controller]];
        }),
      ),
    });
    return {
      eventSequence: sequence,
      actionKey: input.actionKey,
      actionName: action.name,
      actorKey: input.actorKey,
      targetKey,
      actionPhase: action.phase,
      outcome,
      check,
      resourceChanges,
      conditionChanges,
      abilityChange,
      actorAuthority: input.actorAuthority ?? null,
      receipt,
      nextActorKey,
      nextRound,
    };
  }
}
