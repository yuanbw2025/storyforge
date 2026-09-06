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

export function validateTextAdventureNarrativeLocationPlanV1(input: {
  nodes: FrozenProductNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
  locationTitles: string[]
}): string[] {
  const sceneNodes = input.nodes.filter(node => node.kind !== 'ending')
  if (!sceneNodes.length || !input.locationTitles.length) return []
  const plan = planTextAdventureNarrativeLocationsV1(sceneNodes.length, input.locationTitles.length)
  const beatsByNode = new Map<string, string[]>()
  for (const beat of input.beats) {
    beatsByNode.set(beat.nodeKey, [...(beatsByNode.get(beat.nodeKey) ?? []), beat.text])
  }
  const errors: string[] = []
  const assignedTitleByNode = new Map<string, string>()
  sceneNodes.forEach((node, index) => {
    const expectedTitle = input.locationTitles[plan[index].locationIndex]
    assignedTitleByNode.set(node.key, expectedTitle)
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
