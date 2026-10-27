import { describe, expect, it } from "vitest";
import {
  applyProductRuntimeEvent,
  replayProductRuntimeEvents,
} from "../../src/lib/product/runtime-core";
import { EMPTY_PRODUCT_RUNTIME_STATE } from "../../src/lib/types";
import type {
  ProductRuntimeEvent,
  ProductRuntimeState,
} from "../../src/lib/types";
import {
  createInitialTtrpgOpenProductStateV1,
} from "../../src/lib/ttrpg/runtime";
import { parseTtrpgState } from "../../src/lib/ttrpg/runtime-state";
import {
  createTtrpgOpenRunStateV1,
  parseTtrpgOpenRunStateV1,
  parseTtrpgRuntimeStateV2,
  advanceOpenWorldTimeV1,
} from "../../src/lib/ttrpg/open-runtime-contract";
import { rebaseProductRuntimeStateForBranchV1 } from "../../src/lib/product/runtime-product-adapters";
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from "../../src/lib/ttrpg/rule-pack-v2";
import { instantiateTtrpgSituationV1 } from "../../src/lib/ttrpg/situation-engine";
import { openCampaignFixture, openRuleFixture } from "../helpers/ttrpg-open-content";
import { createTtrpgOpenAuthorizationV1 } from "../../src/lib/ttrpg/open-authorization";
import { buildInitialTtrpgParticipantsV2 } from "../../src/lib/ttrpg/participants";
import type { ProductRuntimeSession } from "../../src/lib/types";

function event(
  state: ProductRuntimeState,
  sequence: number,
  type: ProductRuntimeEvent["type"],
  payload: Record<string, unknown>,
  actorKey: string | null = null,
): ProductRuntimeEvent {
  return {
    projectId: 1,
    worldGroupId: null,
    sessionId: 1,
    sequence,
    type,
    actorKey,
    targetKey: null,
    commandId: `test.${sequence}`,
    baseSequence: sequence - 1,
    baseStateHash: "0".repeat(64),
    payloadJson: JSON.stringify(payload),
    createdAt: sequence,
  };
}

/** Pure replay fixture. Database/seat atomicity is covered by authorization-epoch. */
function startedFixture() {
  const initial = openInitialState(), campaign = openCampaignFixture();
  const session = { id: 1, projectId: 1, worldId: 1, workId: 1, worldGroupId: null, kind: "ttrpg" } as ProductRuntimeSession;
  const participants = buildInitialTtrpgParticipantsV2({ session, campaign }).map(seat => ({ ...seat,
    assignmentState: seat.controller === "ai" ? "assigned" as const : "claimed" as const,
    consent: { ...seat.consent, aiIdentityDisclosed: true } }));
  const authorization = createTtrpgOpenAuthorizationV1({ campaign, participants, sequence: 1,
    sessionKey: "ttrpg.foundation",
    selectedActorKeys: ["hero", "companion.1", "companion.2"], viewerKey: "viewer.seat.hero" });
  const zero = event(initial, 1, "ttrpg.session-zero.completed", {
    acceptedItemKeys: initial.ttrpg!.product.sessionZero.requiredItemKeys,
    selectedCharacterKeys: authorization.selectedActorKeys, completedBy: authorization.completedBySeatKey,
    authorization, intent: {},
  }, authorization.completedBySeatKey);
  const setup = applyProductRuntimeEvent(initial, zero);
  const e1 = event(setup, 2, "ttrpg.open.run.started", {
    openRun: createTtrpgOpenRunStateV1(campaign), authorizationRevision: authorization.revision,
    startedBySeatKey: authorization.completedBySeatKey, viewerKey: authorization.viewerKey,
    intent: { kind: "open-run-start", viewerKey: authorization.viewerKey },
  }, "hero");
  return { initial, zero, setup, e1, started: applyProductRuntimeEvent(setup, e1), campaign };
}

function openInitialState(): ProductRuntimeState {
  const rule = parseRulePackV2(openRuleFixture());
  const campaign = openCampaignFixture();
  return createInitialTtrpgOpenProductStateV1({
    initialState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
    content: {
      rulePack: { content: rule, contentHash: "a".repeat(64) },
      campaign,
      compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 },
    },
    mechanicalRulePack: projectTtrpgRulePackMechanicalCoreV1(rule),
    sessionKey: "ttrpg.foundation",
  });
}

