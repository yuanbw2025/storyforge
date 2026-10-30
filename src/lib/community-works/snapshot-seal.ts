import type { CommunityPublicSnapshotV1 } from './public-snapshot'

/** Preview seal only. The server must independently validate and hash the received bytes. */
export interface SealedPublicSnapshotV1 {
  envelopeVersion: 1
  contentType: 'application/vnd.storyforge.community-snapshot+json;version=1'
  byteLength: number
  sha256: string
  snapshot: CommunityPublicSnapshotV1
}

function encodeSnapshot(snapshot: CommunityPublicSnapshotV1): Uint8Array {
  const serialized = JSON.stringify(snapshot)
  if (!serialized) throw new Error('公开快照无法序列化')
  return new TextEncoder().encode(serialized)
}

async function digest(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持安全摘要，投稿已停止')
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(hash), part => part.toString(16).padStart(2, '0')).join('')
}

export async function sealPublicSnapshotV1(snapshot: CommunityPublicSnapshotV1): Promise<SealedPublicSnapshotV1> {
  // Keep the preview independent of later edits to the local object graph.
  const frozenCopy = structuredClone(snapshot)
  const bytes = encodeSnapshot(frozenCopy)
  return {
    envelopeVersion: 1,
    contentType: 'application/vnd.storyforge.community-snapshot+json;version=1',
    byteLength: bytes.byteLength,
    sha256: await digest(bytes),
    snapshot: frozenCopy,
  }
}

/** Re-read the local source and compare this seal immediately before starting upload. */
export async function assertUnchangedPublicSnapshotV1(
  seal: SealedPublicSnapshotV1,
  current: CommunityPublicSnapshotV1,
): Promise<void> {
  const bytes = encodeSnapshot(current)
  if (bytes.byteLength !== seal.byteLength || await digest(bytes) !== seal.sha256) {
    throw new Error('本地作品在预览后发生变化，请重新预览并确认投稿内容')
  }
}
