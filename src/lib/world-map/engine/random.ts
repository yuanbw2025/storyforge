/**
 * 可种子化的伪随机数生成器（Alea PRNG）
 */

export function seedRandom(seed: string): () => number {
  let s0 = mash(seed)
  let s1 = mash(seed)
  let s2 = mash(seed)
  let c = 1

  return () => {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10
    s0 = s1
    s1 = s2
    c = t | 0
    s2 = t - c
    return s2
  }
}

function mash(data: string): number {
  let n = 0xefc8249d
  for (let i = 0; i < data.length; i++) {
    n += data.charCodeAt(i)
    let h = 0.02519603282416938 * n
    n = h >>> 0
    h -= n
    h *= n
    n = h >>> 0
    h -= n
    n += h * 0x100000000
  }
  return (n >>> 0) * 2.3283064365386963e-10
}

/** 高斯随机数（Box-Muller） */
export function gauss(rng: () => number, mean = 0, std = 1): number {
  const u1 = rng()
  const u2 = rng()
  const z0 = Math.sqrt(-2.0 * Math.log(u1 || 1e-10)) * Math.cos(2.0 * Math.PI * u2)
  return z0 * std + mean
}

/** 在范围内的随机整数 [min, max] */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

/** 概率 p 返回 true */
export function chance(rng: () => number, p: number): boolean {
  return rng() < p
}

/** 从数组中随机选一个 */
export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}
