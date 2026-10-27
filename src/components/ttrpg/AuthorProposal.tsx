import { useEffect, useRef, useState } from "react";
import type {
  WorkspaceScope,
  TtrpgCampaignDesignV2,
  TtrpgCampaignProposalSectionV2,
  ProductProductionBriefV3,
} from "../../lib/types";
import { readProductProductionDetailsV1 } from "../../lib/product-production/service";
import { parseProductProductionBriefV3 } from "../../lib/product-production/contracts";
import { executeProductProductionCommand } from "../../lib/product-production/commands";
import { generateTtrpgCampaignProposalCandidateV2 } from "../../lib/ttrpg/campaign-proposal-harness";
import { useAIConfigStore } from "../../stores/ai-config";
import { resolveRequestConfig } from "../../lib/ai/client";
import { isAIConfigReady } from "../../lib/ai/config-readiness";
import TtrpgCampaignProposalSelector from "./TtrpgCampaignProposalSelector";
import { registerPendingDraftFlusherV1 } from "../../lib/authoring/pending-edit-coordinator";
import TtrpgOpenBriefReview from './TtrpgOpenBriefReview';
export default function AuthorProposal({
  scope,
  productionId,
  onProduction,
}: {
  scope: WorkspaceScope;
  productionId: number;
  onProduction?: () => void;
}) {
  const [details, setDetails] = useState<Awaited<
      ReturnType<typeof readProductProductionDetailsV1>
    > | null>(null),
    [design, setDesign] = useState<TtrpgCampaignDesignV2 | null>(null),
    [openBrief, setOpenBrief] = useState<ProductProductionBriefV3 | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const config = useAIConfigStore((s) => s.config);
  useEffect(() => {
    let active = true;
    setDetails(null); setOpenBrief(null); setDesign(null); setError('');
    void readProductProductionDetailsV1(scope, productionId, ["ttrpg"])
      .then((d) => {
        if (active) {
          const brief = d.brief ? parseProductProductionBriefV3(d.brief.briefJson) : null;
          setDetails(d);
          setOpenBrief(brief?.ttrpgOpen ? brief : null);
          setDesign(
            brief?.ttrpg?.campaignDesign ?? null,
          );
          setDirty(false);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [scope, productionId]);
  const save = async (next: TtrpgCampaignDesignV2) => {
    if (!details?.brief || details.build)
      throw new Error("已进入制作的版本不可在这里改写，请从方案页生成新一版");
    const brief = parseProductProductionBriefV3(details.brief.briefJson);
    if (!brief.ttrpg) throw new Error("缺少跑团方案");
    const receipt = await executeProductProductionCommand({
      scope,
      productionId,
      command: {
        type: "save-brief-revision",
        commandId: crypto.randomUUID(),
        expectedStateRevision: details.production.stateRevision,
        parentRevision: details.production.currentBriefRevision,
        brief: {
          ...brief,
          ttrpg: { ...brief.ttrpg, campaignDesign: next },
          unresolvedDecisionKeys: next.selection.confirmed
            ? brief.unresolvedDecisionKeys.filter(
                (k) => k !== "ttrpg-campaign-proposal-selection",
              )
            : [
                ...new Set([
                  ...brief.unresolvedDecisionKeys,
                  "ttrpg-campaign-proposal-selection",
                ]),
              ],
        },
      },
    });
    if (!receipt.ok)
      throw new Error(String(receipt.result.message ?? "方案已变化"));
    setDetails(
      await readProductProductionDetailsV1(scope, productionId, ["ttrpg"]),
    );
    setDesign(next);
    setDirty(false);
    setNotice("提案已保存，开始制作仍需明确授权。");
  };
  const flushRef = useRef<() => Promise<void>>(async () => {});
  flushRef.current = async () => {
    if (busy) throw new Error("提案正在处理，请完成后再切换");
    if (dirty && design) await save(design);
  };
  useEffect(() => registerPendingDraftFlusherV1(() => flushRef.current()), []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || busy) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, busy]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const generate = (sections?: TtrpgCampaignProposalSectionV2[]) =>
    void run(async () => {
      if (!details?.brief || !design) throw new Error("请先准备方案");
      const brief = parseProductProductionBriefV3(details.brief.briefJson);
      const t = brief.ttrpg!;
      const result = await generateTtrpgCampaignProposalCandidateV2({
        scope,
        worldReleaseId: brief.source.worldReleaseId,
        objective: t.naturalLanguageInstruction,
        seed: {
          title: t.campaign.title,
          background: t.campaign.background,
          coreConflict: t.campaign.coreConflict,
          opening: t.story.openingScene,
          structure: t.story.structure,
        },
        priorDesign: design,
        regenerateSections: sections,
        aiConfig: config,
      });
      await save(result.design);
    });
  if (openBrief?.ttrpgOpen) return <>
    {error && <p role="alert">{error}</p>}
    <TtrpgOpenBriefReview brief={openBrief} started={Boolean(details?.build)} onProduction={onProduction} />
  </>;
  return (
    <section className="lf-paper">
      <h3>讨论方案，比较不同的战役方向</h3>
      <p>
        需求来自“世界与指令”和九步配置。可比较提案、混合分区、锁定满意部分，再按需请
        AI 重做；不会调用游玩时的 KP。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {details?.build ? (
        <p>
          本方案已进入制作，以下内容只读。要改变方向，请修改配置并生成新的审查方案。
        </p>
      ) : null}
      {design ? (
        <fieldset disabled={busy || Boolean(details?.build)}>
          <TtrpgCampaignProposalSelector
            value={design}
            onChange={(v) => {
              setDesign(v);
              setDirty(true);
            }}
            onGenerateAi={generate}
            aiGenerating={busy}
            aiReady={isAIConfigReady(resolveRequestConfig(config, { category: "authoring.ttrpg-campaign", projectId: scope.projectId }).config)}
          />
          <button
            className="lf-action lf-action-primary"
            disabled={!dirty}
            onClick={() => void run(() => save(design))}
          >
            保存提案选择
          </button>
          {dirty && <p>选择尚未保存，切换跑团页签时会先保存；也可手动保存。</p>}
        </fieldset>
      ) : (
        <p>先在确认页生成可审查方案，这里会显示真实提案。</p>
      )}
    </section>
  );
}
