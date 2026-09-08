/// <reference types="vite/client" />

declare const __STORYFORGE_BUILD_SHA__: string

interface ImportMetaEnv {
  /** Same-origin, hash-verified image pack for an explicitly configured community prototype. */
  readonly VITE_STORYFORGE_AUTHORED_IMAGE_PACK_URL?: string
  readonly VITE_STORYFORGE_MEDIA_RELAY_URL?: string
  readonly VITE_STORYFORGE_ONLINE_SERVICE_URL?: string
  readonly VITE_STORYFORGE_PLATFORM_SERVICE_URL?: string
  /** Set by an audited production deployment only after the sealed real-model gate passes. */
  readonly VITE_STORYFORGE_TTRPG_AI_GM_BETA_GATE?: 'passed'
  readonly VITE_STORYFORGE_TTRPG_AI_GM_BETA_POLICY_VERSION?: 'ttrpg-gm-beta-gate-v1'
  readonly VITE_STORYFORGE_TTRPG_AI_GM_BETA_REPORT_HASH?: string
}
