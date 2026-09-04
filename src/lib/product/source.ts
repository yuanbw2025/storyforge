/**
 * Public, headless boundary for upper products that consume immutable world
 * resources. Product code depends on these logical contracts and requirement
 * adapters, never on the physical WorldRelease manifest.
 */
export * from './source-contracts'
export * from './world-requirement-adapters'
export {
  createWorldReferenceV1,
  listWorldReferenceCatalogV1,
  validateWorldReferenceV1,
} from '../world-engine/world-reference'
