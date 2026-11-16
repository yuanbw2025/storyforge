/** Canonical destinations declared by a semantic world package. */
export const WORLD_PACKAGE_USES = [
  'world-remix', 'ttrpg', 'character-interaction', 'ai-town',
  'text-adventure', 'avg', 'text-open-world',
] as const
export type WorldPackageUse = (typeof WORLD_PACKAGE_USES)[number]

export type CommunityWorldLicense =
  | 'CC-BY-4.0'
  | 'CC-BY-SA-4.0'
  | 'CC-BY-NC-4.0'
  | 'ALL-RIGHTS-RESERVED'

export interface WorldPackageManifest {
  packageId: string
  sourceWorldCode: string
  sourceWorldVersion: number
  name: string
  description: string
  authorName: string
  attribution: string
  license: CommunityWorldLicense
  allowedUses: Record<WorldPackageUse, boolean>
  contentWarnings: string[]
  publishedAt: number
  releaseHash: string
}

/** A portable declaration, not proof of package authenticity or permission.
 * packageDigest records the original wire identity; declarationHash checks
 * only this declaration's canonical bytes. Neither is an author signature. */
export interface WorldSourceDeclarationV1 extends WorldPackageManifest {
  schema: 'storyforge.world-source-declaration'
  version: 1
  packageVersion: 3 | 4 | 5
  packageDigest: string
  declarationHash: string
}

/** Legacy headers stay readable, without inventing missing declarations.
 * A new origin extends those same fields directly, avoiding a second copy
 * of the author, license, package or source identity. */
export type CommunityWorldOrigin = (
  | Pick<WorldPackageManifest, 'packageId' | 'sourceWorldCode' | 'sourceWorldVersion' | 'authorName' | 'license'>
  | WorldSourceDeclarationV1
) & { importedAt: number }
