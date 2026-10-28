import type { WorkspaceScope } from '../types'

export function sameAvgPlayerScopeV1(a:WorkspaceScope|null,b:WorkspaceScope|null):boolean {
  return !!a&&!!b&&a.projectId===b.projectId&&a.worldId===b.worldId&&a.workId===b.workId
}

/** Only an already resolved source can acknowledge an address-bar update.
 * Pending selection/library reads must never count as the requested source. */
export function avgPlayerSourceMatchesV1(expected:{scope:WorkspaceScope;worldGroupId:number|null;sessionId:number},actual:{
  scope:WorkspaceScope|null;worldGroupId:number|null;selectedSessionId:number|null;selectedSourceSessionId:number|null;loading:boolean
}):boolean {
  return !actual.loading&&sameAvgPlayerScopeV1(expected.scope,actual.scope)&&expected.worldGroupId===actual.worldGroupId
    &&actual.selectedSessionId===expected.sessionId&&actual.selectedSourceSessionId===expected.sessionId
}
