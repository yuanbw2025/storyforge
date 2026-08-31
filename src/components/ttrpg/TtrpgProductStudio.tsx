import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  CheckCircle2,
  Loader2,
  Play,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { db } from "../../lib/db/schema";
import {
  installStoryForgeRulePackV1,
  listTtrpgProductDraftsV1,
  reviseTtrpgCampaignCharacterMappingsV1,
} from "../../lib/ttrpg/authoring";
import {
  adoptTtrpgCharacterSheetCandidateFromRunV2,
  generateTtrpgCharacterSheetCandidateV2,
  rejectTtrpgCharacterSheetCandidateV2,
  type TtrpgCharacterSheetCandidateV2,
} from "../../lib/ttrpg/character-sheet-harness";
import {
  parseTtrpgCampaignContentV1,
  validateTtrpgCampaignForPublicationV1,
} from "../../lib/ttrpg/campaign";
import {
  parseRulePackV1,
  ruleCheckDefaultDifficultyV2,
} from "../../lib/ttrpg/rule-pack";
import type {
  GameRelease,
  GameRulePackRecordV1,
  RulePackV1,
  TtrpgCampaignContentV1,
  TtrpgCampaignModuleRecordV1,
  WorkspaceScope,
  WorldRelease,
} from "../../lib/types";
import { createWorldInstance } from "../../lib/world-engine/instances";
import { listWorldReleases } from "../../lib/world-engine/releases";
import { useAIConfigStore } from "../../stores/ai-config";
import { resolveRequestConfig } from "../../lib/ai/client";
import { isAIConfigReady } from "../../lib/ai/config-readiness";

interface CampaignView {
  row: TtrpgCampaignModuleRecordV1;
  campaign: TtrpgCampaignContentV1 | null;
  rulePack: RulePackV1 | null;
  report: ReturnType<typeof validateTtrpgCampaignForPublicationV1>;
  playerCount: number;
  sceneCount: number;
  clueCount: number;
}

