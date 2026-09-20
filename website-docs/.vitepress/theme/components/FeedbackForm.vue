<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useData } from 'vitepress'

const { lang } = useData()
const t = (zh: string, en: string): string => lang.value.startsWith('en') ? en : zh

type FeedbackType = 'bug' | 'feature' | 'documentation'
type FileKind = 'image' | 'video' | 'other'

interface FeedbackFields {
  title: string
  description: string
  version: string
  os: string
  browser: string
  module: string
  model: string
  page: string
  contact: string
  problem: string
  workaround: string
  steps: string
  expected: string
  actual: string
  solution: string
  correction: string
  extra: string
}

interface Attachment {
  file: File
  kind: FileKind
}

const props = defineProps<{ type: FeedbackType }>()

const MAX_ATTACHMENTS = 3
const MAX_TOTAL_BYTES = 145 * 1024 * 1024
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 100 * 1024 * 1024
const MAX_OTHER_BYTES = 30 * 1024 * 1024

const acceptedMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'text/plain',
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
]

const acceptedExtensions = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.mov',
  '.txt',
  '.log',
  '.json',
  '.zip',
]

const acceptedTypes = [...acceptedMimeTypes, ...acceptedExtensions].join(',')

const fields = reactive<FeedbackFields>({
  title: '',
  description: '',
  version: '',
  os: '',
  browser: '',
  module: '',
  model: '',
  page: '',
  contact: '',
  problem: '',
  workaround: '',
  steps: '',
  expected: '',
  actual: '',
  solution: '',
  correction: '',
  extra: '',
})

const attachments = ref<Attachment[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const honeypot = ref('')
const isDragging = ref(false)
const submitting = ref(false)
const successMessage = ref('')
const errorMessage = ref('')

const typeMeta = computed(() => {
  const metadata: Record<FeedbackType, { label: string; intro: string }> = {
    bug: {
      label: t('Bug 报告', 'Bug report'),
      intro: t('请填写可复现的问题和必要环境信息，帮助我们定位实际影响。', 'Describe a reproducible problem and the relevant environment.'),
    },
    feature: {
      label: t('功能建议', 'Feature request'),
      intro: t('请说明使用场景、当前阻碍和期望的改进方向。', 'Describe your use case, current obstacle, and desired improvement.'),
    },
    documentation: {
      label: t('文档纠错', 'Documentation correction'),
      intro: t('请指出页面位置、错误内容和建议修订方式。', 'Identify the page, incorrect content, and suggested correction.'),
    },
  }
  return metadata[props.type]
})

const totalAttachmentBytes = computed(() => attachments.value.reduce((total, item) => total + item.file.size, 0))
const attachmentSummary = computed(() => `${attachments.value.length}/${MAX_ATTACHMENTS} ${t('个附件', 'attachments')} · ${formatBytes(totalAttachmentBytes.value)}/${formatBytes(MAX_TOTAL_BYTES)}`)

function extensionOf(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? ''
}

function kindOf(file: File): FileKind {
  const extension = extensionOf(file)
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) return 'image'
  if (file.type.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(extension)) return 'video'
  return 'other'
}

function maxBytesFor(kind: FileKind): number {
  if (kind === 'image') return MAX_IMAGE_BYTES
  if (kind === 'video') return MAX_VIDEO_BYTES
  return MAX_OTHER_BYTES
}

