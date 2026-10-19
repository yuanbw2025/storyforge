/** AVG-04B headless preparation API. These pure functions do not dispatch a
 * provider, access Work storage, accept a candidate or grant playback rights.
 * Formal production must attach its real Brief/Plan/Harness and author proofs
 * before activating the default-hidden workbench path. */
export { parseAvgSoundPlanV1, type AvgSoundPlanV1 } from './sound-plan-contract'
export { parseAvgSoundPlanningScopeV1, type AvgSoundPlanningScopeV1, type AvgSoundTemplateV1 } from './sound-scope-contract'
export { freezeAvgSoundPlanningScopeV1, validateAvgSoundPlanningSourcesV1 } from './sound-source'
export { compileAvgSoundRequirementsV1 } from './sound-requirements'
export { parseAvgAuthorSoundChoiceV1, type AvgAuthorSoundChoiceV1 } from './sound-choice-contract'
export { applyAvgSoundChoicesToDraftV1 } from './sound-configuration'