describe("R-TTRPGOPEN1 runtime foundation", () => {
  it("keeps openRun null until E1 and builds entities from bindings", () => {
    const state = openInitialState();
    expect(state.ttrpg).toBeTruthy();
    expect(state.ttrpg).toHaveProperty("openRun", null);
    expect(state.ttrpg).toMatchObject({ schema: "storyforge.ttrpg-runtime", version: 2, runFormat: "open" });
    expect(state.entities.hero.kind).toBe("player");
    expect(state.entities.harbor.kind).toBe("location");
    expect(state.entities.hero.locationKey).toBe("harbor");
    expect(() => parseTtrpgState(state.ttrpg)).toThrow(/字段不精确/);
  });

  it("rejects missing version tags and malformed shared state without weakening the scripted parser", () => {
    const state = openInitialState();
    expect(parseTtrpgRuntimeStateV2(state.ttrpg)).toEqual(state.ttrpg);
    for (const key of ["schema", "version", "runFormat"]) {
      const bad = { ...state.ttrpg };
      Reflect.deleteProperty(bad, key);
      expect(() => parseTtrpgRuntimeStateV2(bad)).toThrow();
    }
    const badSafety = structuredClone(state.ttrpg);
    Object.assign(badSafety!.product!.safety, { status: "invalid" });
    expect(() => parseTtrpgRuntimeStateV2(badSafety)).toThrow(/安全/);
    const badHash = structuredClone(state.ttrpg);
    badHash!.product!.rulePackContentHash = "not-a-hash";
    expect(() => parseTtrpgRuntimeStateV2(badHash)).toThrow(/产品状态/);
    const badProduct = structuredClone(state.ttrpg);
    Object.assign(badProduct!.product!, { injected: true });
    expect(() => parseTtrpgRuntimeStateV2(badProduct)).toThrow(/字段不精确/);
  });

  it("does not renew companion or Oracle budgets when world time advances", () => {
    const run = createTtrpgOpenRunStateV1(openCampaignFixture());
    run.companions[0].consecutiveActions = 1;
    run.consultedThisWorldTurn = 2;
    const before = structuredClone(run);
    const next = advanceOpenWorldTimeV1(run, "game-action", 1);
    expect(next.worldTime.worldTurn).toBe(1);
    expect(next.companions[0].consecutiveActions).toBe(1);
    expect(next.consultedThisWorldTurn).toBe(2);
    expect(run).toEqual(before);
  });

  it("rejects an open branch before mutating parent state until lineage is implemented", () => {
    const state = openInitialState(), before = structuredClone(state);
    expect(() => rebaseProductRuntimeStateForBranchV1(state, 0)).toThrow(/血缘/);
    expect(state).toEqual(before);
  });

  it("replays valid Session Zero, E1, E11 and E18 through the single reducer", () => {
    const { initial, zero, e1, started, campaign } = startedFixture();
    const rawSituation = instantiateTtrpgSituationV1({
      template: campaign.situationTemplates[0],
      activatedAtSequence: 3,
      activatedAtWorldTurn: parseTtrpgOpenRunStateV1(
        started.ttrpg!.openRun,
      ).worldTime.worldTurn,
      activationReason: "opening",
    });
    const e11 = event(started, 3, "ttrpg.situation.changed", {
      mode: "activated",
      situation: {
        ...rawSituation,
        status: "active",
        queuePosition: null,
      },
      intent: {
        templateKey: rawSituation.templateKey,
        activationReason: "opening",
        mode: "activated",
      },
    });
    const afterE11 = applyProductRuntimeEvent(started, e11);
    const e18 = event(afterE11, 4, "ttrpg.open.failure.logged", {
      failure: {
        failureKey: "failure.test",
        atSequence: 4,
        atWorldTurn: 0,
        category: "gate-failed",
        violatedRule: "测试门未通过",
      },
      intent: {
        category: "gate-failed",
        violatedRule: "测试门未通过",
        failureKey: "failure.test",
      },
    });
    const finalState = applyProductRuntimeEvent(afterE11, e18);
    const finalOpenRun = parseTtrpgOpenRunStateV1(finalState.ttrpg!.openRun);
    expect(finalOpenRun.worldTime.worldTurn).toBe(0);
    expect(finalState.clock).toBe(0);
    expect(finalOpenRun.situations.active).toHaveLength(1);
    expect(finalOpenRun.failures).toHaveLength(1);
    expect(
      replayProductRuntimeEvents(initial, [zero, e1, e11, e18]),
    ).toEqual(finalState);
  });

  it("rejects command payload extensions and world ticks without settled operation evidence", () => {
    const { setup, e1, started } = startedFixture();
    expect(() => applyProductRuntimeEvent(setup, { ...e1,
      payloadJson: JSON.stringify({ ...JSON.parse(e1.payloadJson), extra: true }) })).toThrow(/字段不精确/);
    expect(() =>
      applyProductRuntimeEvent(
        started,
        event(started, 3, "ttrpg.world-turn.advanced", {
          reason: "game-action",
          byEventSequence: 2,
          intent: { reason: "game-action" },
        }),
      ),
    ).toThrow(/operation/);
  });
});
