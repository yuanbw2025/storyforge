/** Authored JSON fixture only; no claim of live context injection or model acceptance. */
import type { TtrpgOpenContextPolicyV1 } from '../../src/lib/ttrpg/open-context-policy'
export function openContextPolicyFixtureV1(): TtrpgOpenContextPolicyV1 {
  return { schema: 'storyforge.ttrpg-open-context-policy', version: 1,
    normalization: 'nfkc-unicode-lowercase-whitespace-v1', maximumContextTokens: 8000, cjkTextMatching: 'disabled',
    triggers: [{ consumers: ['actor'], trigger: { triggerKey: 'harbor.storm', logic: 'both', textPatterns: ['storm'],
      predicate: { op: 'world-turn-at-least', value: 2 }, audience: 'party', knownByActorKeys: [], injectText: 'The wind is rising.',
      group: 'weather', priority: 20, timing: { stickyWorldTurns: 2, cooldownWorldTurns: 3, delayWorldTurns: 0 }, sourceRefs: ['ttrpgOpenAuthority'] } }] }
}
