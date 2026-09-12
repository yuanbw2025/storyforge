import { describe, expect, it } from 'vitest'
import {
  VerifiableOnlineDiceV1,
  verifyOnlineDiceReceiptV1,
} from '../../src/lib/online/verifiable-dice'

describe('TTRPG-1D · server-authoritative verifiable dice', () => {
  it('房间先公布承诺根，再逐次揭示单颗种子且客户端可独立验算', async () => {
    const engine = await VerifiableOnlineDiceV1.create({
      roomId: 'room.dice',
      releaseHash: 'a'.repeat(64),
      maximumRolls: 4,
    })
    expect(engine.commitments.commitments).toHaveLength(4)
    expect(engine.commitments).not.toHaveProperty('seeds')
    const first = await engine.roll('2d6+3')
    const second = await engine.roll('1d20-1')
    expect(first).toMatchObject({ rollIndex: 0, expression: '2d6+3', modifier: 3 })
    expect(second).toMatchObject({ rollIndex: 1, expression: '1d20-1', modifier: -1 })
    expect(first.dice.every(value => value >= 1 && value <= 6)).toBe(true)
    expect(await verifyOnlineDiceReceiptV1({ commitments: engine.commitments, receipt: first })).toBe(true)
    expect(await verifyOnlineDiceReceiptV1({ commitments: engine.commitments, receipt: second })).toBe(true)
  })

  it('任何种子、表达式、结果或承诺列表篡改都会验算失败', async () => {
    const engine = await VerifiableOnlineDiceV1.create({
      roomId: 'room.tamper', releaseHash: 'b'.repeat(64), maximumRolls: 2,
    })
    const receipt = await engine.roll('3d8')
    expect(await verifyOnlineDiceReceiptV1({
      commitments: engine.commitments,
      receipt: { ...receipt, seed: '0'.repeat(64) },
    })).toBe(false)
    expect(await verifyOnlineDiceReceiptV1({
      commitments: engine.commitments,
      receipt: { ...receipt, expression: '3d10' },
    })).toBe(false)
    const tamperedDice = [...receipt.dice]
    tamperedDice[0] = receipt.dice[0] === 8 ? 7 : 8
    expect(await verifyOnlineDiceReceiptV1({
      commitments: engine.commitments,
      receipt: { ...receipt, dice: tamperedDice, total: tamperedDice.reduce((sum, value) => sum + value, 0) },
    })).toBe(false)
    expect(await verifyOnlineDiceReceiptV1({
      commitments: engine.commitments,
      receipt: { ...receipt, rollTrace: { ...receipt.rollTrace, rejectedSamples: receipt.rollTrace.rejectedSamples + 1 } },
    })).toBe(false)
    expect(await verifyOnlineDiceReceiptV1({
      commitments: { ...engine.commitments, commitments: ['c'.repeat(64), ...engine.commitments.commitments.slice(1)] },
      receipt,
    })).toBe(false)
  })

  it('重启从加密服务端检查点继续，不能重复使用已揭示的 rollIndex', async () => {
    const engine = await VerifiableOnlineDiceV1.create({
      roomId: 'room.restart-dice', releaseHash: 'c'.repeat(64), maximumRolls: 2,
    })
    await engine.roll('1d6')
    const restored = await VerifiableOnlineDiceV1.restore(engine.exportServerCheckpoint())
    const second = await restored.roll('1d6')
    expect(second.rollIndex).toBe(1)
    expect(await verifyOnlineDiceReceiptV1({ commitments: restored.commitments, receipt: second })).toBe(true)
    await expect(restored.roll('1d6')).rejects.toThrow('预承诺骰子已经用完')
  })

  it('拒绝超大骰池、非法骰面和修正值', async () => {
    const engine = await VerifiableOnlineDiceV1.create({
      roomId: 'room.bounds', releaseHash: 'd'.repeat(64), maximumRolls: 3,
    })
    await expect(engine.roll('101d6')).rejects.toThrow('数量')
    await expect(engine.roll('1d1')).rejects.toThrow('骰面')
    await expect(engine.roll('1d100')).resolves.toMatchObject({ expression: '1d100' })
    await expect(engine.roll('1d101')).rejects.toThrow('d2～d100')
    await expect(engine.roll('1d6+10001')).rejects.toThrow('修正值')
  })
})
