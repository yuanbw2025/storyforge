// Registry metadata must not eagerly import the runtime readers and reducers.
// Readers and their registered sources share these unchanged limits.
export const CHAT_CONTEXT_SOURCE_TOKENS_V1 = 8000
export const CHAT_COORDINATOR_SOURCE_TOKENS_V1 = 12_000
