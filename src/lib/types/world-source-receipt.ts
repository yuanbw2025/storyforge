/** Immutable World-owned evidence. Only the original wire is authoritative;
 * P/R/D are checked indices. Local locators never enter those identities. */
export interface WorldSourceReceiptV1 {
  id?: number
  projectId: number
  worldId: number
  worldReleaseId: number | null
  receiptVersion: 1
  wireJson: string
  packageDigest: string
  declarationHash: string
  releaseUid: string
  importedAt: number
}

/** One explicit editing origin, held by WorldDerivation, not a permission
 * mirror on World/Project. Missing legacy bindings remain unknown. */
export interface WorldSourceReceiptBindingV1 {
  version: 1
  declarationHash: string
}
