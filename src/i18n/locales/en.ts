/**
 * English locale (Phase 3.7 · i18n scaffold)
 *
 * Must mirror the structure of zh-CN.ts exactly (enforced by the `Locale` type).
 * Translate values; keep keys identical.
 */
import type { Locale } from './zh-CN'

export const en: Locale = {
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    confirm: 'Confirm',
    edit: 'Edit',
    add: 'Add',
    close: 'Close',
    loading: 'Loading…',
    generating: 'Generating…',
    generate: 'Generate',
    export: 'Export',
    import: 'Import',
    search: 'Search',
    retry: 'Retry',
    copy: 'Copy',
    copied: 'Copied',
    deleteConfirm: 'This cannot be undone. Delete anyway?',
    panelLoading: 'Loading panel…',
  },
  nav: {
    info: 'Project Info',
    worldview: 'Worldview',
    characters: 'Characters',
    outline: 'Outline',
    chapters: 'Chapters',
    settings: 'Settings',
  },
}
