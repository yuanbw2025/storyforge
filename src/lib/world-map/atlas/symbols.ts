import symbolUrl from '../../../assets/world-map/watercolor-symbols.webp?url'

let pending: Promise<HTMLImageElement> | undefined
/** One bundled, same-origin sheet, shared by candidate, reader and exporter. */
export function loadAtlasSymbols() {
  if (!pending) {
    const image = new Image()
    image.src = symbolUrl
    pending = image
      .decode()
      .then(() => image)
      .catch((cause) => {
        pending = undefined
        throw cause
      })
  }
  return pending
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
