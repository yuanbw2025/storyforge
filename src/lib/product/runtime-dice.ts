import { parseTtrpgDiceExpressionV2, sampleTtrpgDiceFromUint32V2 } from '../ttrpg/dice'

export interface DiceResolution {
  expression: string
  dice: number[]
  modifier: number
  total: number
  nonce: string
}

function hash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  hash ^= hash >>> 16
  return hash >>> 0
}

export function deterministicProductRuntimeDieV1(seed: string, sides: number): number {
  return sampleTtrpgDiceFromUint32V2({
    count: 1,
    sides,
    nextUint32: (sampleIndex) => {
      let value = hash32(`${seed}\u0000${sampleIndex}`)
      value += 0x6d2b79f5
      value = Math.imul(value ^ (value >>> 15), value | 1)
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
      return (value ^ (value >>> 14)) >>> 0
    },
  }).dice[0]
}

export function parseProductRuntimeDiceExpressionV1(expression: string): {
  normalized: string
  count: number
  sides: number
  modifier: number
} {
  return parseTtrpgDiceExpressionV2(expression)
}

export function buildProductRuntimeDiceResolutionV1(input: {
  seed: string
  sequence: number
  expression: ReturnType<typeof parseProductRuntimeDiceExpressionV1>
  nonce: string
}): DiceResolution {
  const dice = Array.from({ length: input.expression.count }, (_, index) => deterministicProductRuntimeDieV1(
    `${input.seed}\u0000${input.sequence}\u0000${input.expression.normalized}\u0000${input.nonce}\u0000${index}`,
    input.expression.sides,
  ))
  return {
    expression: input.expression.normalized,
    dice,
    modifier: input.expression.modifier,
    total: dice.reduce((sum, die) => sum + die, input.expression.modifier),
    nonce: input.nonce,
  }
}
