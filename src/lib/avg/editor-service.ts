import { db } from "../db/schema";
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
  stampNewRecord,
} from "../workspace/scope";
import type {
  WorkspaceScope,
  ProductRuntimePackageV1,
  FrozenRuntimeMediaAssetV2,
  ProductMediaKind,
} from "../types";
import { parseProductRuntimePackageV1 } from "../product-production/runtime-package";
import { putMediaBlobObject, sha256MediaData } from "../product-production/media-blob-store";
import { PRODUCT_MEDIA_KINDS } from '../types';
import { assertAvgMediaBytesV1 } from './media-import-contract';
import { readAvgDraftV1 } from "./draft-service";
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract';
import { canonicalProductProductionJsonV2 } from '../product-production/hash';
import { parseAvgExecutableStageV1 } from './stage-contract';

/** Authors may retain unfinished graph edits; full package validation gates production. */
export async function saveAvgEditorV1(
  scope: WorkspaceScope,
  revision: number,
  previewHash: string,
  pkg: ProductRuntimePackageV1,
) {
  if (pkg.productType !== "avg" || !/^[a-f0-9]{64}$/.test(previewHash))
    throw new Error("AVG 编辑来源无效");
  const editorJson = JSON.stringify(pkg);
  if (editorJson.length > 2_000_000)
    throw new Error("编辑草稿过大，请拆分制作规模");
  return db.transaction(
    "rw",
    scopeTransactionTables(db.avgAuthoringDrafts),
    async () => {
      const row = await readAvgDraftV1(scope);
      if (row.editorJson && JSON.parse(row.editorJson).schema === 'storyforge.avg.author-workspace')
        throw new Error('请使用原生系统与效果工作区编辑，避免覆盖作者草稿');
      if (row.revision !== revision)
        throw new Error("编辑草稿已在其他页面修改，请刷新后继续");
      const next = {
        ...row,
        editorJson,
        editorPreviewHash: previewHash,
        revision: revision + 1,
        updatedAt: Date.now(),
      };
      await db.avgAuthoringDrafts.put(next);
      return next;
    },
  );
}

