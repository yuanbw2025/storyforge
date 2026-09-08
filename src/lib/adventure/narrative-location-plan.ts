export interface TextAdventureNarrativeLocationPlanEntryV1 {
  sceneIndex: number
  locationIndex: number
  locationOrdinal: number
}

/**
 * Spread the ordered mainline scene spine monotonically across the ordered
 * authored locations. A location may own several fine-grained scenes, but a
 * late scene can never wrap back into an earlier location.
 */
export function planTextAdventureNarrativeLocationsV1(
  sceneCount: number,
  locationCount: number,
): TextAdventureNarrativeLocationPlanEntryV1[] {
  if (!Number.isInteger(sceneCount) || sceneCount < 1) {
    throw new Error('[text-adventure-location-plan] sceneCount 必须是正整数')
  }
  if (!Number.isInteger(locationCount) || locationCount < 1) {
    throw new Error('[text-adventure-location-plan] locationCount 必须是正整数')
  }
  return Array.from({ length: sceneCount }, (_, sceneIndex) => {
    const locationIndex = Math.min(
      locationCount - 1,
      Math.floor(sceneIndex * locationCount / sceneCount),
    )
    return { sceneIndex, locationIndex, locationOrdinal: locationIndex + 1 }
  })
}

function assignedLocationTitleByNodeV1(
  nodes: readonly FrozenProductNarrativeNode[],
  locationTitles: readonly string[],
): Map<string, string> {
  const sceneNodes = nodes.filter(node => node.kind !== 'ending')
  if (!sceneNodes.length || !locationTitles.length) return new Map()
  const plan = planTextAdventureNarrativeLocationsV1(sceneNodes.length, locationTitles.length)
  return new Map(sceneNodes.map((node, index) => [
    node.key, locationTitles[plan[index].locationIndex],
  ]))
}

/**
 * A Choice's frozen target node is authoritative. If generated copy names a
 * different registered location and omits the actual target, replace only
 * those location titles. The graph, action identity and effects never change.
 */
export function canonicalizeTextAdventureChoiceLocationsV1(input: {
  nodes: readonly FrozenProductNarrativeNode[]
  choices: readonly FrozenNarrativeChoice[]
  locationTitles: readonly string[]
}): FrozenNarrativeChoice[] {
  const assignedTitleByNode = assignedLocationTitleByNodeV1(input.nodes, input.locationTitles)
  return input.choices.map(choice => {
    const expectedTitle = assignedTitleByNode.get(choice.targetNodeKey)
    if (!expectedTitle) return { ...choice }
    const copy = `${choice.text}\n${choice.description}`
    if (copy.includes(expectedTitle)) return { ...choice }
    const conflictingTitles = [...input.locationTitles]
      .filter(title => title !== expectedTitle && copy.includes(title))
      .sort((left, right) => right.length - left.length)
    if (!conflictingTitles.length) return { ...choice }
    const replace = (value: string) => conflictingTitles.reduce(
      (current, title) => current.split(title).join(expectedTitle), value,
    )
    return { ...choice, text: replace(choice.text), description: replace(choice.description) }
  })
}

export function validateTextAdventureNarrativeLocationPlanV1(input: {
  nodes: FrozenProductNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
  locationTitles: string[]
}): string[] {
  const sceneNodes = input.nodes.filter(node => node.kind !== 'ending')
  if (!sceneNodes.length || !input.locationTitles.length) return []
  const beatsByNode = new Map<string, string[]>()
  for (const beat of input.beats) {
    beatsByNode.set(beat.nodeKey, [...(beatsByNode.get(beat.nodeKey) ?? []), beat.text])
  }
  const errors: string[] = []
  const assignedTitleByNode = assignedLocationTitleByNodeV1(input.nodes, input.locationTitles)
  sceneNodes.forEach(node => {
    const expectedTitle = assignedTitleByNode.get(node.key)!
    const authoredText = [node.title, node.summary, ...(beatsByNode.get(node.key) ?? [])].join('\n')
    if (!authoredText.includes(expectedTitle)) {
      errors.push(`${node.key} 必须明确出现地点锚点「${expectedTitle}」`)
    }
  })
  for (const choice of input.choices) {
    if (!assignedTitleByNode.has(choice.targetNodeKey)) continue
    const mentionedLocations = input.locationTitles.filter(title => (
      choice.text.includes(title) || choice.description.includes(title)
    ))
    const expectedTitle = assignedTitleByNode.get(choice.targetNodeKey)!
    if (mentionedLocations.length > 0 && !mentionedLocations.includes(expectedTitle)) {
      errors.push(`${choice.choiceKey} 提到「${mentionedLocations.join('、')}」但目标节点位于「${expectedTitle}」`)
    }
  }
  return errors
}
import type { FrozenNarrativeBeat, FrozenNarrativeChoice, FrozenProductNarrativeNode } from '../types'
