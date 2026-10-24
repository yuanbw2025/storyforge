export type ChatMemoryCheckV1 = 'source-fidelity' | 'player-visibility' | 'no-private-inference'
export interface ChatMemoryReviewV1 {
  version: 1
  bindingJson: string
  checks: Array<{check: ChatMemoryCheckV1; passed: boolean; reason: string}>
}
/** Portable evidence binding; reviewer reasons stay in the Harness candidate. */
export interface ChatMemoryReviewReceiptV1 {
  version: 1
  bindingJson: string
  reviewHash: string
  passedChecks: ChatMemoryCheckV1[]
}
