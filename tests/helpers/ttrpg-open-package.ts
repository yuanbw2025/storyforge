import type { ProductRuntimePackageWithTtrpgV2 } from "../../src/lib/ttrpg/content-version";
import { hashTtrpgFrozenPredicateIndexV1 } from "../../src/lib/ttrpg/content-version";
import { hashProductProductionValueV2 } from "../../src/lib/product-production/hash";
import { parseTtrpgCampaignContentV2 } from "../../src/lib/ttrpg/campaign-v2";
import { parseRulePackV2 } from "../../src/lib/ttrpg/rule-pack-v2";
import { openCampaignFixture, openRuleFixture } from "./ttrpg-open-content";

export async function openRuntimePackageFixture(): Promise<ProductRuntimePackageWithTtrpgV2> {
  const resourceKey = "world-release:fixture:location:harbor";
  const rule = parseRulePackV2(openRuleFixture());
  const campaign = parseTtrpgCampaignContentV2(
    JSON.parse(JSON.stringify(openCampaignFixture()).split('"world.harbor"').join(JSON.stringify(resourceKey))),
    rule,
  );
  campaign.frozenWorldPredicateIndex.indexHash =
    await hashTtrpgFrozenPredicateIndexV1(campaign.frozenWorldPredicateIndex);
  return {
    schema: "storyforge.product-runtime-package", version: 1, productType: "ttrpg",
    definition: {
      productKey: "open.harbor", title: campaign.title, description: campaign.pitch,
      enabledCapabilities: ["narrative", "ttrpg"], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: {
      contentHash: campaign.sourceWorld.contentHash,
      selection: {
        schema: "storyforge.product-world-source-selection", version: 1,
        productType: "ttrpg", worldReferenceHash: "b".repeat(64),
        resourceKeys: [resourceKey], roleBindings: { location: [resourceKey] },
      },
    },
    narrative: {
      moduleKind: "opening", moduleTitle: "港口开场", entryNodeKey: "opening",
      nodes: [{
        key: "opening", kind: "entry", title: "河港", summary: "潮水将至",
        conditionJson: "{}", effectsJson: "[]", successorKeys: [],
      }],
      beats: [{
        beatKey: "opening.text", nodeKey: "opening", kind: "narration",
        speakerKey: null, text: "调查者来到灯塔下。", order: 0,
      }],
      choices: [],
    },
    ttrpg: {
      campaign, rulePack: { content: rule, contentHash: await hashProductProductionValueV2(rule) },
      compatibility: { runtimeProtocol: 2, minimumPlayerVersion: 2 },
    },
  };
}
