import catalogue from '../../../scripts/avg-local-music/publisher-library-source.json'
import type { AvgSoundLibrarySourceV1 } from './sound-scope-contract'
import { avgEnum, avgHash, avgKey, avgRecord, avgText } from './protocol-validation'

/** Explicit new source variant. It does not relabel the original Kenney
 * declarations or invent a licence member inside a publisher's archive. */
export interface AvgSoundPublisherLibrarySourceV2 extends AvgSoundLibrarySourceV1 {
  version: 2
  publisherPageHash: string
}

export function isAvgSoundPublisherLibrarySourceV2(source: AvgSoundLibrarySourceV1): source is AvgSoundPublisherLibrarySourceV2 {
  return (source as { version?: unknown }).version === 2
}

export function listAvgSoundPublisherLibraryMetadataV2(): AvgSoundPublisherLibrarySourceV2[] {
  return catalogue.archives.flatMap(archive => archive.members.map(member => ({
    version: 2 as const, sourceKey: member.sourceKey, publisherPage: archive.publisherPage,
    license: 'CC0-1.0' as const, publisherPageHash: archive.licenseEvidence.publisherPageHash,
    archiveHash: archive.archiveHash, memberPath: member.memberPath, memberHash: member.memberHash,
  })))
}

export function assertAvgSoundPublisherLibraryMetadataV2(source: AvgSoundPublisherLibrarySourceV2) {
  const archive = catalogue.archives.find(a => a.archiveHash === source.archiveHash)
  const member = archive?.members.find(m => m.sourceKey === source.sourceKey && m.memberPath === source.memberPath && m.memberHash === source.memberHash)
  if (source.version !== 2 || !archive || !member || source.license !== catalogue.license
    || source.publisherPage !== archive.publisherPage || source.publisherPageHash !== archive.licenseEvidence.publisherPageHash) {
    throw new Error('[avg-sound] 网页许可来源、发布者、原包或成员不在准确已核验目录中')
  }
  return { version: 2 as const, archive, member }
}

export function parseAvgSoundPublisherLibrarySourceV2(value: unknown): AvgSoundPublisherLibrarySourceV2 {
  const r = avgRecord(value, ['version', 'sourceKey', 'publisherPage', 'license', 'publisherPageHash', 'archiveHash', 'memberPath', 'memberHash'], 'publisher licensed audio source')
  if (r.version !== 2) throw new Error('[avg-sound] 网页许可音频来源版本无效')
  const source = { version: 2 as const, sourceKey: avgKey(r.sourceKey, 'publisher audio source key'),
    publisherPage: avgText(r.publisherPage, 'original publisher page', 1000),
    license: avgEnum(r.license, ['CC0-1.0'] as const, 'publisher audio licence'),
    publisherPageHash: avgHash(r.publisherPageHash, 'original publisher page hash'),
    archiveHash: avgHash(r.archiveHash, 'original audio archive hash'),
    memberPath: avgText(r.memberPath, 'original audio member path', 512), memberHash: avgHash(r.memberHash, 'original audio member hash') }
  assertAvgSoundPublisherLibraryMetadataV2(source)
  return source
}

/** Exact expected original response, not a grant of hearing/current-use or
 * adoption authority. The local library verifies these external files before
 * serving the pinned, unconverted original OGG member. */
export function avgSoundPublisherLibraryResultV2(source: AvgSoundPublisherLibrarySourceV2) {
  const { archive, member } = assertAvgSoundPublisherLibraryMetadataV2(source)
  return { schema: 'storyforge.avg.licensed-audio-result', version: 2,
    publisher: archive.publisher, publisherPage: archive.publisherPage, license: catalogue.license,
    archiveHash: archive.archiveHash, archiveBytes: archive.archiveBytes, licenseEvidence: archive.licenseEvidence,
    ...member, inferenceCalls: 0, supplierCostUsd: 0, originalBytes: true, transcoded: false,
    hearing: 'unobserved', authorAdopted: false }
}