export default function TtrpgProductStudio(props: {
  scope: WorkspaceScope;
  worldGroupId: number | null;
  onOpenProduction?: () => void;
  onSessionCreated?: (sessionId: number) => void;
}) {
  const [worldReleases, setWorldReleases] = useState<WorldRelease[]>([]);
  const [rulePacks, setRulePacks] = useState<GameRulePackRecordV1[]>([]);
  const [campaigns, setCampaigns] = useState<TtrpgCampaignModuleRecordV1[]>([]);
  const [gameReleases, setGameReleases] = useState<GameRelease[]>([]);
  const [worldReleaseId, setWorldReleaseId] = useState<number | null>(null);
  const [rulePackId, setRulePackId] = useState<number | null>(null);
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [gameReleaseId, setGameReleaseId] = useState<number | null>(null);
  const [characterAttributes, setCharacterAttributes] = useState<
    Record<string, Record<string, number>>
  >({});
  const [aiCharacterKey, setAiCharacterKey] = useState("");
  const [aiCharacterObjective, setAiCharacterObjective] = useState(
    "依据世界角色与战役定位，生成一张动机清晰、秘密分层、数值合法且便于扮演的完整玩家角色卡。",
  );
  const [aiCharacterLocks, setAiCharacterLocks] = useState<Set<string>>(
    new Set(),
  );
  const [aiCharacterCandidate, setAiCharacterCandidate] =
    useState<TtrpgCharacterSheetCandidateV2 | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const aiConfig = useAIConfigStore((state) => state.config);

  const refresh = useCallback(async () => {
    const [worlds, drafts, releases] = await Promise.all([
      listWorldReleases(props.scope),
      listTtrpgProductDraftsV1(props.scope),
      db.gameReleases.where("workId").equals(props.scope.workId).toArray(),
    ]);
    const ttrpgReleases = releases
      .filter((release) => {
        try {
          return (
            (JSON.parse(release.manifestJson) as { productType?: string })
              .productType === "ttrpg"
          );
        } catch {
          return false;
        }
      })
      .sort((left, right) => right.createdAt - left.createdAt);
    setWorldReleases(worlds);
    setRulePacks(drafts.rulePacks);
    setCampaigns(drafts.campaigns);
    setGameReleases(ttrpgReleases);
    setWorldReleaseId((current) => current ?? worlds[0]?.id ?? null);
    setRulePackId((current) => current ?? drafts.rulePacks[0]?.id ?? null);
    setCampaignId((current) => current ?? drafts.campaigns[0]?.id ?? null);
    setGameReleaseId((current) => current ?? ttrpgReleases[0]?.id ?? null);
  }, [props.scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedCampaign = useMemo<CampaignView | null>(() => {
    const row = campaigns.find((item) => item.id === campaignId);
    if (!row) return null;
    const ruleRow = rulePacks.find((item) => item.id === row.rulePackId);
    if (!ruleRow) return null;
    try {
      const rule = parseRulePackV1(ruleRow.rulePackJson);
      const campaign = parseTtrpgCampaignContentV1(row.contentJson, rule);
      return {
        row,
        campaign,
        rulePack: rule,
        report: validateTtrpgCampaignForPublicationV1(campaign, rule),
        playerCount: campaign.characterTemplates.filter(
          (character) => character.role === "player",
        ).length,
        sceneCount: campaign.scenes.length,
        clueCount: campaign.clues.length,
      };
    } catch (cause) {
      return {
        row,
        campaign: null,
        rulePack: null,
        report: {
          valid: false,
          errors: [cause instanceof Error ? cause.message : String(cause)],
          warnings: [],
          unconfirmedAttributeMappings: [],
          structural: {
            reachableSceneKeys: [],
            unreachableSceneKeys: [],
            deadEndSceneKeys: [],
            unreachableEndingKeys: [],
            counterexamples: [],
          },
        },
        playerCount: 0,
        sceneCount: 0,
        clueCount: 0,
      };
    }
  }, [campaignId, campaigns, rulePacks]);

  useEffect(() => {
    const campaign = selectedCampaign?.campaign;
    if (!campaign) {
      setCharacterAttributes({});
      return;
    }
    setCharacterAttributes(
      Object.fromEntries(
        campaign.characterTemplates.map((character) => [
          character.characterKey,
          structuredClone(character.attributes),
        ]),
      ),
    );
    const players = campaign.characterTemplates.filter(
      (character) => character.role === "player",
    );
    setAiCharacterKey((current) =>
      players.some((character) => character.characterKey === current)
        ? current
        : (players[0]?.characterKey ?? ""),
    );
    setAiCharacterCandidate(null);
  }, [selectedCampaign?.row.contentHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const installRulePack = () =>
    run(async () => {
      const row = await installStoryForgeRulePackV1(props.scope);
      await refresh();
      setRulePackId(row.id!);
      setMessage("第一方 StoryForge 规则包已通过 DSL、许可和 fixture 验证。");
    });

  const publish = () =>
    run(async () => {
      if (!props.onOpenProduction) {
        throw new Error("正式发布必须进入跑团制作中心，由世界来源、用户定向、Build 校验与原子发布共同完成。");
      }
      props.onOpenProduction();
    });

  const saveCharacterMappings = () =>
    run(async () => {
      if (!selectedCampaign?.campaign || !selectedCampaign.row.id)
        throw new Error("请先选择战役草稿。");
      const revised = await reviseTtrpgCampaignCharacterMappingsV1({
        scope: props.scope,
        campaignModuleId: selectedCampaign.row.id,
        expectedContentHash: selectedCampaign.row.contentHash,
        characters: selectedCampaign.campaign.characterTemplates.map(
          (character) => ({
            characterKey: character.characterKey,
            attributes: characterAttributes[character.characterKey] ?? {},
          }),
        ),
      });
      await refresh();
      setCampaignId(revised.id!);
      setMessage(
        "角色属性、推导说明和资源上限已重新验证；既有 GameRelease 未被改写。",
      );
    });

  const generateAiCharacter = () =>
    run(async () => {
      if (!selectedCampaign?.row.id || !aiCharacterKey)
        throw new Error("请先选择玩家角色。");
      const generated = await generateTtrpgCharacterSheetCandidateV2({
        scope: props.scope,
        campaignModuleId: selectedCampaign.row.id,
        characterKey: aiCharacterKey,
        objective: aiCharacterObjective,
        lockedFields: [...aiCharacterLocks],
        aiConfig,
      });
      setAiCharacterCandidate(generated.candidate);
      setMessage("AI 只生成了可审阅车卡候选；CampaignPack 尚未改变。");
    });

  const adoptAiCharacter = () =>
    run(async () => {
      if (!aiCharacterCandidate)
        throw new Error("当前没有待采用的 AI 车卡候选。");
      await adoptTtrpgCharacterSheetCandidateFromRunV2({
        scope: props.scope,
        runId: aiCharacterCandidate.runId,
      });
      setAiCharacterCandidate(null);
      await refresh();
      setMessage(
        "作者已采用 AI 车卡候选；完整角色卡、数值映射和内容哈希已重新验证。",
      );
    });

  const rejectAiCharacter = () =>
    run(async () => {
      if (!aiCharacterCandidate) return;
      await rejectTtrpgCharacterSheetCandidateV2({
        scope: props.scope,
        runId: aiCharacterCandidate.runId,
      });
      setAiCharacterCandidate(null);
      setMessage("已拒绝 AI 车卡候选，CampaignPack 未发生变化。");
    });

  const start = () =>
    run(async () => {
      if (gameReleaseId == null) throw new Error("请先选择正式 TTRPG 发布。");
      const release = gameReleases.find((item) => item.id === gameReleaseId);
      if (!release) throw new Error("所选发布不存在。");
      const session = await createWorldInstance({
        scope: props.scope,
        kind: "ttrpg",
        title: `${release.label} · 战役`,
        worldGroupId: props.worldGroupId,
        gameSource: { kind: "release", gameReleaseId: release.id! },
      });
      setMessage("正式战役已从冻结 GameRelease 建立。");
      props.onSessionCreated?.(session.id!);
    });

  return (
    <div className="space-y-5 p-5">
      <section className="rounded-lg border border-border bg-bg-elevated p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">
              TTRPG / KERNEL WORKBENCH
            </div>
            <h2 className="mt-1 text-base font-semibold text-text-primary">
              跑团规则与历史草稿工作台
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">
              固定四场景编译器已经退出正式产品。这里维护规则、角色卡、历史战役草稿和既有发布；任何新正式版本都从跑团制作中心开始。
            </p>
          </div>
          {busy && <Loader2 className="h-5 w-5 animate-spin text-accent" />}
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <label className="grid gap-2 text-[10px] text-text-muted">
            冻结世界版本
            <select
              value={worldReleaseId ?? ""}
              onChange={(event) =>
                setWorldReleaseId(Number(event.target.value) || null)
              }
              className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
            >
              <option value="">请选择</option>
              {worldReleases.map((row) => (
                <option key={row.id} value={row.id}>
                  v{row.version} · {row.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-[10px] text-text-muted">
            规则包
            <select
              value={rulePackId ?? ""}
              onChange={(event) =>
                setRulePackId(Number(event.target.value) || null)
              }
              className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
            >
              <option value="">尚未安装</option>
              {rulePacks.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} · {row.ruleSystemVersion}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-[10px] text-text-muted">
            战役草稿
            <select
              value={campaignId ?? ""}
              onChange={(event) =>
                setCampaignId(Number(event.target.value) || null)
              }
              className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
            >
              <option value="">尚未生成</option>
              {campaigns.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} · {row.status}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 rounded border border-warning/30 bg-warning/10 p-3 text-xs leading-5 text-warning" data-testid="ttrpg-authoring-development-boundary">
          作者页不再承担正式发布：规则包、角色映射、AI 车卡候选和旧草稿可以继续维护；新版本必须进入制作中心，既有 Release 仍可开团。
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            disabled={busy}
            onClick={installRulePack}
            className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs text-text-primary"
          >
            <ShieldCheck className="h-4 w-4" />
            安装/验证规则包
          </button>
          <button
            disabled
            className="rounded border border-border px-3 py-2 text-xs text-text-muted opacity-60"
          >
            固定模板已停用
          </button>
          <button
            disabled={busy}
            onClick={publish}
            className="flex items-center gap-2 rounded bg-success px-3 py-2 text-xs text-white disabled:opacity-40"
          >
            <Rocket className="h-4 w-4" />
            进入制作中心发布
          </button>
        </div>
      </section>

      {selectedCampaign && (
        <section
          className="rounded-lg border border-border bg-bg-elevated p-5"
          data-testid="ttrpg-gm-preparation"
        >
          <div className="flex items-center gap-2">
            <BookOpenText className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold">
              {selectedCampaign.row.title}
            </h3>
            <span
              className={`ml-auto rounded px-2 py-1 text-[10px] ${selectedCampaign.report.valid ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
            >
              {selectedCampaign.report.valid ? "发布预检通过" : "需要确认"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 text-center">
            <div className="rounded bg-bg-base p-3">
              <Users className="mx-auto h-4 w-4 text-accent" />
              <div className="mt-1 text-lg font-semibold">
                {selectedCampaign.playerCount}
              </div>
              <div className="text-[10px] text-text-muted">预生成角色</div>
            </div>
            <div className="rounded bg-bg-base p-3">
              <div className="text-lg font-semibold">
                {selectedCampaign.sceneCount}
              </div>
              <div className="text-[10px] text-text-muted">场景</div>
            </div>
            <div className="rounded bg-bg-base p-3">
              <div className="text-lg font-semibold">
                {selectedCampaign.clueCount}
              </div>
              <div className="text-[10px] text-text-muted">线索</div>
            </div>
          </div>
          {selectedCampaign.report.errors.map((item) => (
            <p key={item} className="mt-3 text-xs text-warning">
              {item}
            </p>
          ))}
          {selectedCampaign.report.warnings.map((item) => (
            <p key={item} className="mt-2 text-xs text-text-muted">
              {item}
            </p>
          ))}
          {selectedCampaign.campaign && selectedCampaign.rulePack && (
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div
                className="rounded border border-purple-500/30 bg-purple-500/5 p-4 xl:col-span-2"
                data-testid="ttrpg-ai-character-sheet-authoring"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                      <Sparkles className="h-4 w-4 text-purple-500" />
                      AI 完整车卡候选
                    </div>
                    <p className="mt-1 text-[10px] leading-5 text-text-muted">
                      模型只读单角色安全制作投影，不读取场景秘密；生成不写
                      CampaignPack，只有作者采用后才以内容哈希 CAS
                      更新。锁定字段在生成、修复和采用三层复验。
                    </p>
                  </div>
                  <button
                    disabled={
                      busy ||
                      !!aiCharacterCandidate ||
                      !aiCharacterKey ||
                      !isAIConfigReady(
                        resolveRequestConfig(aiConfig, {
                          category: "authoring.ttrpg-character",
                          projectId: props.scope.projectId,
                        }).config,
                      )
                    }
                    onClick={generateAiCharacter}
                    className="rounded bg-purple-600 px-3 py-2 text-xs text-white disabled:opacity-40"
                  >
                    生成候选
                  </button>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-[10px] text-text-muted">
                    目标玩家角色
                    <select
                      value={aiCharacterKey}
                      onChange={(event) => {
                        setAiCharacterKey(event.target.value);
                        setAiCharacterCandidate(null);
                        setAiCharacterLocks(new Set());
                      }}
                      className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                    >
                      {selectedCampaign.campaign.characterTemplates
                        .filter((character) => character.role === "player")
                        .map((character) => (
                          <option
                            key={character.characterKey}
                            value={character.characterKey}
                          >
                            {character.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[10px] text-text-muted md:col-span-2">
                    生成目标
                    <textarea
                      rows={2}
                      value={aiCharacterObjective}
                      onChange={(event) =>
                        setAiCharacterObjective(event.target.value)
                      }
                      className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                    />
                  </label>
                </div>
                <div className="mt-3">
                  <span className="text-[10px] text-text-muted">
                    逐字段锁定
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[
                      ["identity.name", "姓名"],
                      ["identity.background", "背景"],
                      ["identity.shortTermGoal", "短期目标"],
                      ["identity.privateKnowledge", "私密知识"],
                      ...selectedCampaign.rulePack.attributes.map(
                        (attribute) => [
                          `attribute.${attribute.key}`,
                          attribute.name,
                        ],
                      ),
                    ].map(([field, label]) => (
                      <label
                        key={field}
                        className="flex items-center gap-1 rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-secondary"
                      >
                        <input
                          type="checkbox"
                          checked={aiCharacterLocks.has(field)}
                          onChange={(event) =>
                            setAiCharacterLocks((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(field);
                              else next.delete(field);
                              return next;
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                {aiCharacterCandidate && (
                  <div className="mt-4 rounded border border-purple-500/30 bg-bg-base p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <strong className="text-xs text-text-primary">
                          候选：{aiCharacterCandidate.draft.identity.name}
                        </strong>
                        <p className="mt-1 text-[10px] text-text-muted">
                          Run #{aiCharacterCandidate.runId} ·{" "}
                          {aiCharacterCandidate.modelEvidence.totalTokens}{" "}
                          tokens ·{" "}
                          {aiCharacterCandidate.repairApplied
                            ? "经过一次协议修复"
                            : "首次通过协议"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          disabled={busy}
                          onClick={adoptAiCharacter}
                          className="rounded bg-accent px-3 py-1.5 text-[10px] text-white"
                        >
                          作者确认采用
                        </button>
                        <button
                          disabled={busy}
                          onClick={rejectAiCharacter}
                          className="rounded border border-border px-3 py-1.5 text-[10px] text-text-muted"
                        >
                          拒绝
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 text-[10px] md:grid-cols-3">
                      <div>
                        <span className="text-text-muted">背景</span>
                        <p className="mt-1 text-text-secondary">
                          {aiCharacterCandidate.draft.identity.background}
                        </p>
                      </div>
                      <div>
                        <span className="text-text-muted">目标 / 秘密</span>
                        <p className="mt-1 text-text-secondary">
                          {aiCharacterCandidate.draft.identity.shortTermGoal} ·{" "}
                          {aiCharacterCandidate.draft.identity.privateKnowledge.join(
                            "；",
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-text-muted">属性</span>
                        <p className="mt-1 text-text-secondary">
                          {Object.entries(aiCharacterCandidate.draft.attributes)
                            .map(
                              ([key, value]) =>
                                `${selectedCampaign.rulePack?.attributes.find((attribute) => attribute.key === key)?.name ?? key} ${value}`,
                            )
                            .join(" · ")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div
                className="rounded border border-border bg-bg-base p-4 xl:col-span-2"
                data-testid="ttrpg-character-mapping-editor"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-text-primary">
                      角色数值映射编辑器
                    </div>
                    <p className="mt-1 text-[10px] leading-5 text-text-muted">
                      逐角色修订规则属性。保存会重新计算资源、写明作者覆盖理由并完成内容哈希
                      CAS；已经发布的版本和存档保持冻结。
                    </p>
                  </div>
                  <button
                    disabled={busy}
                    onClick={saveCharacterMappings}
                    className="rounded border border-accent px-3 py-2 text-xs text-accent disabled:opacity-40"
                  >
                    保存、确认并重新验证
                  </button>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {selectedCampaign.campaign.characterTemplates.map(
                    (character) => (
                      <fieldset
                        key={character.characterKey}
                        className="rounded border border-border bg-bg-surface p-3"
                      >
                        <legend className="px-1 text-xs font-medium text-text-primary">
                          {character.name} ·{" "}
                          {character.role === "player" ? "玩家角色" : "NPC"}
                        </legend>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {selectedCampaign.rulePack!.attributes.map(
                            (attribute) => (
                              <label
                                key={attribute.key}
                                className="grid gap-1 text-[9px] text-text-muted"
                              >
                                <span>
                                  {attribute.name} · {attribute.minimum}～
                                  {attribute.maximum}
                                </span>
                                <input
                                  type="number"
                                  min={attribute.minimum}
                                  max={attribute.maximum}
                                  step={1}
                                  value={
                                    characterAttributes[
                                      character.characterKey
                                    ]?.[attribute.key] ?? attribute.defaultValue
                                  }
                                  onChange={(event) =>
                                    setCharacterAttributes((current) => ({
                                      ...current,
                                      [character.characterKey]: {
                                        ...(current[character.characterKey] ??
                                          {}),
                                        [attribute.key]: Number(
                                          event.target.value,
                                        ),
                                      },
                                    }))
                                  }
                                  className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                                />
                              </label>
                            ),
                          )}
                        </div>
                      </fieldset>
                    ),
                  )}
                </div>
              </div>
              <div className="rounded border border-border bg-bg-base p-4">
                <div className="text-xs font-semibold text-text-primary">
                  会前完整性检查
                </div>
                <ul className="mt-3 space-y-2 text-xs text-text-secondary">
                  <li>
                    ✓{" "}
                    {
                      selectedCampaign.campaign.characterTemplates.filter(
                        (item) => item.role === "player",
                      ).length
                    }{" "}
                    张预生成角色卡，属性与资源由{" "}
                    {selectedCampaign.rulePack.title} 冻结
                  </li>
                  <li>
                    ✓{" "}
                    {
                      selectedCampaign.campaign.clues.filter(
                        (item) => item.required,
                      ).length
                    }{" "}
                    条必需线索均提供至少两条发现路径
                  </li>
                  <li>
                    ✓{" "}
                    {
                      selectedCampaign.campaign.scenes.filter((item) =>
                        item.failureForward.trim(),
                      ).length
                    }
                    /{selectedCampaign.campaign.scenes.length}{" "}
                    个场景声明失败推进
                  </li>
                  <li>
                    ✓ {selectedCampaign.campaign.endings.length} 个结局与{" "}
                    {selectedCampaign.campaign.advancementMilestones.length}{" "}
                    个成长里程碑
                  </li>
                  <li>
                    ✓ Session Zero、暂停信号、内容提醒和文本讲义 fallback 可用
                  </li>
                </ul>
              </div>
              <div className="rounded border border-border bg-bg-base p-4">
                <div className="text-xs font-semibold text-text-primary">
                  规则难度与行动经济
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-text-secondary">
                  {selectedCampaign.rulePack.checks.map((check) => (
                    <span
                      key={check.key}
                      className="rounded bg-bg-surface px-2 py-1"
                    >
                      {check.name} · 标准难度{" "}
                      {ruleCheckDefaultDifficultyV2(check) ?? "取角色能力值"}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-5 text-text-muted">
                  每回合{" "}
                  {selectedCampaign.rulePack.turnStructure.actionsPerTurn}{" "}
                  个主要行动、
                  {selectedCampaign.rulePack.turnStructure.reactionsPerRound}{" "}
                  个反应；随机、资源和状态均由规则解释器结算。
                </p>
              </div>
              <div className="rounded border border-border bg-bg-base p-4 xl:col-span-2">
                <div className="text-xs font-semibold text-text-primary">
                  GM 场景与线索准备
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {selectedCampaign.campaign.scenes.map((scene) => (
                    <details
                      key={scene.sceneKey}
                      className="rounded border border-border bg-bg-surface p-3 text-xs"
                    >
                      <summary className="cursor-pointer font-medium text-text-primary">
                        {scene.title} ·{" "}
                        {scene.nextSceneKeys.length
                          ? `→ ${scene.nextSceneKeys.map((key) => selectedCampaign.campaign?.scenes.find((item) => item.sceneKey === key)?.title ?? key).join(" / ")}`
                          : "终局"}
                      </summary>
                      <p className="mt-2 leading-5 text-text-secondary">
                        {scene.description}
                      </p>
                      <p className="mt-2 text-warning">
                        主持秘密：{scene.gmSecret}
                      </p>
                      <p className="mt-1 text-text-muted">
                        失败推进：{scene.failureForward}
                      </p>
                      <p className="mt-1 text-text-muted">
                        可用行动：
                        {scene.actionKeys
                          .map(
                            (key) =>
                              selectedCampaign.rulePack?.actions.find(
                                (item) => item.key === key,
                              )?.name ?? key,
                          )
                          .join("、")}
                      </p>
                      {scene.clueKeys.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {scene.clueKeys
                            .map((key) =>
                              selectedCampaign.campaign?.clues.find(
                                (item) => item.clueKey === key,
                              ),
                            )
                            .filter(
                              (item): item is NonNullable<typeof item> =>
                                !!item,
                            )
                            .map((clue) => (
                              <p
                                key={clue.clueKey}
                                className="text-text-secondary"
                              >
                                线索「{clue.title}」：
                                {clue.discoveryPaths
                                  .map(
                                    (path) =>
                                      `${selectedCampaign.rulePack?.actions.find((item) => item.key === path.actionKey)?.name ?? path.actionKey}（失败：${path.failForward}）`,
                                  )
                                  .join("；")}
                              </p>
                            ))}
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border bg-bg-elevated p-5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-success" />
          <h3 className="text-sm font-semibold">正式发布与开局</h3>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <select
            value={gameReleaseId ?? ""}
            onChange={(event) =>
              setGameReleaseId(Number(event.target.value) || null)
            }
            className="min-w-0 flex-1 rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
          >
            <option value="">尚无正式 TTRPG 发布</option>
            {gameReleases.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label} · v{row.version}
              </option>
            ))}
          </select>
          <button
            disabled={busy || gameReleaseId == null}
            onClick={start}
            className="flex items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-xs text-white"
          >
            <Play className="h-4 w-4" />
            从冻结发布开局
          </button>
        </div>
      </section>

      {message && (
        <p className="rounded border border-success/30 bg-success/10 p-3 text-xs text-success">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
