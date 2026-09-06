import { nanoid } from 'nanoid'
import { Check, ImagePlus, Merge, Plus, RefreshCw, Save, Scissors, Sparkles, Trash2, X } from 'lucide-react'
import type {
  AdaptationSourceUnit,
  ComicLetteringItemV1,
  ComicMediaAsset,
  ComicPanel,
  ComicVisualSubject,
  WorkspaceScope,
} from '../../lib/types'
import {
  comicPanelFramesV1,
  mergeComicPanelsV1,
  moveComicPanelV1,
  splitComicPanelV1,
} from '../../lib/comic/service'
import type {
  ComicPageGroup,
  ComicRequestAbortRef,
  ComicRightsState,
  ComicStudioAction,
  RemoveComicAsset,
  SelectComicAsset,
  StateSetter,
} from './studio-model'

interface Props {
  scope: WorkspaceScope
  groups: ComicPageGroup[]
  currentGroup: ComicPageGroup | null
  editingPanel: ComicPanel | null
  setEditingPanel: StateSetter<ComicPanel | null>
  units: AdaptationSourceUnit[]
  subjects: ComicVisualSubject[]
  busy: boolean
  savePanel: () => void
  rights: ComicRightsState
  generateMedia: (regenerate: boolean, subject?: boolean) => Promise<void>
  abortRef: ComicRequestAbortRef
  upload: (file: File, subject?: boolean) => Promise<void>
  panelAssets: ComicMediaAsset[]
  assetUrls: Record<string, string>
  selectAsset: SelectComicAsset
  removeAsset: RemoveComicAsset
  act: ComicStudioAction
}

function newLettering(): ComicLetteringItemV1 {
  return {
    id: `letter_${nanoid(8)}`,
    kind: 'speech',
    text: '对白',
    frame: { x: 0.58, y: 0.08, width: 0.34, height: 0.24 },
    direction: 'horizontal',
    fontFamily: 'storyforge-sans',
    fontSize: 32,
    textColor: '#111111',
    fillColor: '#ffffff',
    strokeColor: '#111111',
    strokeWidth: 3,
    tail: null,
    zIndex: 10,
  }
}

const SHOT_SIZES = [['extreme-wide', '大远景'], ['wide', '远景'], ['full', '全身'], ['medium', '中景'], ['close-up', '近景'], ['extreme-close-up', '特写'], ['insert', '插入镜头']] as const
const SHOT_ANGLES = [['eye-level', '平视'], ['high', '俯拍'], ['low', '仰拍'], ['overhead', '顶视'], ['dutch', '倾斜镜头']] as const
const SHOT_MOVEMENTS = [['static', '静态定格'], ['pan', '横移感'], ['tilt', '纵移感'], ['track', '跟随感'], ['zoom', '推拉感'], ['handheld', '手持感']] as const
const LETTERING_KINDS = [['speech', '对白气泡'], ['thought', '思绪气泡'], ['caption', '旁白框'], ['sfx', '拟声字']] as const

