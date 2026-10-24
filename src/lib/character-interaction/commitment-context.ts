import type {ChatActorGoalV1, ChatGoalCommitmentV1} from '../types/chat-narrative'

/** Required identities come from canonical goals; consumers must intersect
 * them with their authorized view. No private goal identity is disclosed. */
export function requiredChatCommitmentKeysV1(goals: ChatActorGoalV1[]): Set<string> {
  return new Set(goals.flatMap(goal => {
    const history = goal.commitments ?? []
    const latest = [...history].reverse().find(c => c.resolution !== null)
    return [...history.filter(c => c.resolution === null), ...(latest ? [latest] : [])].map(c => c.commitmentKey)
  }))
}

/** A context projection, never a storage mutation or a new truth source. */
export function projectChatGoalCommitmentsV1(goals: ChatActorGoalV1[], selected: ReadonlySet<string>): ChatActorGoalV1[] {
  return goals.map(goal => {
    if (!goal.commitments) return goal
    const {commitments, ...rest} = goal
    const retained = commitments.filter(c => selected.has(c.commitmentKey))
    return retained.length ? {...rest, commitments: retained} : rest
  })
}

export function chatCommitmentContextTextV1(item: ChatGoalCommitmentV1): string {
  return `${item.terms}\n${item.resolution?.excerpt ?? ''}`
}
