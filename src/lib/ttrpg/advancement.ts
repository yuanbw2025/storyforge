import type { TtrpgRuntimeState } from '../types'

type Product = NonNullable<TtrpgRuntimeState['product']>

/** Milestones award every active PC; actor-targeted XP/currency effects adjust that PC. */
export function earnedTtrpgCharacterCurrencyV2(product: Product, characterKey: string): number {
  const ledger = product.effectLedger
  const targetedXp = ledger?.advancementBalances[`${characterKey}:xp:${product.advancement.currencyKey}`] ?? 0
  const targetedCurrency = ledger?.advancementBalances[`${characterKey}:${product.advancement.currencyKey}`] ?? 0
  return Math.max(0, product.advancement.totalAwarded + targetedXp + targetedCurrency)
}

export function availableTtrpgCharacterCurrencyV2(product: Product, characterKey: string): number {
  const spent = product.characterProgression?.[characterKey]?.spentCurrency ?? 0
  return Math.max(0, earnedTtrpgCharacterCurrencyV2(product, characterKey) - spent)
}
