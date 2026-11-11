import { describe, expect, it } from 'vitest'
import { generateStates } from '../../src/lib/world-map/engine/nations'
import { generateMap } from '../../src/lib/world-map/engine/generate'
import type { Burg, GridCells } from '../../src/lib/world-map/engine/types'

function chain(length = 30): GridCells {
  return {
    length, p: new Float64Array(length * 2),
    c: Array.from({ length }, (_, i) => [i - 1, i + 1].filter(n => n >= 0 && n < length)),
    v: Array.from({ length }, () => []), b: new Uint8Array(length),
    h: new Uint8Array(length).fill(30), t: new Int8Array(length), f: new Uint16Array(length),
    temp: new Int8Array(length), prec: new Uint8Array(length), biome: new Uint8Array(length).fill(4),
    r: new Uint16Array(length), fl: new Float32Array(length), s: new Float32Array(length).fill(10),
    pop: new Float32Array(length).fill(2), culture: new Uint16Array(length).fill(1),
    state: new Uint16Array(length), burg: new Uint16Array(length), haven: new Uint16Array(length), harbor: new Uint8Array(length),
  }
}

function capitals(...cells: number[]): Burg[] {
  return [
    { i: 0, name: '', cell: 0, x: 0, y: 0, state: 0, capital: false, port: false, population: 0 },
    ...cells.map((cell, i) => ({ i: i + 1, name: `capital${i}`, cell, x: cell, y: 0, state: i + 1, capital: true, port: false, population: 2 })),
  ]
}

const fractionalExpansion = () => (1.5 - 0.8) / 1.5

describe('SFQA119: nation frontier and stored costs share numeric precision', () => {
  it.each([[fractionalExpansion, 8], [() => (1 - 0.8) / 1.5, 5]] as const)('expands a chain to its unchanged cost budget', (rng, expectedCells) => {
    const cells = chain()
    const states = generateStates(cells, capitals(0), 1, rng)
    expect(Array.from(cells.state)).toEqual(Array.from({ length: 30 }, (_, i) => i < expectedCells ? 1 : 0))
    expect(states[1]).toMatchObject({ cells: expectedCells, totalPopulation: expectedCells * 2 })
  })

  it.each(['water', 'mountain', 'culture', 'uninhabitable', 'low-budget'] as const)('still respects the %s boundary', boundary => {
    const cells = chain(boundary === 'low-budget' ? 3 : 30)
    if (boundary === 'water') cells.h[1] = 19
    if (boundary === 'mountain') cells.h[1] = 80
    if (boundary === 'culture') cells.culture[1] = 2
    if (boundary === 'uninhabitable') cells.s[1] = 0
    generateStates(cells, capitals(0), 1, fractionalExpansion)
    expect(Array.from(cells.state)).toEqual([1, ...Array(cells.length - 1).fill(0)])
  })

  it('continues to skip a genuinely stale, more expensive queue entry', () => {
    const cells = chain()
    cells.c[0] = [2]
    cells.c[1] = [2]
    cells.c[2] = [0, 1, 3]
    let frontierReads = 0
    cells.c = new Proxy(cells.c, {
      get(target, key, receiver) {
        if (key === '2') frontierReads += 1
        return Reflect.get(target, key, receiver)
      },
    })
    const expansions = [1, 2]
    generateStates(cells, capitals(0, 1), 2, () => (expansions.shift()! - 0.8) / 1.5)
    expect(cells.state[2]).toBe(2)
    // One valid expansion plus the three unchanged smoothing passes, not the stale cost=5 entry.
    expect(frontierReads).toBe(4)
  })

  it('keeps a complete valid map generation reproducible for a fixed seed', () => {
    const config = { seed: 'sfqa119-fixed-map', pointCount: 250, width: 400, height: 250, stateCount: 3 }
    const first = generateMap(config)
    const second = generateMap(config)
    expect(second).toEqual(first)
    expect(first.states.length).toBeGreaterThan(1)
  })
})