/** Uses the existing draft/CAS/lifecycle; no canonical rules or Build is changed. */
export async function saveAvgAuthorWorkspaceV1(scope: WorkspaceScope, revision: number, value: unknown) {
  const draft = parseAvgAuthorWorkspaceV1(value);
  const editorJson = canonicalProductProductionJsonV2(draft);
  return db.transaction('rw', scopeTransactionTables(db.avgAuthoringDrafts), async () => {
    const row = await readAvgDraftV1(scope);
    if (row.revision !== revision) throw new Error('编辑草稿已在其他页面修改，请刷新后继续');
    if (row.editorJson && JSON.parse(row.editorJson).schema !== 'storyforge.avg.author-workspace') throw new Error('已有旧版编辑草稿，请先导出保留后再显式转换');
    const next = { ...row, editorJson, editorPreviewHash: draft.basePreviewHash ?? '', revision: revision + 1, updatedAt: Date.now() };
    await db.avgAuthoringDrafts.put(next);
    return next;
  });
}
type AvgMediaImportInputV1 = {
  scope: WorkspaceScope;
  data: ArrayBuffer;
  mimeType: string;
  name: string;
  kind: ProductMediaKind;
  license: string;
  altText: string;
  characterTag: string;
};
export function importAvgMediaV1(input: AvgMediaImportInputV1) { return importAvgMedia(input, false); }
export function importAvgMediaForAssemblyV1(input: AvgMediaImportInputV1) { return importAvgMedia(input, true); }
async function importAvgMedia(input: AvgMediaImportInputV1, decode: boolean) {
  if (!input.data.byteLength || input.data.byteLength > 32*1024*1024) throw new Error("单个素材需为 1 字节～32 MB");
  input = { ...input, scope: { ...input.scope }, data: input.data.slice(0) };
  const scope = await resolveScope({ scope: input.scope });
  const work = await db.works.get(scope.workId);
  if (
    !work ||
    !(await assertRecordInScope(scope, "works", work, { owner: "work" }))
  )
    throw new Error("作品不存在");
  if (!input.license.trim() || !input.name.trim())
    throw new Error("请填写素材名称与授权说明");
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/mp4",
    ].includes(input.mimeType)
  )
    throw new Error("请上传 PNG/JPEG/WebP 或 MP3/WAV/OGG/M4A");
  if (!input.data.byteLength || input.data.byteLength > 32 * 1024 * 1024)
    throw new Error("单个素材需为 1 字节～32 MB");
  if (!PRODUCT_MEDIA_KINDS.includes(input.kind)) throw new Error('素材类型无效');
  if (decode) assertAvgMediaBytesV1(input.data, input.mimeType);
  const isAudio = ["bgm", "ambience", "sfx", "voice"].includes(input.kind);
  if (isAudio !== input.mimeType.startsWith("audio/"))
    throw new Error("素材类型与文件不符");
  if (input.kind.startsWith("character-") && !input.characterTag.trim())
    throw new Error("角色素材必须绑定角色标识");
  const contentHash = await sha256MediaData(input.data);
  const asset: FrozenRuntimeMediaAssetV2 = {
    assetKey: `avg.asset.${crypto.randomUUID()}`,
    version: 1,
    kind: input.kind,
    name: input.name.trim(),
    mimeType: input.mimeType,
    byteSize: input.data.byteLength,
    width: null,
    height: null,
    durationMs: null,
    contentHash,
    blobContentHash: contentHash,
    source: "author-upload",
    license: input.license.trim(),
    altText: input.altText.trim() || input.name.trim(),
    characterTag: input.characterTag.trim(),
    sceneTag: "",
  };
  if (decode) {
    const { verifyProductMediaRuntimeUrlsV1 } = await import('../product-production/media-runtime-verifier');
    const url = URL.createObjectURL(new Blob([input.data], { type: input.mimeType }));
    try {
      const result = await verifyProductMediaRuntimeUrlsV1({ assets: [asset], urls: { [asset.assetKey]: url }, timeoutMs: 15_000,
        environment: { browserName: 'browser', browserVersion: navigator.userAgent, platform: navigator.platform,
          viewport: { width: window.innerWidth, height: window.innerHeight } } });
      const probe = result.assets[0];
      if (!probe || probe.status !== 'decoded') throw new Error('素材实际解码失败：' + (probe?.failureCode ?? 'unknown'));
      asset.width = probe.decodedWidth; asset.height = probe.decodedHeight; asset.durationMs = probe.decodedDurationMs;
      if (isAudio && (!Number.isFinite(asset.durationMs) || asset.durationMs! <= 0 || asset.durationMs! > 600_000)) throw new Error('音频时长需为 0～600 秒');
      if (!isAudio && (!Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width! < 1 || asset.height! < 1)) throw new Error('图片实际尺寸无效');
    } finally { URL.revokeObjectURL(url); }
  }
  // Decode before storage; an invalid file never creates an unreferenced blob.
  const blob = await putMediaBlobObject({scope,data:input.data,mimeType:input.mimeType,expectedContentHash:contentHash});
  await db.transaction('rw',scopeTransactionTables(db.mediaBlobObjects,db.avgDraftMedia),async()=>{
    await resolveScope({scope});
    const current = await db.mediaBlobObjects.get(blob.id!);
    if(!current || current.storageState!=='ready' || !await assertRecordInScope(scope,'mediaBlobObjects',current,{owner:'work'})
      ||current.contentHash!==contentHash||current.byteSize!==asset.byteSize||current.mimeType!==asset.mimeType) throw new Error('素材存储在导入期间已变化，请重新导入');
    await db.avgDraftMedia.add(stampNewRecord(scope,'avgDraftMedia',{...scope,blobObjectId:blob.id!,assetJson:JSON.stringify(asset),createdAt:Date.now()},{owner:'work'}));
  });
  return asset;
}
export function validateAvgEditorV1(pkg: ProductRuntimePackageV1) {
  return parseProductRuntimePackageV1(pkg);
}

/** Only an AVG-owned upload reference can authorize previewing a draft-only blob. */
export async function readAvgDraftMediaV1(scope:WorkspaceScope,asset:FrozenRuntimeMediaAssetV2){
 const rows=await db.avgDraftMedia.where('workId').equals(scope.workId).toArray()
 const row=rows.find(row=>{const saved=JSON.parse(row.assetJson) as FrozenRuntimeMediaAssetV2;return saved.assetKey===asset.assetKey&&saved.blobContentHash===asset.blobContentHash})
 if(!row||!await assertRecordInScope(scope,'avgDraftMedia',row,{owner:'work'}))throw new Error('素材引用不属于当前 AVG')
 const {readMediaBlobObjectData}=await import('../product-production/media-blob-store')
 return readMediaBlobObjectData({scope,blobObjectId:row.blobObjectId,expected:{contentHash:asset.blobContentHash,byteSize:asset.byteSize,mimeType:asset.mimeType}})
}

/** Bounded, Work-owned import history; lets refresh recover unassembled uploads. */
export async function listAvgDraftMediaV1(scopeInput: WorkspaceScope, beforeId?: number) {
  const scope = await resolveScope({scope:scopeInput});
  if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId < 1)) throw new Error('素材分页位置无效');
  const rows = await db.avgDraftMedia.where('workId').equals(scope.workId).reverse()
    .filter(row => beforeId === undefined || row.id! < beforeId).limit(33).toArray();
  const page = rows.slice(0,32);
  for (const row of page) if (!await assertRecordInScope(scope,'avgDraftMedia',row,{owner:'work'})) throw new Error('素材历史跨作品');
  return { items:page.map(row=>({asset:parseAvgExecutableStageV1({version:1,cues:[],assets:[JSON.parse(row.assetJson)]}).assets[0]!,createdAt:row.createdAt})),
    nextCursor:rows.length > 32 ? page[page.length-1]!.id! : null };
}
