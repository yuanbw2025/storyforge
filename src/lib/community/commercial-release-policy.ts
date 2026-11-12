import type { CommercialPlatformAuthorityV1 } from '../commercial/authority'
import type { CommunityReleasePolicyV1 } from './authority'

/**
 * Narrow anti-corruption adapter between commercial ownership/entitlements
 * and community hosting/lineage. Community code never inspects payment rows.
 */
export class CommercialCommunityReleasePolicyV1 implements CommunityReleasePolicyV1 {
  constructor(private readonly commercial: CommercialPlatformAuthorityV1) {}

  async canHost(userId: string, releaseHash: string): Promise<boolean> {
    return this.commercial.canHostRelease({ principal: { userId, permissions: [] }, releaseHash })
  }

  async canRegisterOriginal(userId: string, releaseHash: string): Promise<boolean> {
    return this.commercial.canRegisterRelease({ principal: { userId, permissions: [] }, releaseHash })
  }

  async reviewEligibility(userId: string, releaseHash: string): Promise<{
    entitled: boolean
    creator: boolean
  }> {
    const principal = { userId, permissions: [] }
    const entitlement = this.commercial.entitlementFor({ principal, releaseHash })
    return {
      entitled: entitlement?.status === 'active' && entitlement.hostedAccess,
      creator: this.commercial.canRegisterRelease({ principal, releaseHash }),
    }
  }

  async isReleaseCreator(userId: string, releaseHash: string): Promise<boolean> {
    return this.commercial.canRegisterRelease({
      principal: { userId, permissions: [] },
      releaseHash,
    })
  }
}
