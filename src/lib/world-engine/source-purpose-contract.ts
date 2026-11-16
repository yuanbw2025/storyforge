import { sha256 } from '@noble/hashes/sha2.js'
import { canonicalStringify } from '../agent/run/hash'
import { UPPER_PRODUCT_KINDS_V1, type UpperProductKindV1 } from '../types/product-identity'
import type { WorldSourceDeclarationV1 } from '../types/world-sharing'
import { parseWorldSourceDeclarationV1 } from './source-declaration'

type ReleaseIdentity = { releaseUid: string; releaseHash: string }
type LocalWorldOwnerIdentity = { workspaceUid: string; worldCode: string }
export type PurposeOrigin =
  | { kind: 'declared'; relation: 'installed'; declarationWire: string }
  | { kind: 'declared'; relation: 'editing-lineage'; declarationWire: string; authorWorld: LocalWorldOwnerIdentity }
  | { kind: 'local-author'; authorWorld: LocalWorldOwnerIdentity }
export type WorldSourcePurposeProofV1 = {
  version: 1
  purpose: UpperProductKindV1
  selectedRelease: ReleaseIdentity
  origin: PurposeOrigin
  evidenceHash: string
}

export function fail(message: string): never { throw new Error('[world-source-purpose] ' + message) }
function closed(value: object, keys: string[]) {
  const actual = Object.keys(value).sort(), expected = keys.sort()
  return actual.length === expected.length && actual.every((key, i) => key === expected[i])
}

export function purposeHash(value: unknown) {
  return Array.from(sha256(new TextEncoder().encode(canonicalStringify(value))), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Product contracts normalize every JSON string to NFC. Preserve the
 * original declaration by escaping its UTF-16 code units on the wire. */
export function encodeDeclaration(value: WorldSourceDeclarationV1): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, unit =>
    '\\u' + unit.charCodeAt(0).toString(16).padStart(4, '0'))
}

export function readWorldSourcePurposeDeclarationV1(origin: Extract<PurposeOrigin, { kind: 'declared' }>) {
  if (typeof origin.declarationWire !== 'string') fail('用途声明原文缺失。')
  let value: unknown
  try { value = JSON.parse(origin.declarationWire) }
  catch { fail('用途声明原文无效。') }
  const declaration = parseWorldSourceDeclarationV1(value)
  if (encodeDeclaration(declaration) !== origin.declarationWire) fail('用途声明原文编码不一致。')
  return declaration
}

export function parseWorldSourcePurposeProofV1(value: unknown): WorldSourcePurposeProofV1 {
  const proof = value as WorldSourcePurposeProofV1
  if (!proof || !closed(proof, ['version', 'purpose', 'selectedRelease', 'origin', 'evidenceHash']) ||
    proof.version !== 1 || !UPPER_PRODUCT_KINDS_V1.includes(proof.purpose) || !proof.selectedRelease ||
    !closed(proof.selectedRelease, ['releaseUid', 'releaseHash']) ||
    typeof proof.selectedRelease.releaseUid !== 'string' || !proof.selectedRelease.releaseUid ||
    typeof proof.selectedRelease.releaseHash !== 'string' || !/^[a-f0-9]{64}$/.test(proof.selectedRelease.releaseHash) ||
    !proof.origin) fail('来源用途与当前产品、冻结版本或身份不匹配。')
  function validAuthorWorld(value: LocalWorldOwnerIdentity) {
    return value && closed(value, ['workspaceUid', 'worldCode']) && typeof value.workspaceUid === 'string' &&
      value.workspaceUid.length > 0 && typeof value.worldCode === 'string' && value.worldCode.length > 0
  }
  if (proof.origin.kind === 'declared') {
    const installed = proof.origin.relation === 'installed'
    if (installed ? !closed(proof.origin, ['kind', 'relation', 'declarationWire'])
      : proof.origin.relation !== 'editing-lineage' || !closed(proof.origin, ['kind', 'relation', 'declarationWire', 'authorWorld'])
        || !validAuthorWorld(proof.origin.authorWorld)) fail('未知来源关系。')
    const declaration = readWorldSourcePurposeDeclarationV1(proof.origin)
    if (declaration.allowedUses[proof.purpose] !== true) fail('所选原包声明不允许此产品用途。')
    if (installed && declaration.releaseHash !== proof.selectedRelease.releaseHash)
      fail('所选原包声明与冻结版本不匹配。')
  } else if (proof.origin.kind !== 'local-author' || !closed(proof.origin, ['kind', 'authorWorld']) || !validAuthorWorld(proof.origin.authorWorld)) {
    fail('未知作者来源证据。')
  }
  const { evidenceHash, ...body } = proof
  if (purposeHash(body) !== evidenceHash) fail('来源用途证据 hash 无效。')
  return structuredClone(proof)
}

export function validateWorldSourcePurposeProofV1(value: unknown, selection: ReleaseIdentity, purpose: UpperProductKindV1) {
  const proof = parseWorldSourcePurposeProofV1(value)
  if (proof.purpose !== purpose || proof.selectedRelease.releaseUid !== selection.releaseUid ||
    proof.selectedRelease.releaseHash !== selection.releaseHash) fail('来源用途与当前产品或冻结版本不匹配。')
  return proof
}

export type WorldSourcePurposeInputV1 = {
  worldReleaseId: number
  expectedProjectId: number
  expectedWorldId: number
  purpose: UpperProductKindV1
  proof?: WorldSourcePurposeProofV1
}