export default function ComicPanelInspector({
  scope,
  groups,
  currentGroup,
  editingPanel,
  setEditingPanel,
  units,
  subjects,
  busy,
  savePanel,
  rights,
  generateMedia,
  abortRef,
  upload,
  panelAssets,
  assetUrls,
  selectAsset,
  removeAsset,
  act,
}: Props) {
  if (!editingPanel) return <aside className="comic-inspector"><p>选择一格开始编辑。</p></aside>

  const patchPanel = (patch: Partial<ComicPanel>) => setEditingPanel({ ...editingPanel, ...patch })
  const patchShot = (patch: Partial<ComicPanel['shot']>) => patchPanel({ shot: { ...editingPanel.shot, ...patch } })
  const patchTransform = (patch: Partial<ComicPanel['imageTransform']>) => patchPanel({ imageTransform: { ...editingPanel.imageTransform, ...patch } })
  const patchLettering = (index: number, patch: Partial<ComicLetteringItemV1>) => patchPanel({
    lettering: editingPanel.lettering.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  })

  return (
    <aside className="comic-inspector">
      <header>
        <div><strong>格 {editingPanel.order + 1}</strong><small>{editingPanel.stableKey}</small></div>
        <select value={editingPanel.status} onChange={(event) => patchPanel({ status: event.target.value as ComicPanel['status'] })}>
          <option value="draft">草稿</option>
          <option value="reviewed">已审定</option>
          <option value="locked">锁定</option>
        </select>
      </header>
      <section>
        <h3>画框与镜头</h3>
        <p className="comic-section-hint">镜头要服务这一格唯一的可画瞬间，避免把连续动作塞进同一画面。</p>
        <div className="comic-number-grid">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <label key={key}>{key}<input type="number" min={0} max={1} step={0.01} value={editingPanel.frame[key]} onChange={(event) => patchPanel({ frame: { ...editingPanel.frame, [key]: Number(event.target.value) } })} /></label>
          ))}
        </div>
        <div className="comic-select-grid">
          <label className="comic-field"><span>景别</span><select value={editingPanel.shot.size} onChange={(event) => patchShot({ size: event.target.value as ComicPanel['shot']['size'] })}>{SHOT_SIZES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="comic-field"><span>机位</span><select value={editingPanel.shot.angle} onChange={(event) => patchShot({ angle: event.target.value as ComicPanel['shot']['angle'] })}>{SHOT_ANGLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="comic-field"><span>动势</span><select value={editingPanel.shot.movement} onChange={(event) => patchShot({ movement: event.target.value as ComicPanel['shot']['movement'] })}>{SHOT_MOVEMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label className="comic-field"><span>构图与视觉焦点</span><textarea value={editingPanel.shot.composition} onChange={(event) => patchShot({ composition: event.target.value })} placeholder="例如：人物置于右下三分点，门框形成前景，视线指向下一格" /></label>
        <label className="comic-field"><span>这一格的可见动作</span><textarea value={editingPanel.action} onChange={(event) => patchPanel({ action: event.target.value })} placeholder="只写摄像机能看到的一瞬间" /></label>
      </section>
      <section>
        <h3>成图裁切</h3>
        <div className="comic-select-grid">
          <label>适配<select value={editingPanel.imageTransform.fit} onChange={(event) => patchTransform({ fit: event.target.value as ComicPanel['imageTransform']['fit'] })}><option value="cover">铺满裁切</option><option value="contain">完整显示</option></select></label>
          {([
            ['scale', '缩放', 0.1, 5, 0.05],
            ['offsetX', '水平偏移', -1, 1, 0.01],
            ['offsetY', '垂直偏移', -1, 1, 0.01],
            ['rotation', '旋转角度', -180, 180, 1],
          ] as const).map(([key, label, min, max, step]) => (
            <label key={key}>{label}<input type="number" min={min} max={max} step={step} value={editingPanel.imageTransform[key]} onChange={(event) => patchTransform({ [key]: Number(event.target.value) })} /></label>
          ))}
        </div>
      </section>
      <section>
        <h3>来源与连续性</h3>
        <div className="comic-check-list">
          {units.map((unit) => (
            <label key={unit.id}>
              <input
                type="checkbox"
                checked={editingPanel.sourceUnitIds.includes(unit.id!)}
                onChange={(event) => patchPanel({
                  sourceUnitIds: event.target.checked
                    ? [...editingPanel.sourceUnitIds, unit.id!]
                    : editingPanel.sourceUnitIds.filter((id) => id !== unit.id),
                })}
              />
              {unit.label}
            </label>
          ))}
          {subjects.map((subject) => {
            const continuity = editingPanel.continuityRefs.find((ref) => ref.subjectKey === subject.stableKey)
            return (
              <div className="comic-continuity-row" key={subject.stableKey}>
                <label>
                  <input
                    type="checkbox"
                    checked={!!continuity}
                    onChange={(event) => patchPanel({
                      continuityRefs: event.target.checked
                        ? [...editingPanel.continuityRefs, { subjectKey: subject.stableKey, note: '' }]
                        : editingPanel.continuityRefs.filter((ref) => ref.subjectKey !== subject.stableKey),
                    })}
                  />
                  {subject.label}
                </label>
                {continuity && <input value={continuity.note} placeholder="本格连续性备注" onChange={(event) => patchPanel({ continuityRefs: editingPanel.continuityRefs.map((ref) => ref.subjectKey === subject.stableKey ? { ...ref, note: event.target.value } : ref) })} />}
              </div>
            )
          })}
        </div>
      </section>
      <section>
        <h3>视觉 Prompt</h3>
        <p className="comic-section-hint">系统会把镜头、相邻格、角色状态、视觉圣经和排字安全区编译进最终生图请求。</p>
        <label className="comic-field"><span>本格补充指令</span><textarea value={editingPanel.visualPrompt} onChange={(event) => patchPanel({ visualPrompt: event.target.value })} /></label>
        <label className="comic-field"><span>负向约束</span><textarea value={editingPanel.negativePrompt} onChange={(event) => patchPanel({ negativePrompt: event.target.value })} /></label>
      </section>
      <section>
        <h3>本地排字</h3>
        {editingPanel.lettering.map((item, index) => (
          <article className="comic-lettering" key={item.id}>
            <div>
              <select value={item.kind} onChange={(event) => patchLettering(index, { kind: event.target.value as ComicLetteringItemV1['kind'] })}>{LETTERING_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select value={item.direction} onChange={(event) => patchLettering(index, { direction: event.target.value as ComicLetteringItemV1['direction'] })}><option value="horizontal">横排</option><option value="vertical">竖排</option></select>
              <button onClick={() => patchPanel({ lettering: editingPanel.lettering.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></button>
            </div>
            <textarea value={item.text} onChange={(event) => patchLettering(index, { text: event.target.value })} />
            <div className="comic-number-grid">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <label key={key}>{key}<input type="number" min={0} max={1} step={0.01} value={item.frame[key]} onChange={(event) => patchLettering(index, { frame: { ...item.frame, [key]: Number(event.target.value) } })} /></label>
              ))}
            </div>
          </article>
        ))}
        <button onClick={() => patchPanel({ lettering: [...editingPanel.lettering, newLettering()] })}><Plus />增加排字</button>
      </section>
      <section>
        <h3>格结构操作</h3>
        <div className="comic-inline-actions">
          <button onClick={() => void act(() => splitComicPanelV1({ scope, panelId: editingPanel.id!, expectedRevision: editingPanel.revision, direction: 'vertical' }))}><Scissors />左右拆格</button>
          <button onClick={() => void act(() => splitComicPanelV1({ scope, panelId: editingPanel.id!, expectedRevision: editingPanel.revision, direction: 'horizontal' }))}><Scissors />上下拆格</button>
          {(() => {
            const next = currentGroup?.panels[editingPanel.order + 1]
            return next ? <button onClick={() => void act(() => mergeComicPanelsV1({ scope, firstPanelId: editingPanel.id!, secondPanelId: next.id!, expectedFirstRevision: editingPanel.revision, expectedSecondRevision: next.revision }))}><Merge />与下一格合并</button> : null
          })()}
          {groups.length > 1 && (
            <select
              aria-label="跨页移动"
              defaultValue=""
              onChange={(event) => {
                const target = groups.find((group) => group.page.id === Number(event.target.value))
                if (target) void act(() => moveComicPanelV1({
                  scope,
                  panelId: editingPanel.id!,
                  targetPageId: target.page.id!,
                  targetOrder: target.panels.length,
                  targetFrame: comicPanelFramesV1(target.panels.length + 1)[target.panels.length],
                  expectedRevision: editingPanel.revision,
                }))
                event.currentTarget.value = ''
              }}
            >
              <option value="">移至其他页…</option>
              {groups.filter((group) => group.page.id !== currentGroup?.page.id && group.panels.length < 9).map((group) => <option key={group.page.id} value={group.page.id}>第 {group.page.order + 1} 页</option>)}
            </select>
          )}
        </div>
      </section>
      <button className="comic-save-panel" onClick={savePanel} disabled={busy || editingPanel.status === 'locked'}><Save />保存格、排字与裁切</button>
      <section>
        <h3>图片候选</h3>
        <div className="comic-rights">
          <textarea value={rights.declaration} onChange={(event) => rights.setDeclaration(event.target.value)} placeholder="来源与权利声明" />
          <select value={rights.commercialUse} onChange={(event) => rights.setCommercialUse(event.target.value as ComicRightsState['commercialUse'])}><option value="unknown">商用未知</option><option value="allowed">允许商用</option><option value="restricted">限制商用</option></select>
          <select value={rights.redistribution} onChange={(event) => rights.setRedistribution(event.target.value as ComicRightsState['redistribution'])}><option value="unknown">再分发未知</option><option value="allowed">允许再分发</option><option value="restricted">限制再分发</option></select>
        </div>
        <div className="comic-inline-actions">
          <button onClick={() => void generateMedia(false)} disabled={busy}><Sparkles />生成/恢复</button>
          <button onClick={() => void generateMedia(true)} disabled={busy}><RefreshCw />明确再生成</button>
          {busy && abortRef.current && <button onClick={() => abortRef.current?.abort()}><X />取消请求</button>}
          <label className="comic-upload">
            <ImagePlus />上传替换
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
          </label>
        </div>
        <div className="comic-gallery">
          {panelAssets.map((asset) => (
            <article key={asset.stableKey} className={editingPanel.selectedMediaAssetKey === asset.stableKey ? 'selected' : ''}>
              {assetUrls[asset.stableKey] ? <img src={assetUrls[asset.stableKey]} alt="漫画格候选" /> : <div>验证图片中…</div>}
              <small>{asset.origin} · {asset.quality.width}×{asset.quality.height}</small>
              <footer><button onClick={() => selectAsset(asset)}><Check />选用</button><button onClick={() => void removeAsset(asset)}><Trash2 /></button></footer>
            </article>
          ))}
        </div>
      </section>
    </aside>
  )
}
