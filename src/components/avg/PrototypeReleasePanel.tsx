import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProductBuildRecordV1, WorkspaceScope } from '../../lib/types';
import { listCompletedProductBuildPlaythroughsV1, readLatestProductBuildMainRouteGateV1, readLatestProductMediaRuntimeGateV1, recordProductBuildMainRoutePlaythroughV1 } from '../../lib/product-production/quality-receipts';
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../lib/product-production/adoption';
import { scanAvgPrototypeMediaV1 } from '../../lib/avg/prototype-media-scan';
import { createProductRuntimeInstance } from '../../lib/product/runtime-instances';
function browserEnvironment() { return { browserName: 'browser', browserVersion: navigator.userAgent, platform: navigator.platform || 'unknown', viewport: { width: Math.max(1, innerWidth), height: Math.max(1, innerHeight) } }; }
async function readEvidence(scope: WorkspaceScope, buildId: number) {
    const [sessions, route, media] = await Promise.all([listCompletedProductBuildPlaythroughsV1({ scope, productBuildId: buildId }), readLatestProductBuildMainRouteGateV1({ scope, productBuildId: buildId }), readLatestProductMediaRuntimeGateV1({ scope, productBuildId: buildId })]);
    return { sessions, route, media };
}
export default function PrototypeReleasePanel({ scope, productionId, build, disabled, onChanged, onStarted, onBusyChange }: {
    scope: WorkspaceScope;
    productionId: number;
    build: ProductBuildRecordV1;
    disabled: boolean;
    onChanged: () => Promise<void>;
    onStarted: (sessionId: number) => void;
    onBusyChange: (busy: boolean) => void;
}) {
    const [evidence, setEvidence] = useState<Awaited<ReturnType<typeof readEvidence>> | null>(null), [sessionId, setSessionId] = useState<number | null>(null);
    const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [progress, setProgress] = useState(''), [prepared, setPrepared] = useState<Awaited<ReturnType<typeof prepareProductProductionAdoption>> | null>(null), [publishConfirmed, setPublishConfirmed] = useState(false);
    const generation = useRef(0), operation = useRef(false), abort = useRef<AbortController | null>(null);
    const refresh = useCallback(async () => { const token = ++generation.current; const next = await readEvidence(scope, build.id!); if (token === generation.current) {
        setEvidence(next);
        setSessionId(current => next.sessions.some(row => row.sessionId === current) ? current : next.sessions[0]?.sessionId ?? null);
    } }, [scope, build.id]);
    useEffect(() => { const requests = generation; void refresh().catch(cause => setError(String(cause))); return () => { ++requests.current; }; }, [refresh, build.stateRevision]);
    useEffect(() => () => { abort.current?.abort(); }, [scope, build.id, build.previewHash]);
    const run = async (task: (signal: AbortSignal) => Promise<void>) => {
        if (operation.current)
            return;
        operation.current = true;
        setBusy(true);
        onBusyChange(true);
        setError('');
        setNotice('');
        setProgress('');
        const controller = new AbortController();
        abort.current = controller;
        try {
            await task(controller.signal);
        }
        catch (cause) {
            if (!controller.signal.aborted)
                setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            operation.current = false;
            setBusy(false);
            onBusyChange(false);
        }
    };
    const locked = busy || disabled, released = build.releasedProductReleaseId != null;
    const invalidateReview = () => { setPrepared(null); setPublishConfirmed(false); };
    return <section aria-label="本地原型版本验收" className="avg-assembly-candidate"><h4>本地原型版本验收</h4>
    <p>确认此预览的一条完整试玩路线，实际解码全部冻结媒资后，可保存为不可变的本地原型版本。商业艺术、专业配音与外部分发另行验收。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{progress && <p role="status">{progress}</p>}
    {!released && <>
      <button className="lf-action" disabled={locked} onClick={() => void run(async () => { invalidateReview(); await refresh(); setNotice('已重新读取当前预览的完整试玩与验收结果。'); })}>刷新试玩与验收结果</button>
      <label>完整试玩存档<select disabled={locked} value={sessionId ?? ''} onChange={event => { setSessionId(event.target.value ? Number(event.target.value) : null); setConfirmed(false); }}><option value="">尚未选择</option>{evidence?.sessions.map(session => <option value={session.sessionId} key={session.sessionId}>存档 #{session.sessionId} · 结局 {session.endingKey} · {session.choiceCount} 次选择</option>)}</select></label>
      {!evidence?.sessions.length && <p>请先试玩此预览，到达结局后返回并刷新。</p>}
      <label><input type="checkbox" checked={confirmed} disabled={locked || !sessionId} onChange={event => setConfirmed(event.target.checked)}/>我已核对此预览存档的完整路线，确认系统与演出结果</label>
      <button className="lf-action" disabled={locked || !confirmed || !sessionId} onClick={() => void run(async () => { invalidateReview(); await recordProductBuildMainRoutePlaythroughV1({ scope, productBuildId: build.id!, productRuntimeSessionId: sessionId!, authorConfirmation: 'author-confirmed-main-route', environment: browserEnvironment() }); await refresh(); await onChanged(); setNotice('准确预览路线已确认，原试玩存档继续保留。'); })}>确认此预览的完整路线</button>
      <button className="lf-action" disabled={locked} onClick={() => void run(async (signal) => { invalidateReview(); const gate = await scanAvgPrototypeMediaV1({ scope, buildId: build.id!, expectedPreviewHash: build.previewHash, environment: browserEnvironment(), signal, onProgress: (done, total) => setProgress(`全目录媒资解码 ${done} / ${total}`) }); await refresh(); await onChanged(); setNotice(gate ? gate.evidence.passed ? '全部冻结媒资已实际解码。' : '部分媒资解码失败，已保存失败结果；请修复来源后重新验收。' : '此预览没有媒资，无需解码验收。'); })}>验证全部冻结媒资</button>
      <p>完整路线：{evidence?.route?.gateReceipt.status === 'passed' ? '已确认' : '待确认'} · 全目录媒资：{evidence?.media ? evidence.media.evidence.passed ? '通过' : '未通过' : '未记录（无媒资时免验）'}</p>
      <button className="lf-action" disabled={locked} onClick={() => void run(async () => { invalidateReview(); const next = await prepareProductProductionAdoption({ scope, productionId }); setPrepared(next); setNotice('本地原型版本已准备，请核对后保存。'); })}>准备本地原型版本</button>
      {prepared && <div><p>Build #{prepared.intent.buildNumber} · 版本 v{prepared.releaseVersion} · 媒资 {prepared.mediaAssetKeys.length} 项</p><p>预览：{build.previewHash.slice(0, 12)} · 采用校验：{prepared.adoptionIntentHash.slice(0, 12)}</p>
        <label><input type="checkbox" disabled={locked} checked={publishConfirmed} onChange={event => setPublishConfirmed(event.target.checked)}/>我已核对版本，将它保存为本地原型</label>
        <button className="lf-action" disabled={locked || !publishConfirmed} onClick={() => void run(async () => { const receipt = await publishProductProductionBuild({ scope, productionId, command: { type: 'publish', commandId: `avg.prototype.publish.${crypto.randomUUID()}`, expectedStateRevision: prepared.intent.expectedStateRevision, buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash, adoptionIntentHash: prepared.adoptionIntentHash } }); invalidateReview(); await onChanged(); setNotice(`本地原型 v${receipt.releaseVersion} 已保存。`); })}>确认保存本地原型版本</button>
      </div>}
    </>}
    {released && <><p>此版本已冻结；后续修改请创建新 Build。</p><button className="lf-action" disabled={locked} onClick={() => void run(async signal => { const session = await createProductRuntimeInstance({ scope, kind: 'avg', title: '本地原型新存档', productSource: { kind: 'release', productReleaseId: build.releasedProductReleaseId! } }); if (!signal.aborted) onStarted(session.id!); })}>从此版本开始新存档</button></>}
  </section>;
}
