import { decodeRasterImageV1 } from '../../media/raster-image'

export function atlasPaintFrame(width: number, height: number, protocol: 'native' | 'openai-edit' = 'native') {
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw Error('地图画幅无效')
  const ratios = protocol === 'openai-edit' ? [[1, 1], [3, 2], [2, 3]]
    : [[1, 1], [3, 4], [4, 3], [16, 9], [9, 16], [2, 3], [3, 2], [21, 9]]
  const aspect = width / height
  const [a, b] = ratios.reduce((best, next) => Math.abs(Math.log(next[0] / next[1] / aspect))
    < Math.abs(Math.log(best[0] / best[1] / aspect)) ? next : best)
  const unit = protocol === 'openai-edit' && a === b ? 1024 : Math.floor(1536 / Math.max(a, b)), w = a * unit, h = b * unit
  const contentWidth = Math.min(w, h * aspect), contentHeight = contentWidth / aspect
  return { ratio: `${a}:${b}`, width: w, height: h,
    x: (w - contentWidth) / 2 / w, y: (h - contentHeight) / 2 / h,
    contentWidth: contentWidth / w, contentHeight: contentHeight / h }
}
export type AtlasPaintFrame = ReturnType<typeof atlasPaintFrame>

async function imageCanvas<T>(blob: Blob, render: (image: HTMLImageElement) => T | Promise<T>): Promise<T> {
  const url = URL.createObjectURL(blob), image = new Image()
  try { image.src = url; await image.decode(); return await render(image) }
  finally { URL.revokeObjectURL(url) }
}
function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('地图图片编码失败')), 'image/png'))
}

/** Pad rather than stretch to a provider-native ratio; crop only that padding
 * from the returned image. No geographic geometry is changed. */
export async function frameAtlasPaintReference(reference: Blob, frame: AtlasPaintFrame): Promise<Blob> {
  return imageCanvas(reference, async image => {
    const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height
    const c = canvas.getContext('2d')!; c.fillStyle = '#0b5058'; c.fillRect(0, 0, canvas.width, canvas.height)
    c.drawImage(image, frame.x * frame.width, frame.y * frame.height,
      frame.contentWidth * frame.width, frame.contentHeight * frame.height)
    return png(canvas)
  })
}

export async function cropAtlasPaintFrame(data: ArrayBuffer, frame: AtlasPaintFrame): Promise<ArrayBuffer> {
  const info = await decodeRasterImageV1(data)
  if (Math.abs(info.width / info.height / (frame.width / frame.height) - 1) > 0.02) {
    throw Error('图片服务返回了不同画幅，未拉伸或替换原地图。')
  }
  return imageCanvas(new Blob([data], { type: info.mimeType }), async image => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(info.width * frame.contentWidth); canvas.height = Math.round(info.height * frame.contentHeight)
    canvas.getContext('2d')!.drawImage(image, info.width * frame.x, info.height * frame.y,
      info.width * frame.contentWidth, info.height * frame.contentHeight, 0, 0, canvas.width, canvas.height)
    return (await png(canvas)).arrayBuffer()
  })
}
