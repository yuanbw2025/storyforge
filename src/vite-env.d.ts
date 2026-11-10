/// <reference types="vite/client" />

declare const __STORYFORGE_BUILD_SHA__: string

interface ImportMetaEnv {
  /** Public community endpoints only. The server-only secret key must never be prefixed with VITE. */
  readonly VITE_STORYFORGE_COMMUNITY_SHARING?: '0' | '1'
  readonly VITE_STORYFORGE_COMMUNITY_API_URL?: string
  readonly VITE_STORYFORGE_COMMUNITY_SUPABASE_URL?: string
  readonly VITE_STORYFORGE_COMMUNITY_SUPABASE_PUBLISHABLE_KEY?: string
  /** Experimental AVG image production; defaults off. Never put credentials in VITE variables. */
  readonly VITE_STORYFORGE_AVG_MEDIA_PRODUCTION?: '0' | '1'
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
