import type { BackupReferenceIssue } from '../export/backup-trust'

/** Historical audit values, never native IDs to remap or execution authority. */
export type WorkspaceImportReviewJsonV1 =
  | null | boolean | number | string
  | readonly WorkspaceImportReviewJsonV1[]
  | { readonly [key: string]: WorkspaceImportReviewJsonV1 }

export type WorkspaceImportReviewIssueV1 = Readonly<Omit<BackupReferenceIssue, 'value' | 'sampleId'>> & {
  readonly value: WorkspaceImportReviewJsonV1
  readonly sampleId?: WorkspaceImportReviewJsonV1
}

export interface WorkspaceImportReviewReportV1 {
  readonly version: 1
  readonly issues: readonly WorkspaceImportReviewIssueV1[]
}

/** Exact receipt hash preimage; local coordinates and reportJson are excluded. */
export interface WorkspaceImportReviewReceiptBodyV1 {
  readonly version: 1
  readonly kind: 'backup-import-reference-review'
  readonly sourceBackupVersion: number
  readonly sourceRootContractVersion: 2
  readonly sourceParsedJsonSha256: string
  readonly reportHash: string
  readonly priorReceiptHashes: readonly string[]
  readonly recordedAt: number
}

export interface PortableWorkspaceImportReviewReceiptV1 extends WorkspaceImportReviewReceiptBodyV1 {
  readonly reportJson: string
  readonly receiptHash: string
}

/** Future registered workspace-owned row. This type does not activate a table. */
export interface WorkspaceImportReviewReceiptV1 extends PortableWorkspaceImportReviewReceiptV1 {
  readonly id?: number
  readonly projectId: number
}
