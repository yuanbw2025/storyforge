import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { atlasImageConfig, atlasImageConnectionProblem, defaultAtlasImageConnection } from '../../src/lib/world-map/atlas/image-connection'
import { assertAtlasPaintPackageV2, atlasTerrainHash, type AtlasPaintPackageV2 } from '../../src/lib/world-map/atlas/paint-package'
import { parseAtlasReference } from '../../src/lib/world-map/atlas/geometry'
import { requestGeminiReferenceImageV1 } from '../../src/lib/media/transport'
import { atlasPaintFrame } from '../../src/lib/world-map/atlas/paint-frame'
import { generateAtlasPaintPreview } from '../../src/lib/world-map/atlas/paint-preview'

const config = { provider: 'agnes' as const, baseUrl: 'https://fixture.invalid/v1', apiKey: 'synthetic-secret', model: 'text-model', temperature: 0.7, maxTokens: 0 }
const geometry = parseAtlasReference({ version: 1, width: 1200, height: 700, cellCoast: true,
  features: [{ kind: 'land', name: '', rank: 0, points: [[0,0],[1200,0],[1200,700],[0,700]] },
    { kind: 'ridge', name: '雪山', rank: 1, points: [[200,200]] }, { kind: 'wood', name: '森林', rank: 1, points: [[400,400]] },
    { kind: 'city', name: '城市', rank: 1, points: [[500,500]] }] })
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); const {authorViewCache}=await import('../../src/lib/storage/author-view-cache'); await authorViewCache.removePrefix('/__storyforge_atlas_author_view__/') })

