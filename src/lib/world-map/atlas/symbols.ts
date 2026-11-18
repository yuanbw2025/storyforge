import symbolUrl from '../../../assets/world-map/watercolor-symbols.webp?url'
import inkSymbolUrl from '../../../assets/world-map/ink-mountains-symbols.png?url'

export type AtlasSymbolStyle = 'watercolor' | 'ink'
const pending: Partial<Record<AtlasSymbolStyle, Promise<HTMLImageElement>>> = {}
/** One bundled, same-origin sheet, shared by candidate, reader and exporter. */
export function loadAtlasSymbols(style: AtlasSymbolStyle = 'watercolor') {
  if (!pending[style]) {
    const image = new Image()
    image.src = style === 'ink' ? inkSymbolUrl : symbolUrl
    pending[style] = image
      .decode()
      .then(() => image)
      .catch((cause) => {
        delete pending[style]
        throw cause
      })
  }
  return pending[style]!
}
export function stamp(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  index: number,
  x: number,
  y: number,
  width: number,
) {
  const w = sheet.naturalWidth / 4,
    h = sheet.naturalHeight / 2
  ctx.drawImage(
    sheet,
    (index % 4) * w,
    Math.floor(index / 4) * h,
    w,
    h,
    x - width / 2,
    y - ((width * h) / w) * 0.88,
    width,
    (width * h) / w,
  )
}