function isAcceptedFile(file: File): boolean {
  const extension = `.${extensionOf(file)}`
  return acceptedMimeTypes.includes(file.type) || acceptedExtensions.includes(extension)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** unitIndex
  return `${value.toFixed(unitIndex === 0 || value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatFileKind(kind: FileKind): string {
  if (kind === 'image') return t('图片', 'Image')
  if (kind === 'video') return t('视频', 'Video')
  return t('文件', 'File')
}

function fileIcon(kind: FileKind): string {
  if (kind === 'image') return '▧'
  if (kind === 'video') return '▶'
  return '≡'
}

function validateFile(file: File, currentCount: number, currentBytes: number): string | null {
  if (currentCount >= MAX_ATTACHMENTS) return t(`最多 ${MAX_ATTACHMENTS} 个附件。`, `Up to ${MAX_ATTACHMENTS} attachments.`)
  if (!isAcceptedFile(file)) return t(`${file.name} 的类型不受支持，请选择图片、视频、日志、JSON 或 ZIP 文件。`, `${file.name}: unsupported type. Choose an image, video, log, JSON, or ZIP file.`)

  const kind = kindOf(file)
  const maxBytes = maxBytesFor(kind)
  if (file.size > maxBytes) {
    return t(`${file.name} 超过${formatFileKind(kind)}单个 ${formatBytes(maxBytes)} 的限制。`, `${file.name} exceeds the ${formatBytes(maxBytes)} per-file limit for ${formatFileKind(kind).toLowerCase()} files.`)
  }
  if (currentBytes + file.size > MAX_TOTAL_BYTES) {
    return t(`附件总大小不能超过 ${formatBytes(MAX_TOTAL_BYTES)}。`, `Total attachments must not exceed ${formatBytes(MAX_TOTAL_BYTES)}.`)
  }
  return null
}

function isSameFile(left: File, right: File): boolean {
  return left.name === right.name && left.size === right.size && left.type === right.type
}

function addFiles(files: File[]): void {
  errorMessage.value = ''
  successMessage.value = ''
  const nextAttachments = [...attachments.value]
  let nextBytes = totalAttachmentBytes.value

  for (const file of files) {
    if (nextAttachments.some(({ file: existingFile }) => isSameFile(existingFile, file))) continue

    const error = validateFile(file, nextAttachments.length, nextBytes)
    if (error) {
      errorMessage.value = error
      break
    }
    nextAttachments.push({ file, kind: kindOf(file) })
    nextBytes += file.size
  }

  attachments.value = nextAttachments
}

function openFilePicker(): void {
  fileInput.value?.click()
}

function handleFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  addFiles(Array.from(input.files ?? []))
  input.value = ''
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false
  addFiles(Array.from(event.dataTransfer?.files ?? []))
}

function handlePaste(event: ClipboardEvent): void {
  const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.kind === 'file' && item.type.startsWith('image/'))
  const sourceFile = imageItem?.getAsFile()
  if (!sourceFile) return

  event.preventDefault()
  const extension = sourceFile.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const pastedFile = new File([sourceFile], `screenshot-${timestamp}.${extension}`, { type: sourceFile.type || 'image/png' })
  addFiles([pastedFile])
}

function removeAttachment(index: number): void {
  attachments.value.splice(index, 1)
  errorMessage.value = ''
}

function validationMessage(): string {
  if (!fields.title.trim()) return t('请填写标题。', 'Please enter a title.')
  if (props.type === 'feature' && !fields.problem.trim()) return t('请填写使用场景 / 当前问题。', 'Please describe the use case / current problem.')
  if (props.type !== 'feature' && !fields.description.trim()) return t('请填写问题描述。', 'Please describe the problem.')
  return ''
}

function statusMessage(status: number): string {
  if (status === 400) return t('提交内容不完整或格式不正确。', 'The submission is incomplete or has an invalid format.')
  if (status === 413) return t('附件大小超过服务器限制，请减少附件或压缩后再试。', 'Attachments exceed the server limit. Remove or compress files and try again.')
  if (status === 429) return t('提交过于频繁，请稍后再试。', 'Too many submissions. Please try again later.')
  if (status === 500 || status === 502) return t('反馈服务暂时不可用，请稍后再试。', 'The feedback service is temporarily unavailable. Please try again later.')
  return t(`服务器返回错误（${status}）。`, `Server error (${status}).`)
}

function serverError(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim().slice(0, 500)
  }
  return statusMessage(status)
}

function isSuccessfulResponse(payload: unknown): payload is { ok: true; issueNumber?: number | string } {
  return Boolean(payload && typeof payload === 'object' && 'ok' in payload && payload.ok === true)
}

async function submit(): Promise<void> {
  if (submitting.value) return
  errorMessage.value = ''
  successMessage.value = ''

  const validationError = validationMessage()
  if (validationError) {
    errorMessage.value = validationError
    return
  }

  submitting.value = true
  try {
    const formData = new FormData()
    const payload: Record<string, string> = {
      type: props.type,
      title: fields.title.trim(),
      description: props.type === 'feature' ? fields.problem.trim() : fields.description.trim(),
      version: fields.version.trim(),
      os: fields.os.trim(),
      browser: fields.browser.trim(),
      module: fields.module.trim(),
      model: fields.model.trim(),
      page: fields.page.trim(),
      contact: fields.contact.trim(),
      problem: fields.problem.trim(),
      steps: fields.steps.trim(),
      expected: fields.expected.trim(),
      actual: fields.actual.trim(),
      solution: fields.solution.trim(),
      correction: fields.correction.trim(),
      extra: props.type === 'feature'
        ? [fields.workaround.trim(), fields.extra.trim()].filter(Boolean).join('\n\n')
        : fields.extra.trim(),
      website: honeypot.value,
    }

    Object.entries(payload).forEach(([key, value]) => formData.append(key, value))
    attachments.value.forEach(({ file }) => formData.append('attachments', file, file.name))

    const response = await fetch('/api/feedback', { method: 'POST', body: formData })
    const result: unknown = await response.json().catch(() => null)
    if (!response.ok || !isSuccessfulResponse(result)) {
      throw new Error(serverError(result, response.status))
    }

    const number = result.issueNumber
    successMessage.value = number === undefined ? t('反馈已提交', 'Feedback submitted') : t(`反馈已提交，编号 #${number}`, `Feedback submitted, #${number}`)
    attachments.value = []
    Object.keys(fields).forEach((key) => {
      fields[key as keyof FeedbackFields] = ''
    })
  } catch (error) {
    errorMessage.value = error instanceof Error && error.message ? error.message : t('反馈提交失败，请稍后重试。', 'Feedback submission failed. Please try again later.')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="feedback-form-shell" :aria-label="typeMeta.label">
    <p class="feedback-form-intro">{{ typeMeta.intro }}</p>

    <div v-if="successMessage" class="feedback-notice feedback-notice--success" role="status" aria-live="polite">
      {{ successMessage }}
    </div>
    <div v-if="errorMessage" class="feedback-notice feedback-notice--error" role="alert" aria-live="assertive">
      {{ errorMessage }}
    </div>

    <form class="feedback-form" @submit.prevent="submit" @paste="handlePaste">
      <input v-model="honeypot" class="feedback-honeypot" type="text" name="website" autocomplete="off" tabindex="-1" aria-hidden="true" />

      <div class="feedback-field feedback-field--full">
        <label :for="props.type + '-title'">{{ t('标题', 'Title') }} <span class="feedback-required">{{ t('必填', 'Required') }}</span></label>
        <input :id="props.type + '-title'" v-model="fields.title" type="text" name="title" required maxlength="160" autocomplete="off" />
      </div>

      <template v-if="props.type === 'bug'">
        <div class="feedback-field feedback-field--full">
          <label :for="props.type + '-description'">{{ t('问题描述', 'Problem description') }} <span class="feedback-required">{{ t('必填', 'Required') }}</span></label>
          <textarea :id="props.type + '-description'" v-model="fields.description" name="description" required rows="7" :placeholder="t('发生了什么？在什么情况下出现？', 'What happened, and under what conditions?')"></textarea>
        </div>
        <div class="feedback-field-grid">
          <div class="feedback-field"><label :for="props.type + '-version'">{{ t('StoryForge 版本', 'StoryForge version') }}</label><input :id="props.type + '-version'" v-model="fields.version" type="text" name="version" /></div>
          <div class="feedback-field"><label :for="props.type + '-os'">{{ t('操作系统', 'Operating system') }}</label><input :id="props.type + '-os'" v-model="fields.os" type="text" name="os" /></div>
          <div class="feedback-field"><label :for="props.type + '-browser'">{{ t('浏览器', 'Browser') }}</label><input :id="props.type + '-browser'" v-model="fields.browser" type="text" name="browser" /></div>
          <div class="feedback-field"><label :for="props.type + '-module'">{{ t('相关模块', 'Related module') }}</label><input :id="props.type + '-module'" v-model="fields.module" type="text" name="module" /></div>
          <div class="feedback-field feedback-field--full"><label :for="props.type + '-model'">{{ t('模型 / API', 'Model / API') }}</label><input :id="props.type + '-model'" v-model="fields.model" type="text" name="model" /></div>
        </div>
        <div class="feedback-field feedback-field--full"><label :for="props.type + '-steps'">{{ t('复现步骤', 'Steps to reproduce') }}</label><textarea :id="props.type + '-steps'" v-model="fields.steps" name="steps" rows="5" placeholder="1. …&#10;2. …&#10;3. …"></textarea></div>
        <div class="feedback-field-grid">
          <div class="feedback-field"><label :for="props.type + '-expected'">{{ t('期望结果', 'Expected result') }}</label><textarea :id="props.type + '-expected'" v-model="fields.expected" name="expected" rows="4"></textarea></div>
          <div class="feedback-field"><label :for="props.type + '-actual'">{{ t('实际结果', 'Actual result') }}</label><textarea :id="props.type + '-actual'" v-model="fields.actual" name="actual" rows="4"></textarea></div>
        </div>
        <div class="feedback-field-grid">
          <div class="feedback-field"><label :for="props.type + '-extra'">{{ t('补充信息', 'Additional information') }}</label><textarea :id="props.type + '-extra'" v-model="fields.extra" name="extra" rows="4"></textarea></div>
          <div class="feedback-field"><label :for="props.type + '-contact'">{{ t('联系方式', 'Contact') }}</label><input :id="props.type + '-contact'" v-model="fields.contact" type="text" name="contact" autocomplete="email" :placeholder="t('可选，用于跟进', 'Optional, for follow-up')"></div>
        </div>
      </template>

      <template v-else-if="props.type === 'feature'">
        <div class="feedback-field feedback-field--full">
          <label :for="props.type + '-problem'">{{ t('使用场景 / 当前问题', 'Use case / current problem') }} <span class="feedback-required">{{ t('必填', 'Required') }}</span></label>
          <textarea :id="props.type + '-problem'" v-model="fields.problem" name="problem" required rows="7" :placeholder="t('你在什么场景下遇到了什么阻碍？', 'What were you doing, and what prevented progress?')"></textarea>
        </div>
        <div class="feedback-field"><label :for="props.type + '-module'">{{ t('相关模块', 'Related module') }}</label><input :id="props.type + '-module'" v-model="fields.module" type="text" name="module" /></div>
        <div class="feedback-field feedback-field--full"><label :for="props.type + '-solution'">{{ t('希望如何改进', 'Suggested improvement') }}</label><textarea :id="props.type + '-solution'" v-model="fields.solution" name="solution" rows="5"></textarea></div>
        <div class="feedback-field-grid">
          <div class="feedback-field"><label :for="props.type + '-workaround'">{{ t('当前替代方案或工作流', 'Current workaround or workflow') }}</label><textarea :id="props.type + '-workaround'" v-model="fields.workaround" rows="5"></textarea></div>
          <div class="feedback-field"><label :for="props.type + '-extra'">{{ t('补充信息', 'Additional information') }}</label><textarea :id="props.type + '-extra'" v-model="fields.extra" name="extra" rows="5"></textarea></div>
          <div class="feedback-field"><label :for="props.type + '-contact'">{{ t('联系方式', 'Contact') }}</label><input :id="props.type + '-contact'" v-model="fields.contact" type="text" name="contact" autocomplete="email" :placeholder="t('可选，用于跟进', 'Optional, for follow-up')"></div>
        </div>
      </template>

      <template v-else>
        <div class="feedback-field feedback-field--full">
          <label :for="props.type + '-description'">{{ t('问题描述', 'Problem description') }} <span class="feedback-required">{{ t('必填', 'Required') }}</span></label>
          <textarea :id="props.type + '-description'" v-model="fields.description" name="description" required rows="7" :placeholder="t('哪一页、哪一段说明需要修正？', 'Which page and section need correction?')"></textarea>
        </div>
        <div class="feedback-field feedback-field--full"><label :for="props.type + '-page'">{{ t('文档页面', 'Documentation page') }}</label><input :id="props.type + '-page'" v-model="fields.page" type="text" name="page" :placeholder="t('页面地址或页面标题', 'Page URL or title')"></div>
        <div class="feedback-field feedback-field--full"><label :for="props.type + '-correction'">{{ t('建议修改', 'Suggested correction') }}</label><textarea :id="props.type + '-correction'" v-model="fields.correction" name="correction" rows="5"></textarea></div>
        <div class="feedback-field-grid">
          <div class="feedback-field"><label :for="props.type + '-extra'">{{ t('补充信息', 'Additional information') }}</label><textarea :id="props.type + '-extra'" v-model="fields.extra" name="extra" rows="4"></textarea></div>
          <div class="feedback-field"><label :for="props.type + '-contact'">{{ t('联系方式', 'Contact') }}</label><input :id="props.type + '-contact'" v-model="fields.contact" type="text" name="contact" autocomplete="email" :placeholder="t('可选，用于跟进', 'Optional, for follow-up')"></div>
        </div>
      </template>

      <div class="feedback-upload-section">
        <div class="feedback-upload-heading">
          <div>
            <h2>{{ t('附件', 'Attachments') }}</h2>
            <p>{{ t('支持截图粘贴、点击选择或拖拽上传。', 'Paste screenshots, choose files, or drag and drop.') }}</p>
          </div>
          <span>{{ attachmentSummary }}</span>
        </div>
        <div
          class="feedback-dropzone"
          :class="{ 'is-dragging': isDragging }"
          tabindex="0"
          @dragenter.prevent="isDragging = true"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
          @keydown.enter.prevent="openFilePicker"
          @keydown.space.prevent="openFilePicker"
        >
          <input ref="fileInput" class="feedback-file-input" type="file" multiple :accept="acceptedTypes" @change="handleFileInput" />
          <strong>{{ t('把文件拖到这里，或', 'Drop files here, or') }}</strong>
          <button class="feedback-upload-button" type="button" @click="openFilePicker">{{ t('选择文件', 'Choose files') }}</button>
          <p>{{ t('也可以先点击此区域，再直接粘贴截图。', 'You can also focus this area and paste a screenshot.') }}</p>
          <small>{{ t('最多 3 个附件；图片单个 ≤ 10MB，视频单个 ≤ 100MB，日志 / ZIP 等单个 ≤ 30MB，单次总附件约 145MB。', 'Up to 3 attachments. Images: 10 MB each; videos: 100 MB each; logs / ZIP and other files: 30 MB each. Total: about 145 MB.') }}</small>
          <small>{{ t('附件会由官方反馈系统临时保存，约 10 天后自动清理。', 'The official feedback system stores attachments temporarily and removes them automatically after about 10 days.') }}</small>
        </div>
        <ul v-if="attachments.length" class="feedback-file-list" :aria-label="t('已选择附件', 'Selected attachments')">
          <li v-for="(attachment, index) in attachments" :key="attachment.file.name + attachment.file.size + attachment.file.lastModified" class="feedback-file-item">
            <span class="feedback-file-icon" aria-hidden="true">{{ fileIcon(attachment.kind) }}</span>
            <span class="feedback-file-meta"><strong>{{ attachment.file.name }}</strong><small>{{ formatFileKind(attachment.kind) }} · {{ formatBytes(attachment.file.size) }}</small></span>
            <button type="button" class="feedback-file-remove" :aria-label="t(`删除附件 ${attachment.file.name}`, `Remove attachment ${attachment.file.name}`)" @click="removeAttachment(index)">{{ t('删除', 'Remove') }}</button>
          </li>
        </ul>
      </div>

      <div class="feedback-form-actions">
        <button class="feedback-submit-button" type="submit" :disabled="submitting">
          {{ submitting ? t('提交中…', 'Submitting…') : t('提交反馈', 'Submit feedback') }}
        </button>
        <span>{{ t('提交后不会跳转 GitHub。', 'You will not be redirected to GitHub.') }}</span>
      </div>
    </form>
  </section>
</template>