describe('图片连接与地理身份', () => {
  it('文字、看图、文生图和未知能力均不冒充参考图编辑；选择图片连接不改写写作配置', () => {
    const connection = defaultAtlasImageConnection(config, 'image-preset')
    for (const capability of ['unknown','text','vision','text-to-image'] as const) {
      expect(atlasImageConnectionProblem({ ...connection, capability }, config)).toBeTruthy()
      expect(() => atlasImageConfig({ ...connection, capability }, config)).toThrow()
    }
    expect(atlasImageConfig(connection, config)).toMatchObject({ provider: 'agnes', model: 'text-model' })
    expect(config.model).toBe('text-model')
    expect(atlasImageConnectionProblem({ ...connection, presetId: '' }, config)).toMatch(/选择/)
    expect(atlasImageConnectionProblem(connection, { ...config, apiKey: '' })).toMatch(/凭据/)
  })
  it('文字与城镇编辑保留地形指纹，山林/种子改变使旧图过期，自动网格的点状山林和孔洞标记保持有效', async () => {
    expect(geometry.cellCoast).toBe(true)
    const hash = await atlasTerrainHash(geometry, 'seed')
    const labels = structuredClone(geometry); labels.features[3].name = '新城市'; labels.features[3].points = [[600,600]]
    labels.features[2].name = '林地改名'
    expect(await atlasTerrainHash(labels, 'seed')).toBe(hash)
    const changed = structuredClone(geometry); changed.features[2].points = [[410,400]]
    expect(await atlasTerrainHash(changed, 'seed')).not.toBe(hash)
    expect(await atlasTerrainHash(geometry, 'another')).not.toBe(hash)
  })
  it('OpenAI 图片编辑使用受支持的原生横竖/方形画幅，不拉伸地理', () => {
    expect(atlasPaintFrame(1200,700,'openai-edit')).toMatchObject({width:1536,height:1024,ratio:'3:2'})
    expect(atlasPaintFrame(700,1200,'openai-edit')).toMatchObject({width:1024,height:1536,ratio:'2:3'})
    expect(atlasPaintFrame(1000,1000,'openai-edit')).toMatchObject({width:1024,height:1024})
  })
  it('无法满足图片尺寸的极端纵横比在任何模型请求前拒绝，程序地图不受此限制', async () => {
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
    const narrow=parseAtlasReference({version:1,width:100,height:4096,features:[{kind:'land',name:'',rank:0,points:[[0,0],[100,0],[100,4096],[0,4096]]}]})
    await expect(generateAtlasPaintPreview({geometry:narrow,seed:'s',reference:new Blob(['x'],{type:'image/png'}),aiConfig:config,imageModel:'agnes-image-2.1-flash',width:100,height:4096})).rejects.toThrow(/狭长/)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('Gemini 原生参考图边界', () => {
  const input = { binding:{baseUrl:'https://fixture.invalid/v1beta',apiKey:'synthetic-secret',model:'image-model'},
    reference:new Blob(['reference'],{type:'image/png'}),prompt:'map',ratio:'16:9' }
  it('参考图进入原生 Interactions，忽略思考图片，只接收唯一正式图片', async () => {
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({steps:[{type:'thought',content:[{type:'image',data:btoa('thought')}]},
      {type:'model_output',content:[{type:'image',data:btoa('result')}]}]})))
    vi.stubGlobal('fetch',fetcher)
    expect(new TextDecoder().decode(await requestGeminiReferenceImageV1(input))).toBe('result')
    const [url,request]=fetcher.mock.calls[0] as unknown as [URL,RequestInit]
    expect(String(url)).toBe('https://fixture.invalid/v1beta/interactions')
    expect(JSON.parse(request.body as string)).toMatchObject({model:'image-model',input:[{type:'text',text:'map'},
      {type:'image',mime_type:'image/png',data:btoa('reference')}],response_format:{type:'image',aspect_ratio:'16:9',image_size:'2K'}})
  })
  it('失败不自动重发，不接受空图、多候选或无效连接', async () => {
    for(const status of [401,402,429,503]) {
      const f=vi.fn(async()=>new Response('',{status}));vi.stubGlobal('fetch',f)
      await expect(requestGeminiReferenceImageV1(input)).rejects.toThrow(String(status));expect(f).toHaveBeenCalledTimes(1)
    }
    const f=vi.fn(async()=>new Response('{}'));vi.stubGlobal('fetch',f)
    await expect(requestGeminiReferenceImageV1(input)).rejects.toThrow(/唯一/)
    await expect(requestGeminiReferenceImageV1({...input,binding:{...input.binding,baseUrl:'https://user:password@fixture.invalid'}})).rejects.toThrow(/地址/)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

const art = (): AtlasPaintPackageV2 => ({kind:'storyforge.atlas-paint',version:2,geometryHash:'a'.repeat(64),style:'sketch',symbols:'watercolor',
  rendering:'masked-v2',image:'data:image/png;base64,eA==',source:{provider:'fixture',model:'image',createdAt:1,promptRevision:'v2'}})
async function fakeCache() {
  const {authorViewCache}=await import('../../src/lib/storage/author-view-cache')
  const put=authorViewCache.put.bind(authorViewCache);let fail=false
  vi.spyOn(authorViewCache,'put').mockImplementation(async(key,value)=>{if(fail)throw Error('quota');await put(key,value)})
  return {setFail:(v:boolean)=>{fail=v}}
}
describe('浏览器视图缓存不进入世界语义',()=>{
  it('可跨页面恢复，按工作区/地图/画风隔离；删除工作区仅清理自己的缓存',async()=>{
    vi.resetModules();let store=await import('../../src/lib/authoring/atlas-view-cache')
    await store.saveAtlasView('workspace-a:map:1',art());await store.saveAtlasView('workspace-b:map:1',art())
    vi.resetModules();store=await import('../../src/lib/authoring/atlas-view-cache')
    expect((await store.readAtlasView('workspace-a:map:1','sketch','watercolor'))?.art).toEqual(art())
    expect(await store.readAtlasView('workspace-a:map:1','painted','watercolor')).toBeUndefined()
    await store.clearAtlasWorkspaceViews('workspace-a')
    expect(await store.readAtlasView('workspace-a:map:1','sketch','watercolor')).toBeUndefined()
    expect((await store.readAtlasView('workspace-b:map:1','sketch','watercolor'))?.art).toEqual(art())
  })
  it('保存失败保留内存原稿，其他地图成功不能清除该错误；拒绝伪造包',async()=>{
    vi.resetModules();const fake=await fakeCache(),store=await import('../../src/lib/authoring/atlas-view-cache')
    fake.setFail(true);await expect(store.saveAtlasView('workspace-a:map:1',art())).rejects.toThrow(/保存失败/)
    fake.setFail(false);await store.saveAtlasView('workspace-b:map:2',art())
    expect((await store.readAtlasView('workspace-a:map:1','sketch','watercolor'))?.error).toMatch(/保存失败/)
    expect((await store.readAtlasView('workspace-a:map:1','sketch','watercolor'))?.art).toEqual(art())
    expect(()=>assertAtlasPaintPackageV2({...art(),image:'data:image/svg+xml;base64,eA=='})).toThrow()
    expect(()=>assertAtlasPaintPackageV2({...art(),geometryHash:'wrong'})).toThrow()
    await store.removeAtlasView('workspace-a:map:1','sketch','watercolor')
    expect(await store.readAtlasView('workspace-a:map:1','sketch','watercolor')).toBeUndefined()
  })
  it('保存捕获调用时的包，调用方后改对象或读取结果不能改变缓存归属与原图',async()=>{
    vi.resetModules();await fakeCache();const store=await import('../../src/lib/authoring/atlas-view-cache')
    const input=art(),pending=store.saveAtlasView('workspace-a:map:1',input)
    input.style='painted';input.image='data:image/png;base64,eQ=='
    await pending
    const first=await store.readAtlasView('workspace-a:map:1','sketch','watercolor')
    expect(first?.art).toEqual(art());first!.art.source.model='changed'
    expect((await store.readAtlasView('workspace-a:map:1','sketch','watercolor'))?.art.source.model).toBe('image')
    expect(await store.readAtlasView('workspace-a:map:1','painted','watercolor')).toBeUndefined()
  })
  it('清理失败保留原缓存，不影响另一工作区；清理成功后才移除内存图',async()=>{
    vi.resetModules();const store=await import('../../src/lib/authoring/atlas-view-cache')
    const {authorViewCache}=await import('../../src/lib/storage/author-view-cache')
    await store.saveAtlasView('workspace-a:map:1',art());await store.saveAtlasView('workspace-b:map:1',art())
    const remove=vi.spyOn(authorViewCache,'removePrefix').mockRejectedValueOnce(Error('blocked'))
    await expect(store.clearAtlasWorkspaceViews('workspace-a')).rejects.toThrow('blocked')
    expect((await store.readAtlasView('workspace-a:map:1','sketch','watercolor'))?.art).toEqual(art())
    remove.mockRestore();await store.clearAtlasWorkspaceViews('workspace-a')
    expect(await store.readAtlasView('workspace-a:map:1','sketch','watercolor')).toBeUndefined()
    expect((await store.readAtlasView('workspace-b:map:1','sketch','watercolor'))?.art).toEqual(art())
  })
})
