/**
 * Product-neutral public runtime boundary.
 *
 * Product code must import its own domain runtime API. This module is reserved
 * for shared infrastructure that deals only with session/event/checkpoint
 * mechanics and never issues a product-specific command.
 */
export {
  advanceFrozenNarrativeChoice,
  applyProductRuntimeEvent,
  branchProductRuntimeSession,
  commitNarrativeChoice,
  commitNarrativeChoiceWithStateV1,
  createProductRuntimeCheckpoint,
  deleteProductRuntimeSession,
  enterFrozenNarrativeNode,
  hashProductRuntimeStateV1,
  parseProductRuntimeState,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  replayProductRuntimeEvents,
  verifyProductRuntimeCheckpoint,
  type NarrativeChoiceCommitResultV1,
} from './runtime-core'
