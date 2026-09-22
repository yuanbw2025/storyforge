const PROVIDER_QUOTA_REJECTION_PATTERN = /(?:insufficient[_\s-]*(?:user[_\s-]*)?(?:quota|balance|credit)|quota[_\s-]*(?:exceeded|exhausted)|billing[_\s-]*hard[_\s-]*limit[_\s-]*reached|account[_\s-]*overdue(?:[_\s-]*error)?|overdue[_\s-]*(?:account|balance|payment)|余额不足|账户?欠费|剩余额度|预扣费额度失败|配额(?:已用完|不足|耗尽|超出))/i

/**
 * Provider quota and account-credit rejection is an external-state pause,
 * not an invalid credential and not a transient rate limit. Status alone is
 * insufficient because OpenAI-compatible gateways commonly report it as 403
 * or 429 instead of 402.
 */
export function isProviderQuotaRejectionV1(input: {
  status: number
  message: string
}): boolean {
  return input.status === 402 || PROVIDER_QUOTA_REJECTION_PATTERN.test(input.message)
}
