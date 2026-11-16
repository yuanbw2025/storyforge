import { ScrollText } from "lucide-react";
import type { TtrpgViewerProjectionV1 } from "../../lib/ttrpg/viewer-projection";

interface Props {
  recap: TtrpgViewerProjectionV1["recap"];
  hidden: boolean;
  resolveEntityName: (entityKey: string) => string;
}

export default function TtrpgSessionRecap({ recap, hidden, resolveEntityName }: Props) {
  return (
    <section hidden={hidden}
      className="rounded border border-border bg-bg-base p-4"
      data-testid="ttrpg-session-recap"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <ScrollText className="h-4 w-4 text-accent" />
        会后记录
      </div>
      <div className="mt-3 grid gap-3 text-xs text-text-secondary md:grid-cols-3">
        <div className="rounded bg-bg-surface p-3">
          <div className="text-[10px] text-text-muted">已历场景</div>
          <div className="mt-1">
            {recap.openedSceneTitles.join("、") ||
              "尚未开始"}
          </div>
        </div>
        <div className="rounded bg-bg-surface p-3">
          <div className="text-[10px] text-text-muted">可见线索</div>
          <div className="mt-1">
            {recap.visibleClueTitles.join("、") ||
              "尚无"}
          </div>
        </div>
        <div className="rounded bg-bg-surface p-3">
          <div className="text-[10px] text-text-muted">
            规则行动 / 成长
          </div>
          <div className="mt-1">
            {recap.resolvedActionCount} 次 /{" "}
            {recap.advancementAwarded} 点
          </div>
        </div>
      </div>
      <div className="mt-3 rounded border border-border bg-bg-surface p-3 text-[10px] text-text-muted">
        <strong className="text-xs text-text-primary">
          本场事实对账 · {recap.scope.title}
        </strong>
        <span className="ml-2">
          {recap.viewerKind === "gm-complete"
            ? "KP 完整账"
            : recap.viewerKind === "character-private"
              ? "本角色私人账"
              : "公开观战账"}
        </span>
        <span className="ml-2">
          事件 {recap.scope.fromSequence}–
          {recap.scope.toSequence}
        </span>
        <p className="mt-1">
          本场新发现：
          {recap.discoveredThisSessionTitles.join(
            "、",
          ) || "无"}{" "}
          · 未解必需线索：
          {recap.unresolvedRequiredClues.visibleTitles.join(
            "、",
          ) ||
            `${recap.unresolvedRequiredClues.hiddenCount} 条未公开`}
        </p>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <article className="rounded border border-border bg-bg-surface p-3 text-[10px] text-text-secondary">
          <strong className="text-xs text-text-primary">
            资源、状态与能力次数
          </strong>
          <div className="mt-2 max-h-48 space-y-1 overflow-auto">
            {recap.resourceChanges.map((change) => (
              <p
                key={`resource.${change.eventSequence}.${change.actorKey}.${change.resourceKey}`}
              >
                #{change.eventSequence} {change.actorName} ·{" "}
                {change.resourceName} {change.before} → {change.after}（
                {change.delta >= 0 ? "+" : ""}
                {change.delta}）
              </p>
            ))}
            {recap.conditionChanges.map((change) => (
              <p
                key={`condition.${change.eventSequence}.${change.actorKey}.${change.conditionKey}`}
              >
                #{change.eventSequence} {change.actorName} ·{" "}
                {change.conditionName} ×{change.stacks}
                {change.duration == null
                  ? ""
                  : ` · 剩余 ${change.duration}`}
              </p>
            ))}
            {recap.abilityChanges.map((change) => (
              <p
                key={`ability.${change.eventSequence}.${change.actorKey}.${change.abilityKey}.${change.reason}`}
              >
                #{change.eventSequence} {change.actorName} ·{" "}
                {change.abilityName} · {change.reason} · 次数{" "}
                {change.usesBefore ?? "∞"} → {change.usesAfter ?? "∞"}
              </p>
            ))}
            {!recap.resourceChanges.length &&
              !recap.conditionChanges.length &&
              !recap.abilityChanges.length && (
                <p className="text-text-muted">本场没有可见变化。</p>
              )}
          </div>
        </article>
        <article className="rounded border border-border bg-bg-surface p-3 text-[10px] text-text-secondary">
          <strong className="text-xs text-text-primary">
            物品取得、使用与转移
          </strong>
          <div className="mt-2 max-h-48 space-y-1 overflow-auto">
            {recap.itemChanges.map((change) => (
              <p
                key={`item.${change.eventSequence}.${change.itemInstanceId}.${change.source}`}
              >
                #{change.eventSequence} {change.title} ·{" "}
                {change.operation} ·{" "}
                {change.ownerBefore
                  ? resolveEntityName(change.ownerBefore)
                  : "无主"}{" "}
                →{" "}
                {change.ownerAfter
                  ? resolveEntityName(change.ownerAfter)
                  : "移除"}
                {change.chargesBefore !== change.chargesAfter
                  ? ` · 充能 ${change.chargesBefore ?? "—"} → ${change.chargesAfter ?? "—"}`
                  : ""}
                {change.durabilityBefore !== change.durabilityAfter
                  ? ` · 耐久 ${change.durabilityBefore ?? "—"} → ${change.durabilityAfter ?? "—"}`
                  : ""}
              </p>
            ))}
            {!recap.itemChanges.length && (
              <p className="text-text-muted">本场没有可见物品变化。</p>
            )}
          </div>
        </article>
        <article className="rounded border border-border bg-bg-surface p-3 text-[10px] text-text-secondary lg:col-span-2">
          <strong className="text-xs text-text-primary">
            奖励、惩罚、关系与剧情账本
          </strong>
          <div className="mt-2 max-h-48 space-y-1 overflow-auto">
            {recap.ledgerChanges
              .filter(
                (change) =>
                  !["item", "ability", "numeric", "condition"].includes(
                    change.family,
                  ),
              )
              .map((change) => (
                <p
                  key={`ledger.${change.eventSequence}.${change.family}.${change.operation}.${change.targetRef}`}
                >
                  #{change.eventSequence} {change.family}/
                  {change.operation} ·{" "}
                  {resolveEntityName(change.targetRef)}{" "}
                  · {change.before} → {change.after} · {change.reason}
                </p>
              ))}
            {!recap.ledgerChanges.some(
              (change) =>
                !["item", "ability", "numeric", "condition"].includes(
                  change.family,
                ),
            ) && (
              <p className="text-text-muted">
                本场没有可见奖励、关系或剧情账本变化。
              </p>
            )}
          </div>
          <p className="mt-2 text-text-muted">
            待处理：
            {[
              ...recap.outstanding.exhaustedAbilityNames.map(
                (name) => `能力 ${name}`,
              ),
              ...recap.outstanding
                .activeConditionNames,
              ...recap.outstanding.activeQuestTitles.map(
                (name) => `任务 ${name}`,
              ),
              ...recap.outstanding.incompleteClockTitles.map(
                (name) => `Clock ${name}`,
              ),
            ].join("、") || "无"}
          </p>
        </article>
      </div>
      {recap.ending && (
        <div className="mt-3 rounded border border-success/30 bg-success/5 p-3">
          <strong className="text-xs text-text-primary">
            {recap.ending.title}
          </strong>
          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-secondary">
            {recap.ending.epilogue}
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-text-muted">
        {recap.nextPreparation}
      </p>
    </section>
  );
}
