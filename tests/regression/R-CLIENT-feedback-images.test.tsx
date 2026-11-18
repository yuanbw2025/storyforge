import { afterEach, expect, it, vi } from 'vitest'
import { imageFormat, readFeedbackImage, feedbackImageBytes } from '../../src/lib/feedback/attachments'
import { submitClientFeedback, type ClientFeedback } from '../../src/lib/feedback/client-support'
import imageFixtures from '../fixtures/feedback-images.json'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKioAAAAASUVORK5CYII='
const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('checks actual screenshot bytes and limits before creating a filename without private source names', async () => {
  const close = vi.fn()
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({width:1,height:1,close}))
  expect(imageFormat(bytes)).toBe('image/png')
  const file = new File([bytes], 'private-project-screenshot.png', {type:'image/png'})
  const image = await readFeedbackImage(file, 0)
  expect(image).toEqual({name:'screenshot-1.png',mime:'image/png',data:png})
  expect(feedbackImageBytes(image)).toBe(bytes.length)
  expect(close).toHaveBeenCalledOnce()
  await expect(readFeedbackImage(new File(['<svg/>'], 'fake.png', {type:'image/png'}), 0)).rejects.toThrow('实际格式')
  await expect(readFeedbackImage(new File([bytes], 'fake.jpg', {type:'image/jpeg'}), 0)).rejects.toThrow('实际格式')
  await expect(readFeedbackImage(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png'), 0)).rejects.toThrow('2 MB')
  const hugePixels = new Uint8Array(bytes)
  const header = new DataView(hugePixels.buffer)
  header.setUint32(16, 100000); header.setUint32(20, 100000)
  await expect(readFeedbackImage(new File([hugePixels], 'pixel-bomb.png', {type:'image/png'}), 0)).rejects.toThrow('截图像素')
  expect(createImageBitmap).toHaveBeenCalledTimes(1)
})
const feedback = (): ClientFeedback => ({version:1,id:crypto.randomUUID(),kind:'bug',title:'问题标题',description:'完整问题描述',steps:'触发操作',expected:'正确结果',client:{build:'v4.0.7+local',platform:'macOS',distribution:'web'},attachments:[{name:'screenshot-1.png',mime:'image/png',data:png}]})
it.each(['png','jpeg','gif','webp'] as const)('accepts real %s headers, rejects a forged header and requires local decode', async format => {
  const close=vi.fn()
  const decode=vi.fn().mockResolvedValue({width:1,height:1,close})
  vi.stubGlobal('createImageBitmap',decode)
  const data=Uint8Array.from(atob(imageFixtures[format]),c=>c.charCodeAt(0))
  const file=new File([data],`source.${format}`,{type:`image/${format}`})
  expect((await readFeedbackImage(file,0)).mime).toBe(`image/${format}`)
  decode.mockRejectedValueOnce(new Error('isolated decoder refusal'))
  await expect(readFeedbackImage(file,0)).rejects.toThrow('截图无法解码')
  data[0]=0
  await expect(readFeedbackImage(new File([data],'forged',{type:`image/${format}`}),0)).rejects.toThrow('实际格式')
})
it('preserves screenshots when an older server cannot receive them and retries capability negotiation later', async () => {
  const body = feedback()
  const fetcher = vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}'))
  await expect(submitClientFeedback(body)).rejects.toThrow('尚未支持')
  expect(fetcher).toHaveBeenCalledTimes(1)
  fetcher.mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST' ? {accepted:true,id:body.id,attachmentCount:1} : {feedbackForm:2,feedbackImages:1})))
  await expect(submitClientFeedback(body)).resolves.toBe(body.id)
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]?.body)).attachments).toEqual(body.attachments)
})
it('requires the matching receipt and attachment count, with unchanged bytes and id on retry', async () => {
  const body = feedback()
  let count = 0
  const fetcher = vi.spyOn(globalThis,'fetch').mockImplementation(async (_url,init) => new Response(JSON.stringify(init?.method !== 'POST' ? {feedbackForm:2,feedbackImages:1} : {accepted:true,id:body.id,attachmentCount:count})))
  await expect(submitClientFeedback(body)).rejects.toThrow('未收到')
  count = 1
  await expect(submitClientFeedback(body)).resolves.toBe(body.id)
  const posts = fetcher.mock.calls.filter(([,init]) => init?.method === 'POST')
  expect(posts).toHaveLength(2)
  expect(posts[0][1]?.body).toBe(posts[1][1]?.body)
})
