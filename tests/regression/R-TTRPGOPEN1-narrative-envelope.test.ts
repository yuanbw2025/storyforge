import { describe, expect, it } from "vitest";
import type { ProductRuntimePackageV1 } from "../../src/lib/types";
import { validateNarrativeContentGraph } from "../../src/lib/product/narrative-content";
import { validateTtrpgOpenNarrativeEnvelopeV1 } from "../../src/lib/ttrpg/open-narrative-envelope";

function opening(): ProductRuntimePackageV1["narrative"] {
  return {
    moduleKind: "opening",
    moduleTitle: "河港开场素材",
    entryNodeKey: "opening",
    nodes: [{
      key: "opening", kind: "scene", title: "河港",
      summary: "城门将闭，渡船仍未回来。",
      conditionJson: "{}", effectsJson: "[]", successorKeys: [],
    }],
    beats: [{
      beatKey: "opening.text", nodeKey: "opening", kind: "narration",
      speakerKey: null, text: "钟声响起，码头上有人等候。", order: 0,
    }],
    choices: [],
  };
}

describe("R-TTRPGOPEN1 · narrative envelope", () => {
  it("open 开场无需伪造结局和按钮；共享旧叙事图仍拒绝", () => {
    const narrative = opening();
    expect(validateTtrpgOpenNarrativeEnvelopeV1(narrative, new Set()).valid).toBe(true);
    const legacy = validateNarrativeContentGraph(narrative);
    expect(legacy.valid).toBe(false);
    expect(legacy.errors.some(error => error.includes("结局"))).toBe(true);
  });

  it("独立素材仍检查孤立引用、重复key和说话者来源", () => {
    const narrative = opening();
    narrative.nodes[0].successorKeys = ["missing"];
    narrative.beats[0].speakerKey = "secret.actor";
    narrative.beats.push({ ...narrative.beats[0], nodeKey: "missing" });
    const report = validateTtrpgOpenNarrativeEnvelopeV1(narrative, new Set(["player.1"]));
    expect(report.valid).toBe(false);
    expect(report.errors.join(" ")).toMatch(/后继不存在/);
    expect(report.errors.join(" ")).toMatch(/角色不存在/);
    expect(report.errors.join(" ")).toMatch(/beat key 重复/);
    expect(report.errors.join(" ")).toMatch(/beat 节点不存在/);
  });

  it("不允许用只读素材的effects写入游戏状态", () => {
    const narrative = opening();
    narrative.nodes[0].effectsJson = '[{"op":"set","path":"untrusted","value":true}]';
    expect(validateTtrpgOpenNarrativeEnvelopeV1(narrative, new Set()).errors.join(" ")).toMatch(/不允许机械效果/);
  });
});
