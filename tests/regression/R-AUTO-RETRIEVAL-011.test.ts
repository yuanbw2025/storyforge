import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'
import { retrieveChunks, readNarrativeSummaryContext, ensureChunkEmbeddings } from '../../src/lib/retrieval/retrieval'
import { embeddingModelTag } from '../../src/lib/ai/adapters/embedding-adapter'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { EmbeddingConfig } from '../../src/lib/types'

const vector:EmbeddingConfig={enabled:true,provider:'ollama',baseUrl:'http://localhost:11434/v1',model:'synthetic-embedding',apiKey:''}
async function fixture(name='自动检索隔离作品') {
  const {scope}=await seedCurrentWorkspace(name)
  const chapters:number[]=[],outlines:number[]=[]
  const texts=['林岚把青铜铃藏在旧车站。','与本次任务无关的过去章节。','当前章节不可上传。','未来真正秘密不可上传。']
  for(let order=0;order<texts.length;order++) {
    const outline=await db.outlineNodes.add({projectId:scope.projectId,workId:scope.workId,parentId:null,type:'chapter',title:`章节${order}`,summary:order===2?'林岚寻找青铜铃':'',order,createdAt:1,updatedAt:1} as never) as number
    outlines.push(outline)
    chapters.push(await db.chapters.add({projectId:scope.projectId,workId:scope.workId,outlineNodeId:outline,title:`章节${order}`,content:texts[order],summary:'',status:'draft',order,wordCount:20,notes:'',createdAt:1,updatedAt:1} as never) as number)
  }
  await db.characters.add({projectId:scope.projectId,worldId:scope.worldId,name:'林岚',worldGroupId:null,createdAt:1,updatedAt:1} as never)
  await finalizeCurrentFixtureV1(scope.projectId)
  return {scope,chapters,outlines}
}
beforeEach(async()=>{await db.delete();await db.open();useAIConfigStore.setState({embedding:{...vector,enabled:false}})})
afterEach(async()=>{vi.unstubAllGlobals();vi.restoreAllMocks();await db.transaction('r',db.tables,()=>Promise.all(db.tables.map(table=>table.count())));db.close()})
describe('011 automatic scoped retrieval',()=>{
  it('unindexed old chapters and summaries become available without a service or manual maintenance',async()=>{
    const f=await fixture(),network=vi.fn();vi.stubGlobal('fetch',network)
    const result=await retrieveChunks({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2],queryTerms:['青铜铃']})
    expect(result.map(row=>row.chunk.sourceChapterId)).toEqual([f.chapters[0]])
    const summary=await readNarrativeSummaryContext({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2]})
    expect(summary).toContain('青铜铃');expect(summary).not.toContain('当前章节不可上传');expect(summary).not.toContain('未来真正秘密')
    expect(network).not.toHaveBeenCalled()
    const ids=(await db.retrievalChunks.toArray()).map(row=>row.id)
    await retrieveChunks({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2],queryTerms:['青铜铃']})
    expect((await db.retrievalChunks.toArray()).map(row=>row.id)).toEqual(ids)
  })
  it('on-demand repair preserves an existing verified summary when its exact source is still current',async()=>{
    const f=await fixture(),chapter=(await db.chapters.get(f.chapters[0]))!
    await db.narrativeSummaryNodes.add({projectId:f.scope.projectId,workId:f.scope.workId,worldGroupId:null,level:'chapter',sourceChapterId:chapter.id,sourceOutlineNodeId:chapter.outlineNodeId,title:chapter.title,summary:'已确认的回声伏笔',keywords:['回声'],sourceHash:await hashChapterText(chapter.content),status:'verified',generatedBy:'system-rollup',createdAt:1,updatedAt:1})
    const result=await readNarrativeSummaryContext({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2]})
    expect(result).toContain('已确认的回声伏笔')
  })
  it('body changes with unchanged timestamps invalidate old excerpts automatically',async()=>{
    const f=await fixture()
    await retrieveChunks({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2],queryTerms:['青铜铃']})
    await db.chapters.update(f.chapters[0],{content:'林岚丢弃旧物，带走银色车票。'})
    expect(await retrieveChunks({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2],queryTerms:['青铜铃']})).toHaveLength(0)
    expect((await retrieveChunks({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2],queryTerms:['银色车票']}))[0].chunk.sourceChapterId).toBe(f.chapters[0])
  })
  it('configured vectors only receive the query and selected past chunks from the current Work',async()=>{
    const a=await fixture('A'),b=await fixture('B')
    await db.chapters.update(b.chapters[0],{content:'另一本书的保密正文，青铜铃。'})
    const inputs:string[]=[]
    vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init?:RequestInit)=>{const body=JSON.parse(String(init?.body));inputs.push(...body.input);return Response.json({data:body.input.map((_:string,index:number)=>({index,embedding:[1,0,0]}))})}))
    useAIConfigStore.setState({embedding:vector})
    const result=await assembleContext({projectId:a.scope.projectId,scope:a.scope,chapterId:a.chapters[2],outlineNodeId:a.outlines[2],sourceKeys:['retrievedPassages']})
    expect(result.text).toContain('青铜铃');expect(inputs.join('\n')).toContain('旧车站')
    expect(inputs.join('\n')).not.toMatch(/当前章节不可上传|未来真正秘密|另一本书|与本次任务无关/)
  })
  it('embedding failure leaves verified local retrieval available',async()=>{
    const f=await fixture();useAIConfigStore.setState({embedding:vector})
    vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('synthetic offline')}))
    const result=await assembleContext({projectId:f.scope.projectId,scope:f.scope,chapterId:f.chapters[2],outlineNodeId:f.outlines[2],sourceKeys:['retrievedPassages']})
    expect(result.text).toContain('青铜铃')
  })
  it('same model names on different connections or credential scopes never share vector identity',()=>{
    const original=embeddingModelTag({...vector,apiKey:'SYNTHETIC_PRIVATE'})
    expect(embeddingModelTag({...vector,apiKey:'SYNTHETIC_OTHER'})).not.toBe(original)
    expect(embeddingModelTag({...vector,baseUrl:'https://other.invalid/v1',apiKey:'SYNTHETIC_PRIVATE'})).not.toBe(original)
    expect(original).not.toContain('SYNTHETIC_PRIVATE');expect(original).not.toContain('localhost')
  })
  it('late vectors cannot overwrite cache rows whose source changed in flight',async()=>{
    const f=await fixture()
    const rows=await retrieveChunks({projectId:f.scope.projectId,scope:f.scope,currentChapterId:f.chapters[2],queryTerms:['青铜铃']})
    let release!:(response:Response)=>void
    vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{release=resolve})))
    const task=ensureChunkEmbeddings({projectId:f.scope.projectId,scope:f.scope,cfg:vector,chunkIds:[rows[0].chunk.id!]})
    await vi.waitFor(()=>expect(release).toBeTypeOf('function'))
    await db.retrievalChunks.update(rows[0].chunk.id!,{text:'已变化的正文片段',sourceTextHash:'changed'})
    release(Response.json({data:[{index:0,embedding:[1,0,0]}]}))
    expect((await task).embedded).toBe(0)
    expect((await db.retrievalChunks.get(rows[0].chunk.id!))!.embedding).toBeNull()
  })
})
