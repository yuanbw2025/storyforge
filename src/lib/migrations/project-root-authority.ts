/**
 * One-way cleanup for imported rows that predate World-owned public identity.
 * Kept in the migration namespace so current product code cannot observe or
 * recreate the superseded Project mirrors.
 */
export function obsoleteProjectIdentityFieldsV1(): Record<string, undefined> {
  return {
    worldCode: undefined,
    worldVersion: undefined,
    communityOrigin: undefined,
    workspacePurposeDecision: undefined,
  }
}
