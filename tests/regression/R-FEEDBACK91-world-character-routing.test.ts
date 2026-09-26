import { describe, expect, it } from 'vitest'
import { classifyRequestedDomainIdsV1 } from '../../src/lib/agent/workflow-catalog'

describe('Feedback #91: world context does not request character production', () => {
  it.each([
    '修改世界设定中的力量体系，主角也遵守该机制',
    '修改世界设定中的力量体系，人物也遵守该机制',
    '修改世界设定，主角的能力也受约束',
    '修改主角所在的世界设定',
    '修改世界设定中主角受到的规则限制',
  ])('%s', request => {
    expect([...classifyRequestedDomainIdsV1(request)]).toEqual(['world-origin'])
  })
  it.each([
    '创建世界设定，并设计一位主角',
    '创建世界并生成主角',
    '创建世界和主角',
    '设计这个世界中的主角',
    '修改世界设定，完善主角的外貌',
    '建立世界，主角的外貌需要修改',
  ])('preserves explicitly requested character work: %s', request => {
    expect([...classifyRequestedDomainIdsV1(request)]).toEqual(['world-origin', 'character'])
  })
  it('retains character-only and downstream workflows', () => {
    expect([...classifyRequestedDomainIdsV1('主角')]).toEqual(['character'])
    expect([...classifyRequestedDomainIdsV1('设计主角')]).toEqual(['character'])
    expect([...classifyRequestedDomainIdsV1('以主角视角写第一章正文')]).toEqual(['prose'])
  })
})
