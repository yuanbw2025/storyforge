import { nanoid } from 'nanoid'
import { Check, ImagePlus, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import type {
  AdaptationSourceUnit,
  ComicMediaAsset,
  ComicVisualSubject,
  WorkspaceScope,
} from '../../lib/types'
import { deleteComicVisualSubject } from '../../lib/comic/service'
import { useDialog } from '../shared/Dialog'
import {
  EMPTY_COMIC_SUBJECT_DESIGN,
  type ComicStudioAction,
  type ComicSubjectDraft,
  type RemoveComicAsset,
  type SelectComicAsset,
  type StateSetter,
} from './studio-model'

interface Props {
  scope: WorkspaceScope
  units: AdaptationSourceUnit[]
  subjects: ComicVisualSubject[]
  selectedSubjectId: number | null
  setSelectedSubjectId: StateSetter<number | null>
  subjectDraft: ComicSubjectDraft
  setSubjectDraft: StateSetter<ComicSubjectDraft>
  characterOptions: Array<{ id: number; name: string }>
  locationOptions: Array<{ id: string; name: string }>
  selectedSubject: ComicVisualSubject | null
  subjectAssets: ComicMediaAsset[]
  assetUrls: Record<string, string>
  busy: boolean
  saveSubject: () => void
  generateMedia: (regenerate: boolean, subject?: boolean) => Promise<void>
  upload: (file: File, subject?: boolean) => Promise<void>
  selectAsset: SelectComicAsset
  removeAsset: RemoveComicAsset
  act: ComicStudioAction
}

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

export default function ComicVisualPanel({
  scope,
  units,
  subjects,
  selectedSubjectId,
  setSelectedSubjectId,
  subjectDraft,
  setSubjectDraft,
  characterOptions,
  locationOptions,
  selectedSubject,
  subjectAssets,
  assetUrls,
  busy,
  saveSubject,
  generateMedia,
  upload,
  selectAsset,
  removeAsset,
  act,
}: Props) {
  const dialog = useDialog()
  const selectedReference = selectedSubject?.selectedMediaAssetKey
    ? subjectAssets.find(asset => asset.stableKey === selectedSubject.selectedMediaAssetKey) ?? null
    : null
  const patchDesign = <K extends keyof ComicSubjectDraft['design']>(
    key: K,
    value: ComicSubjectDraft['design'][K],
  ) => setSubjectDraft((current) => ({ ...current, design: { ...current.design, [key]: value } }))

  const beginNewSubject = () => {
    setSelectedSubjectId(null)
    setSubjectDraft({
      stableKey: `subject_${nanoid(8)}`,
      kind: 'prop',
      characterId: null,
      locationRefKey: null,
      label: '',
      design: structuredClone(EMPTY_COMIC_SUBJECT_DESIGN),
      sourceUnitIds: units.flatMap((unit) => unit.id ? [unit.id] : []).slice(0, 1),
      status: 'draft',
    })
  }

  return (
    <div className="comic-visual-layout">
      <aside>
        <header>
          <div><span>VISUAL BIBLE</span><strong>视觉锚点</strong></div>
          <button onClick={beginNewSubject}><Plus />新建</button>
        </header>
        {subjects.map((subject) => (
          <button
            key={subject.id}
            className={subject.id === selectedSubjectId ? 'active' : ''}
            onClick={() => setSelectedSubjectId(subject.id!)}
          >
            <span><strong>{subject.label}</strong><small>{subject.kind}</small></span>
            <em>{subject.status === 'locked' ? '已锁定' : subject.status === 'reviewed' ? '已审定' : '草稿'}</em>
            {subject.selectedMediaAssetKey && <Check />}
          </button>
        ))}
      </aside>
      <main>
        <section className="comic-subject-hero">
          <div className="comic-subject-reference">
            {selectedReference && assetUrls[selectedReference.stableKey]
              ? <img src={assetUrls[selectedReference.stableKey]} alt={`${selectedSubject?.label ?? '视觉条目'} 当前参考图`} />
              : <div><Sparkles /><span>{selectedSubject ? '尚未选定参考图' : '选择视觉锚点'}</span><small>角色、地点、道具和画风都应先形成稳定视觉身份</small></div>}
          </div>
          <div className="comic-subject-summary">
            <span>{selectedSubject?.kind?.toUpperCase() ?? 'VISUAL DEVELOPMENT'}</span>
            <h3>{selectedSubject?.label || subjectDraft.label || '新视觉锚点'}</h3>
            <p>{subjectDraft.design.description || '在这里固定轮廓、脸部、服装、材质和绝不能漂移的标志物。设定图用于跨格一致性，不是普通图库。'}</p>
            <div>{subjectDraft.design.palette.slice(0, 5).map(color => <i key={color} title={color} style={{ background: /^#[0-9a-f]{6}$/i.test(color) ? color : undefined }}><span>{color}</span></i>)}</div>
          </div>
        </section>
        <div className="comic-visual-form">
          <label>
            稳定 key
            <input value={subjectDraft.stableKey} onChange={(event) => setSubjectDraft({ ...subjectDraft, stableKey: event.target.value })} />
          </label>
          <label>
            类型
            <select
              value={subjectDraft.kind}
              onChange={(event) => setSubjectDraft({
                ...subjectDraft,
                kind: event.target.value as ComicVisualSubject['kind'],
                characterId: null,
                locationRefKey: null,
              })}
            >
              {['character', 'location', 'prop', 'style'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            名称
            <input value={subjectDraft.label} onChange={(event) => setSubjectDraft({ ...subjectDraft, label: event.target.value })} />
          </label>
          <label>
            状态
            <select value={subjectDraft.status} onChange={(event) => setSubjectDraft({ ...subjectDraft, status: event.target.value as ComicVisualSubject['status'] })}>
              <option value="draft">草稿</option>
              <option value="reviewed">已审定</option>
              <option value="locked">锁定</option>
            </select>
          </label>
          {subjectDraft.kind === 'character' && (
            <label>
              绑定本作品角色
              <select value={subjectDraft.characterId ?? ''} onChange={(event) => setSubjectDraft({ ...subjectDraft, characterId: event.target.value ? Number(event.target.value) : null })}>
                <option value="">请选择已登场角色</option>
                {characterOptions.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
              </select>
            </label>
          )}
          {subjectDraft.kind === 'location' && (
            <label>
              绑定世界地点
              <select value={subjectDraft.locationRefKey ?? ''} onChange={(event) => setSubjectDraft({ ...subjectDraft, locationRefKey: event.target.value || null })}>
                <option value="">请选择地点</option>
                {locationOptions.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          )}
          <label className="wide">设计描述<textarea value={subjectDraft.design.description} onChange={(event) => patchDesign('description', event.target.value)} /></label>
          <label>轮廓<textarea value={subjectDraft.design.silhouette} onChange={(event) => patchDesign('silhouette', event.target.value)} /></label>
          <label>脸部特征<textarea value={subjectDraft.design.facialFeatures} onChange={(event) => patchDesign('facialFeatures', event.target.value)} /></label>
          <label>发型与服装<textarea value={subjectDraft.design.hairAndCostume} onChange={(event) => patchDesign('hairAndCostume', event.target.value)} /></label>
          <label>色板（每行）<textarea value={subjectDraft.design.palette.join('\n')} onChange={(event) => patchDesign('palette', lines(event.target.value))} /></label>
          <label>材质（每行）<textarea value={subjectDraft.design.materials.join('\n')} onChange={(event) => patchDesign('materials', lines(event.target.value))} /></label>
          <label>标志物（每行）<textarea value={subjectDraft.design.distinguishingMarks.join('\n')} onChange={(event) => patchDesign('distinguishingMarks', lines(event.target.value))} /></label>
          <label>禁改项（每行）<textarea value={subjectDraft.design.prohibitedChanges.join('\n')} onChange={(event) => patchDesign('prohibitedChanges', lines(event.target.value))} /></label>
          <fieldset className="wide comic-source-units">
            <legend>来源证据</legend>
            {units.map((unit) => (
              <label key={unit.id}>
                <input
                  type="checkbox"
                  checked={subjectDraft.sourceUnitIds.includes(unit.id!)}
                  onChange={(event) => setSubjectDraft({
                    ...subjectDraft,
                    sourceUnitIds: event.target.checked
                      ? [...subjectDraft.sourceUnitIds, unit.id!]
                      : subjectDraft.sourceUnitIds.filter((id) => id !== unit.id),
                  })}
                />
                {unit.label}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="comic-inline-actions">
          <button className="primary" onClick={saveSubject}><Save />保存视觉条目</button>
          {selectedSubject && (
            <>
              <button onClick={() => void generateMedia(false, true)} disabled={busy}><Sparkles />生成设定图</button>
              <label className="comic-upload">
                <ImagePlus />上传设定图
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, true) }} />
              </label>
              <button
                className="danger"
                onClick={() => void (async () => {
                  if (await dialog.confirm({
                    title: '删除视觉条目？',
                    message: '连续性引用和该条目的媒体候选会被清理；无引用 Blob 将安全回收。',
                    confirmText: '删除视觉条目',
                    tone: 'danger',
                  })) {
                    await act(() => deleteComicVisualSubject({ scope, subjectId: selectedSubject.id!, clearReferences: true }))
                  }
                })()}
              >
                <Trash2 />删除
              </button>
            </>
          )}
        </div>
        {selectedSubject && (
          <div className="comic-gallery subject">
            {subjectAssets.map((asset) => (
              <article key={asset.stableKey} className={selectedSubject.selectedMediaAssetKey === asset.stableKey ? 'selected' : ''}>
                {assetUrls[asset.stableKey]
                  ? <img src={assetUrls[asset.stableKey]} alt={`${selectedSubject.label} 设定图候选`} />
                  : <div>验证图片中…</div>}
                <small>{asset.origin} · {asset.quality.width}×{asset.quality.height}</small>
                <footer>
                  <button onClick={() => selectAsset(asset, true)}><Check />选用</button>
                  <button onClick={() => void removeAsset(asset)}><Trash2 /></button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
