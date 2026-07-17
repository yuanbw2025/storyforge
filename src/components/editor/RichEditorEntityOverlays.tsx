import type { EditorEntityReference } from '../../lib/editor/entity-reference'

interface Props {
  menu: { x: number; y: number } | null
  candidates: readonly EditorEntityReference[]
  activeIndex: number
  hovered: { reference: EditorEntityReference; x: number; y: number } | null
  onInsert: (reference: EditorEntityReference) => void
}

export default function RichEditorEntityOverlays({ menu, candidates, activeIndex, hovered, onInsert }: Props) {
  return (
    <>
      {menu && candidates.length > 0 && (
        <div
          className="fixed z-[80] w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded border border-border bg-bg-surface shadow-xl"
          style={{ left: Math.max(16, Math.min(menu.x, window.innerWidth - 304)), top: menu.y }}
        >
          {candidates.map((reference, index) => (
            <button
              key={reference.id}
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => onInsert(reference)}
              className={`block w-full px-3 py-2 text-left ${index === activeIndex ? 'bg-accent/10' : 'hover:bg-bg-hover'}`}
            >
              <span className="flex items-center justify-between gap-3 text-xs">
                <strong className="truncate text-text-primary">{reference.name}</strong>
                <span className="shrink-0 text-text-muted">{reference.kindLabel}</span>
              </span>
              {reference.summary && <span className="mt-1 block truncate text-[11px] text-text-muted">{reference.summary}</span>}
            </button>
          ))}
        </div>
      )}
      {hovered && !menu && (
        <div
          className="pointer-events-none fixed z-[70] w-72 max-w-[calc(100vw-2rem)] rounded border border-border bg-bg-surface p-3 shadow-xl"
          style={{ left: Math.max(16, Math.min(hovered.x, window.innerWidth - 304)), top: hovered.y }}
        >
          <div className="flex items-center justify-between gap-3">
            <strong className="truncate text-sm text-text-primary">{hovered.reference.name}</strong>
            <span className="shrink-0 text-[11px] text-accent">{hovered.reference.kindLabel}</span>
          </div>
          {hovered.reference.summary && <p className="mt-1 text-xs leading-5 text-text-secondary">{hovered.reference.summary}</p>}
          {hovered.reference.details.length > 0 && (
            <dl className="mt-2 space-y-1 border-t border-border pt-2 text-[11px]">
              {hovered.reference.details.map(item => (
                <div key={item.label} className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                  <dt className="text-text-muted">{item.label}</dt>
                  <dd className="text-text-secondary">{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </>
  )
}
