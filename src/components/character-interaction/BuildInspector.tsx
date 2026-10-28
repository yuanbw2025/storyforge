import { useEffect, useState } from 'react';
import type { WorkspaceScope, ProductRuntimePackageV1 } from '../../lib/types';
import { readProductProductionDetailsV1 } from '../../lib/product-production/service';
import { verifyProductRuntimeSource } from '../../lib/product-production/preview-source';
import BuildMediaInspector from './BuildMediaInspector';
export default function BuildInspector({ scope, productionId, page, onProduction }: {
    scope: WorkspaceScope | null;
    productionId: number | null;
    page: string;
    onProduction: () => void;
}) {
    const [refresh, setRefresh] = useState(0);
    const identity = JSON.stringify({scope, productionId, refresh});
    const [loaded, setLoaded] = useState<{identity: string; pkg: ProductRuntimePackageV1 | null; buildId: number | null; previewHash: string; error: string}>({identity: '', pkg: null, buildId: null, previewHash: '', error: ''});
    const current = loaded.identity === identity ? loaded : null;
    const pkg = current?.pkg ?? null, error = current?.error ?? '', loading = !!scope && !!productionId && !current;
    useEffect(() => {
        if (!scope || !productionId) return;
        let active = true;
        void (async () => {
            const details = await readProductProductionDetailsV1(scope, productionId, ['character-interaction']);
            if (!active) return;
            const build = details.build;
            if (!build?.previewManifestJson || !build.previewHash) {
                setLoaded({identity, pkg: null, buildId: null, previewHash: '', error: ''});
                return;
            }
            const resolved = await verifyProductRuntimeSource({scope, source: {kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash}});
            if (resolved.runtimePackage.version !== 1 || resolved.runtimePackage.productType !== 'character-interaction') {
                throw new Error('当前版本不属于角色聊天作品。');
            }
            if (active) setLoaded({identity, pkg: resolved.runtimePackage, buildId: build.id!, previewHash: build.previewHash, error: ''});
        })().catch(cause => {if (active) setLoaded({identity, pkg: null, buildId: null, previewHash: '', error: String(cause)});});
        return () => {active = false;};
    }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps -- identity freezes the selected scope and production
    return <section className="lf-paper"><h3>{page === 'characters' ? '人物快照' : page === 'scenes' ? '场景与规则' : '人物与场景素材'}</h3>{error && <p role="alert">{error}</p>}{loading ? <p>正在校验生成版本…</p> : !pkg ? <><p>尚无生成版本。制作完成后，这里显示真实产物。</p><button className="lf-action" onClick={onProduction}>查看制作流程</button></> : page === 'characters' ? <>{pkg.interaction?.profiles.map(c => <article key={c.participantKey}><h4>{c.name} · {c.roleLabel}</h4><p>{c.voiceRules}</p><p>角色标识：{c.characterKey}</p>{c.initialKnowledge.map(k => <details key={k.key}><summary>{k.visibility === 'private' ? '角色私密知识（作者查看）' : '公开知识'}</summary><p>{k.content}</p></details>)}<p>{c.relationshipDimensions.map(d => `${d.label}：${d.initial}`).join(' · ')}</p></article>)}</> : page === 'scenes' ? <>{pkg.interaction?.sceneTemplates.map(s => <article key={s.sceneKey}><h4>{s.title}</h4><p>{s.location} · {s.timeLabel}</p><p>{s.purpose}</p><p>参与：{s.participantKeys.map(k => pkg.interaction?.profiles.find(p => p.participantKey === k)?.name ?? k).join('、')}</p><p>目标：{s.goals.join('；')}</p><p>结束约定：{s.endingConditions.join('；') || '由用户结束或导演确认结束'}</p><p>回合上限 {s.maxTurns} · 回复预算 {s.directorBudget}</p>{s.relationshipRules.map(r => <p key={r.ruleKey}>{r.label}：{r.reason}</p>)}</article>)}</> : <BuildMediaInspector key={`${identity}:${current!.previewHash}`} scope={scope!} buildId={current!.buildId!} previewHash={current!.previewHash} pkg={pkg}/>}{scope && productionId && <button type="button" className="lf-action" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新生成版本</button>}</section>;
}
