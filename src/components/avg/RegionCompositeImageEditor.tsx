import { useRef, type PointerEvent } from 'react'
import type { AvgRegionRectV1 } from '../../lib/avg/image-region-composite-contract'

const fields = ['x', 'y', 'width', 'height'] as const
const labels = ['左侧', '顶部', '宽度', '高度']
const zero = { x: 0, y: 0, width: 0, height: 0 }

/** Visual selection and numeric fallback share the exact normalized rectangle.
 * The SVG has the physical image's aspect ratio, so no letterbox is sampled. */
export default function RegionCompositeImageEditor({ label, url, width, height, value, disabled, onChange }: {
  label: string; url: string; width: number; height: number; value?: AvgRegionRectV1; disabled: boolean; onChange: (rect: AvgRegionRectV1) => void
}) {
  const drag = useRef<{ pointerId: number; x: number; y: number; before: AvgRegionRectV1; box: DOMRect } | null>(null)
  const point = (event: PointerEvent<SVGSVGElement>, box: DOMRect) => {
    if (!box.width || !box.height) return null
    return { x: Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * 10000),
      y: Math.round(Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) * 10000) }
  }
  return <div><p>{label} · {width} × {height}</p>
    <svg aria-label={label} role="img" viewBox="0 0 10000 10000" preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', aspectRatio: `${width}/${height}`, touchAction: disabled ? 'auto' : 'none', background: '#c6c6c6', cursor: disabled ? 'default' : 'crosshair' }}
      onPointerDown={event => { if (disabled || !url || event.button !== 0 || event.isPrimary === false) return; const box = event.currentTarget.getBoundingClientRect(), p = point(event, box); if (!p) return
        drag.current = { ...p, pointerId: event.pointerId, before: value ?? zero, box }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { const start = drag.current; if (!start || start.pointerId !== event.pointerId || disabled) return; const p = point(event, start.box); if (!p) return
        onChange({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }) }}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } }}
      onPointerCancel={() => { const previous = drag.current?.before; drag.current = null; if (previous) onChange(previous) }}
      onLostPointerCapture={() => { const previous = drag.current?.before; drag.current = null; if (previous) onChange(previous) }}>
      <title>{label}：拖动标出区域，也可填写下方百分比</title>
      <image href={url} width={10000} height={10000} preserveAspectRatio="none" pointerEvents="none" />
      {!!value?.width && !!value.height && <rect {...value} fill="rgba(60,170,255,0.12)" stroke="#087cd8" strokeWidth={45} pointerEvents="none" />}
    </svg>
    <fieldset disabled={disabled || !value} style={{ minWidth: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}><legend>{label}区域（%）</legend>{fields.map((field, index) => <label key={field} style={{ minWidth: 0 }}>{labels[index]}
      <input aria-label={`${label}${labels[index]}（%）`} type="number" min={0} max={100} step={0.01} value={(value ?? zero)[field] / 100}
        style={{ width: '100%', minWidth: 0 }}
        onChange={event => { const number = Number(event.target.value); if (value && Number.isFinite(number)) onChange({ ...value, [field]: Math.round(number * 100) }) }} />
    </label>)}</fieldset>
  </div>
}
