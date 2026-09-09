/**
 * Normalizes a reviewer issue to the Artifact that actually owns the named
 * fields. Review models occasionally call the assembled quest design a
 * "quest script" even when the defect is in the upstream objective topology.
 */
export function textAdventureQualityIssueOwnerArtifactKeyV1(
  issue: Record<string, unknown>,
): string {
  const artifactKey = typeof issue.artifactKey === 'string' ? issue.artifactKey : ''
  if (artifactKey !== 'content.quest-script') return artifactKey
  const evidence = [
    typeof issue.detail === 'string' ? issue.detail : '',
    typeof issue.recommendation === 'string' ? issue.recommendation : '',
  ].join('\n')
  if (/locationOrdinal|(?:objective|alternative)\.[\w.-]+[^\n]*(?:description|标题|目标|地点)|quests?\[\d+\]\.(?:stages|objectives)/i.test(evidence)) {
    return 'content.main-quest-plan'
  }
  return artifactKey
}
