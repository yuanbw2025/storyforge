import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { createWorldPackage, inspectWorldPackage } from '../../src/lib/world-engine/world-package'
import { encodeWorldSourceDeclarationV1 } from '../../src/lib/world-engine/source-declaration'
import type { CommunityWorldOrigin } from '../../src/lib/types/world-sharing'
import { seedCurrentWorkspace } from './current-workspace'

export async function createSfqa021WorldSharingCarrierV1(packageVersion: 3 | 4 | 5) {
  const source = await seedCurrentWorkspace('021原包来源', { purpose: 'world-engine' })
  const revision = await createWorldRevision({ scope: source.scope, label: '原始封存', formatVersion: packageVersion === 3 ? 3 : 4 })
  const release = await publishWorldRevision(revision.id!)
  const pkg = await createWorldPackage(release.id!, { authorName: '原作者', attribution: '  精确署名\n保留换行  ',
    license: 'CC-BY-4.0', allowedUses: { 'world-remix': false, ttrpg: true, 'character-interaction': false,
      'ai-town': false, 'text-adventure': false, avg: false, 'text-open-world': false },
    contentWarnings: [' 战争 ', '雪\n暴风', ' 战争 '], ...(packageVersion === 5 ? { transport: 'dictionary-v1' as const } : {}) })
  if (!(await inspectWorldPackage(pkg)).valid) throw new Error('Expected a real self-valid world package fixture')
  const origin: CommunityWorldOrigin = { ...encodeWorldSourceDeclarationV1({ manifest: pkg.manifest,
    packageVersion: pkg.packageVersion, packageDigest: pkg.integrity.digest }), importedAt: Date.now() }
  // F1 exercises the existing World carrier, not a new world-package importer
  // or an editing/installation permission that later phases still must define.
  const target = await createWorkspace({ name: '021声明载体', description: '', genres: ['other'], status: 'drafting', targetWordCount: 100_000 },
    { purpose: 'world-engine', kind: 'novel', novelProfile: 'long', world: { communityOrigin: origin } })
  return { source, target, pkg, origin, release }
}
