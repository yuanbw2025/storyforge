import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Editor from '../../src/components/ttrpg/TtrpgOpenSeatApprovalEditor'
import { defaultTtrpgSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { initializeTtrpgOpenAuthoringPoliciesV1 } from '../../src/lib/ttrpg/open-authoring-edit'
import { acknowledgeSeatApprovalSave, beginSeatApprovalDraft, clearSeatApprovalDraft, markSeatApprovalApplied,
  proposeSeatApprovalDraft, readSeatApprovalDraft, reviewSeatApprovalDraft, setSeatApprovalHost,
  updateSeatApprovalDraft, type OpenSeatSettings } from '../../src/components/ttrpg/open-seat-approval-draft'
import { flushPendingEditsV1, pendingEditDiagnosticsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const owner = { projectId: 1, worldId: 2, workId: 3 }
function settings(): OpenSeatSettings {
  const value = defaultTtrpgSettingsV2('open') as OpenSeatSettings
  value.openAuthoring = initializeTtrpgOpenAuthoringPoliciesV1(value.openAuthoring)
  return value
}
function selected(value: OpenSeatSettings) {
  const next = proposeSeatApprovalDraft(owner, 4, value)
  next.proposal.policy.approvalBindings = next.proposal.plan.seats.filter(seat => seat.controller === 'ai').map(seat => ({
    companionActorKey: seat.characterKey, approverSeatKeys: ['player.1'], partyResourceApprovalAllowed: false,
  }))
  return next
}
describe('R-TTRPGOPEN2 normal author seat approval UI and volatile recovery', () => {
  let root: Root, host: HTMLDivElement, value: OpenSeatSettings, detach: (() => void) | undefined
  beforeEach(() => { value = settings(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => {
    await act(async () => { root.unmount(); const pending = readSeatApprovalDraft(); if (pending) clearSeatApprovalDraft(pending) })
    detach?.(); detach = undefined; host.remove(); vi.restoreAllMocks()
    expect(pendingEditDiagnosticsV1().draftCount).toBe(0)
  })
  const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === text)!
  async function render(onApply = vi.fn(), revision = 4) {
    await act(async () => root.render(createElement(Editor, { owner, revision, value, onApply, onDiscard: vi.fn(), onVision: vi.fn() })))
  }
  it('creates nothing on mount; a human proposal reserves fresh keys but selects no approver or resource permission', async () => {
    const before = JSON.stringify(value); await render(); expect(readSeatApprovalDraft()).toBeNull()
    await act(async () => button('核对角色与批准席位').click())
    const pending = readSeatApprovalDraft()!
    expect(pending.proposal.plan.seats).toHaveLength(3)
    expect(pending.proposal.plan.seats.every(seat => seat.characterKey.startsWith('actor.reserved.'))).toBe(true)
    expect(pending.proposal.policy.approvalBindings).toEqual([])
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(input => !input.checked)).toBe(true)
    expect(JSON.stringify(value)).toBe(before)
    await expect(flushPendingEditsV1()).rejects.toThrow('批准配置尚未应用')
    await act(async () => button('应用批准配置到表单').click())
    expect(host.textContent).toContain('必须覆盖每个'); expect(readSeatApprovalDraft()).toBe(pending)
  })
  it('requires both explicit human checkboxes and applies only to the parent form', async () => {
    const apply = vi.fn(); await render(apply)
    await act(async () => button('核对角色与批准席位').click())
    const proposed = structuredClone(readSeatApprovalDraft()!.proposal.plan)
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[aria-label*=" 由 "]')]
    expect(inputs).toHaveLength(2)
    for (const input of inputs) await act(async () => input.click())
    await act(async () => button('应用批准配置到表单').click())
    expect(apply).toHaveBeenCalledOnce()
    expect(apply.mock.calls[0][1]).toEqual(proposed)
    expect(apply.mock.calls[0][2].approvalBindings.every((item: any) => item.approverSeatKeys.join() === 'player.1' && !item.partyResourceApprovalAllowed)).toBe(true)
    expect(value.authoringSeatPlan).toBeUndefined(); expect(readSeatApprovalDraft()!.applied).toBe(false)
  })
  it('retains the exact selected UUIDs and barrier across a complete editor unmount', async () => {
    await render(); await act(async () => beginSeatApprovalDraft(selected(value)))
    const before = structuredClone(readSeatApprovalDraft())
    await act(async () => root.render(null))
    await expect(flushPendingEditsV1()).rejects.toThrow('批准配置尚未应用')
    expect(readSeatApprovalDraft()).toEqual(before)
    await render(); expect(readSeatApprovalDraft()).toEqual(before)
    expect(host.querySelectorAll('input[aria-label*=" 由 "]:checked')).toHaveLength(2)
  })
  it('blocks other owners and detached hosts even after apply; only the actual newer matching save acknowledges', async () => {
    const pending = selected(value); beginSeatApprovalDraft(pending)
    const next = reviewSeatApprovalDraft(pending, owner, 4, value)
    value = { ...value, authoringSeatPlan: next.plan, openAuthoring: { ...value.openAuthoring, companionPolicy: next.policy } }
    markSeatApprovalApplied(readSeatApprovalDraft()!, value)
    await expect(flushPendingEditsV1()).rejects.toThrow()
    detach = setSeatApprovalHost(owner, 4, value)
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
    acknowledgeSeatApprovalSave(owner, 4, value); expect(readSeatApprovalDraft()).not.toBeNull()
    acknowledgeSeatApprovalSave({ ...owner, workId: 5 }, 5, value); expect(readSeatApprovalDraft()).not.toBeNull()
    acknowledgeSeatApprovalSave(owner, 5, settings()); expect(readSeatApprovalDraft()).not.toBeNull()
    detach(); await expect(flushPendingEditsV1()).rejects.toThrow()
    acknowledgeSeatApprovalSave(owner, 5, value); expect(readSeatApprovalDraft()).toBeNull()
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it('allows explicit reapplication after losing an applied form on SPA unmount, without generating new IDs', async () => {
    const pending = selected(value); beginSeatApprovalDraft(pending)
    const next = reviewSeatApprovalDraft(pending, owner, 4, value)
    markSeatApprovalApplied(readSeatApprovalDraft()!, { ...value, authoringSeatPlan: next.plan, openAuthoring: { ...value.openAuthoring, companionPolicy: next.policy } })
    const apply = vi.fn(); await render(apply)
    expect(button('应用批准配置到表单').disabled).toBe(false)
    await act(async () => button('应用批准配置到表单').click())
    expect(apply.mock.calls[0][1]).toEqual(next.plan)
  })
  it.each(['scope', 'revision', 'controller', 'policy'] as const)('refuses a changed %s and retains the original proposal', kind => {
    const pending = selected(value), copy = structuredClone(pending), scope = { ...owner }
    if (kind === 'scope') scope.workId++
    if (kind === 'controller') value.wizard.seats[1].controller = 'human'
    if (kind === 'policy') value.openAuthoring.companionPolicy!.preauthorizedActionKinds = ['observe']
    expect(() => reviewSeatApprovalDraft(pending, scope, kind === 'revision' ? 5 : 4, value)).toThrow()
    expect(pending).toEqual(copy)
  })
  it('never guesses old opaque identities; explicit replacement also requires review of removed old bindings', () => {
    value.openAuthoring.companionPolicy!.approvalBindings = [{ companionActorKey: 'opaque.existing', approverSeatKeys: ['player.1'], partyResourceApprovalAllowed: true }]
    const pending = proposeSeatApprovalDraft(owner, 4, value), before = JSON.stringify(value)
    expect(pending.proposal.manualIdentity).toBe(true); expect(pending.proposal.plan.seats.every(seat => seat.characterKey === '')).toBe(true)
    expect(() => reviewSeatApprovalDraft(pending, owner, 4, value)).toThrow('明确核对')
    expect(JSON.stringify(value)).toBe(before)
  })
  it('lets an author explicitly keep existing design identities even without old approval bindings', async () => {
    await render(); await act(async () => button('沿用已有设计的角色标识').click())
    const pending = readSeatApprovalDraft()!
    expect(pending.proposal.manualIdentity).toBe(true); expect(pending.proposal.plan.seats.every(seat => !seat.characterKey)).toBe(true)
    expect(pending.proposal.policy.approvalBindings).toEqual([])
  })
  it('requires a visible removal review when a formerly AI actor becomes human even though its identity is retained', () => {
    const old = selected(value)
    value.authoringSeatPlan = old.proposal.plan; value.openAuthoring.companionPolicy = old.proposal.policy
    value.wizard.seats[1].controller = 'human'
    const pending = proposeSeatApprovalDraft(owner, 4, value)
    expect(pending.proposal.plan.seats[1].characterKey).toBe(value.authoringSeatPlan.seats[1].characterKey)
    expect(() => reviewSeatApprovalDraft(pending, owner, 4, value)).toThrow('明确核对')
  })
  it('rejects another pending owner, stale buffer updates, and changed seats after application', async () => {
    beginSeatApprovalDraft(selected(value)); const pending = readSeatApprovalDraft()!
    expect(() => beginSeatApprovalDraft(selected(value))).toThrow('另一份')
    updateSeatApprovalDraft(pending, pending.proposal)
    expect(() => updateSeatApprovalDraft(pending, pending.proposal)).toThrow('已变化')
    const active = readSeatApprovalDraft()!, next = reviewSeatApprovalDraft(active, owner, 4, value)
    value = { ...value, authoringSeatPlan: next.plan, openAuthoring: { ...value.openAuthoring, companionPolicy: next.policy } }
    markSeatApprovalApplied(active, value); value.wizard.seats[1].controller = 'human'
    detach = setSeatApprovalHost(owner, 4, value)
    await expect(flushPendingEditsV1()).rejects.toThrow()
  })
  it('keeps a temporarily invalid author form recoverable and blocks formal work', async () => {
    beginSeatApprovalDraft(selected(value)); const active = readSeatApprovalDraft()!
    const next = reviewSeatApprovalDraft(active, owner, 4, value)
    value = { ...value, authoringSeatPlan: next.plan, openAuthoring: { ...value.openAuthoring, companionPolicy: next.policy } }
    markSeatApprovalApplied(active, value)
    value.wizard.seats[0].label = 'x'.repeat(10000)
    expect(() => { detach = setSeatApprovalHost(owner, 4, value) }).not.toThrow()
    await render(); expect(button('应用批准配置到表单').disabled).toBe(false)
    await expect(flushPendingEditsV1()).rejects.toThrow()
    expect(readSeatApprovalDraft()!.proposal.plan).toEqual(next.plan)
  })
})
