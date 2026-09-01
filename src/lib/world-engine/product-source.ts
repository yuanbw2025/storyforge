/**
 * Public, headless boundary for upper products that consume immutable world
 * resources. Product code depends on these logical contracts and requirement
 * adapters, never on the physical WorldRelease manifest.
 */
export * from './product-source-contracts'
export * from './product-requirement-adapters'
