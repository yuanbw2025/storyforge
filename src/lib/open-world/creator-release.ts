import type {
  TextOpenWorldCreatorReleaseAuthorizationV1,
  WorkspaceScope,
} from '../types'
import {
  prepareProductProductionAdoption,
  publishProductProductionBuild,
  type PreparedProductProductionAdoptionV1,
  type ProductProductionPublishReceiptV1,
} from '../product-production/adoption'
import { createTextOpenWorldCreatorReleaseAuthorizationV1 } from './creator-release-contract'

export interface PreparedTextOpenWorldCreatorPublicationV1
  extends PreparedProductProductionAdoptionV1 {
  productType: 'text-open-world'
  creatorRelease: NonNullable<PreparedProductProductionAdoptionV1['creatorRelease']>
}

export interface TextOpenWorldCreatorPublicationAcknowledgementV1 {
  sourceAndRightsReviewed: boolean
  buildAndQualityReviewed: boolean
  immutableReleaseReviewed: boolean
  publishNow: boolean
}

function fail(message: string): never {
  throw new Error(`[text-open-world-creator-release] ${message}`)
}

export async function prepareTextOpenWorldCreatorReleaseV1(input: {
  scope: WorkspaceScope
  productionId: number
  expectedBuildId?: number
}): Promise<PreparedTextOpenWorldCreatorPublicationV1> {
  const prepared = await prepareProductProductionAdoption(input)
  if (prepared.productType !== 'text-open-world' || !prepared.creatorRelease) {
    fail('目标Production不是通过Creator双来源生产体系生成的文字开放世界Build')
  }
  if (input.expectedBuildId != null && prepared.intent.buildId !== input.expectedBuildId) {
    fail('发布面板绑定的Build已经变化，请刷新后重新确认')
  }
  return prepared as PreparedTextOpenWorldCreatorPublicationV1
}

export async function publishTextOpenWorldCreatorReleaseV1(input: {
  scope: WorkspaceScope
  productionId: number
  prepared: PreparedTextOpenWorldCreatorPublicationV1
  releaseLabel: string
  acknowledgement: TextOpenWorldCreatorPublicationAcknowledgementV1
  authorizationNonce: string
  authorizedAt?: number
}): Promise<{
  authorization: TextOpenWorldCreatorReleaseAuthorizationV1
  receipt: ProductProductionPublishReceiptV1
}> {
  const releaseLabel = input.releaseLabel.trim().normalize('NFC')
  if (!releaseLabel) fail('发布名称不能为空')
  if (Object.values(input.acknowledgement).some(value => value !== true)) {
    fail('发布前四项作者确认必须全部完成')
  }
  const authorization = await createTextOpenWorldCreatorReleaseAuthorizationV1({
    productInstanceKey: input.prepared.intent.productionKey,
    buildNumber: input.prepared.intent.buildNumber,
    adoptionIntentHash: input.prepared.adoptionIntentHash,
    buildManifestHash: input.prepared.intent.manifestHash,
    runtimePackageHash: input.prepared.intent.packageHash,
    releaseQualityReceiptHash: input.prepared.creatorRelease.releaseQualityReceiptHash,
    releaseLabel,
    acknowledgement: {
      sourceAndRightsReviewed: true,
      buildAndQualityReviewed: true,
      immutableReleaseReviewed: true,
      publishNow: true,
    },
    authorizationNonce: input.authorizationNonce,
    ...(input.authorizedAt == null ? {} : { authorizedAt: input.authorizedAt }),
  })
  const receipt = await publishProductProductionBuild({
    scope: input.scope,
    productionId: input.productionId,
    label: releaseLabel,
    creatorReleaseAuthorization: authorization,
    command: {
      type: 'publish',
      commandId: `text-open-world.publish.${authorization.authorizationHash.slice(0, 24)}`,
      expectedStateRevision: input.prepared.intent.expectedStateRevision,
      buildNumber: input.prepared.intent.buildNumber,
      expectedManifestHash: input.prepared.intent.manifestHash,
      adoptionIntentHash: input.prepared.adoptionIntentHash,
      creatorReleaseAuthorizationHash: authorization.authorizationHash,
    },
  })
  return { authorization, receipt }
}
