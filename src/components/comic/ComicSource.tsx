import { useAdaptationSourceContent } from '../../hooks/useAdaptationSourceContent'
import type { AdaptationProject, AdaptationSourceUnit, WorkspaceScope } from '../../lib/types'

export default function ComicSource({ scope, root, units }: {
  scope: WorkspaceScope
  root: AdaptationProject
  units: AdaptationSourceUnit[]
}) {
  const { selected, content, error, busy, read } = useAdaptationSourceContent(scope, root)
  const sourceKinds = { work: '作品信息', 'outline-node': '大纲', chapter: '正文' }
  return <section className="cp-source">
    <h3>本次改编的原作范围</h3>
    <p>固定来源 v{root.activeSourceManifestVersion} · {units.length} 个单元。原小说与漫画分别保存。</p>
    <div className="cp-source-layout">
      <nav aria-label="原作来源单元">
        {units.map(unit => <button type="button" className={selected === unit.sourceUnitKey ? 'active' : ''}
          aria-pressed={selected === unit.sourceUnitKey} disabled={busy} key={unit.sourceUnitKey}
          onClick={() => void read(unit.sourceUnitKey)}>
          <span className="cp-source-unit-title">{unit.label}</span>
          <small className="cp-source-unit-meta"><span>{sourceKinds[unit.sourceKind]}</span><span>{unit.wordCount} 字</span></small>
        </button>)}
      </nav>
      <article aria-label="原作内容" aria-busy={busy}>
        {error && <p role="alert">{error}</p>}
        {busy ? <p role="status">读取原文…</p> : content ? <pre>{content}</pre>
          : <p>{selected ? '此来源单元没有可显示的文本。' : '选择来源单元，查看原文证据。原作已变化时，请先核对更新提示。'}</p>}
      </article>
    </div>
  </section>
}
