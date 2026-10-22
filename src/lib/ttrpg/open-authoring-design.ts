/** S2 author design facade. The normal author page uses this original
 * source/Run/candidate/adoption chain; production start remains separate. */
export * from './open-authoring-design-contract'
export * from './open-authoring-design-source'
export * from './open-authoring-design-harness'
export { adoptTtrpgOpenAuthoringDesignV1, reconcileTtrpgOpenAuthoringDesignAdoptionV1,
  readTtrpgOpenAuthoringDesignAdoptionV1, dismissTtrpgOpenAuthoringDesignRequestV1 } from './open-authoring-design-adoption'
