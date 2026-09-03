import type { NarrativeCondition, NarrativeEffect } from './narrative-blueprint'

/** Runtime interaction types shared only by the three declared text-game products. */
export interface NarrativeChoiceEvaluation {
  choiceKey: string
  visible: boolean
  available: boolean
  unavailableReason: string
  targetNodeKey: string
}

export interface NarrativeChoiceCommittedPayload {
  commandId: string
  baseSequence: number
  baseStateHash: string
  fromNodeKey: string
  choiceKey: string
  toNodeKey: string
}

export interface NarrativeChoiceHistoryEntry {
  eventSequence: number
  choiceKey: string
  fromNodeKey: string
  toNodeKey: string
}

export type ParsedNarrativeCondition = NarrativeCondition
export type ParsedNarrativeEffect = NarrativeEffect
