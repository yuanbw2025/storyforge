import { hashCanonicalValue } from '../agent/run/hash'

export type CommunityPermissionV1 = 'community:moderate' | 'community:appeal-review' | 'community:lfg-operations'
export type CommunityAgeBandV1 = 'adult' | 'minor' | 'unknown'

export interface CommunityPrincipalV1 {
  userId: string
  permissions: CommunityPermissionV1[]
}

export interface CommunityProfileV1 {
  userId: string
  handle: string
  displayName: string
  bio: string
  locale: string
  timeZone: string
  ageBand: CommunityAgeBandV1
  status: 'active' | 'suspended'
  createdAt: number
  updatedAt: number
}

export interface CommunitySocialEdgeV1 {
  edgeId: string
  kind: 'follow-creator' | 'favorite-listing' | 'subscribe-listing'
  actorId: string
  targetId: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface CommunityReleaseLineageV1 {
  releaseHash: string
  creatorId: string
  parentReleaseHash: string | null
  licenseId: string
  attribution: string[]
  createdAt: number
}

export interface CommunityLfgPostV1 {
  postId: string
  creatorId: string
  releaseHash: string
  title: string
  summary: string
  locale: string
  timeZone: string
  startsAt: number
  durationMinutes: number
  playerCapacity: number
  waitlistCapacity: number
  audience: 'all-ages' | 'adult-only'
  safetyTags: string[]
  status: 'open' | 'closed' | 'cancelled'
  createdAt: number
  updatedAt: number
}

export interface CommunityLfgApplicationV1 {
  applicationId: string
  postId: string
  userId: string
  characterPreference: string
  note: string
  status: 'pending' | 'accepted' | 'waitlisted' | 'declined' | 'withdrawn'
  createdAt: number
  updatedAt: number
}

export interface CommunityLfgAttendanceV1 {
  attendanceId: string
  postId: string
  applicationId: string
  userId: string
  status: 'confirmed' | 'no-show' | 'replaced'
  replacementApplicationId: string | null
  markedBy: string
  createdAt: number
  updatedAt: number
}

export interface CommunityLfgParticipationV1 {
  post: CommunityLfgPostV1
  application: CommunityLfgApplicationV1
  attendance: CommunityLfgAttendanceV1 | null
}

export interface CommunityReviewV1 {
  reviewId: string
  authorId: string
  subjectType: 'release' | 'actual-play'
  releaseHash: string
  postId: string | null
  rating: 1 | 2 | 3 | 4 | 5
  title: string
  body: string
  tags: string[]
  containsSpoilers: boolean
  verification: 'entitlement' | 'attendance'
  status: 'published' | 'withdrawn' | 'removed'
  creatorResponse: string | null
  responseBy: string | null
  responseAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CommunityReviewAggregateV1 {
  subjectType: CommunityReviewV1['subjectType']
  releaseHash: string
  postId: string | null
  count: number
  average: number | null
  histogram: Record<'1' | '2' | '3' | '4' | '5', number>
  tagCounts: Array<{ tag: string; count: number }>
}

export interface CommunityReviewCapabilitiesV1 {
  ownReviewId: string | null
  respondableReviewIds: string[]
}

export interface CommunityReportV1 {
  reportId: string
  reporterId: string
  subjectType: 'profile' | 'listing' | 'lfg' | 'room' | 'review'
  subjectId: string
  category: 'harassment' | 'unsafe-content' | 'rights' | 'fraud' | 'minor-safety' | 'other'
  details: string
  status: 'open' | 'dismissed' | 'actioned' | 'appealed' | 'resolved'
  action: 'none' | 'warning' | 'suspend' | 'remove' | null
  reasonCode: string | null
  reviewedBy: string | null
  createdAt: number
  updatedAt: number
}

export interface CommunityAppealV1 {
  appealId: string
  reportId: string
  appellantId: string
  statement: string
  status: 'open' | 'upheld' | 'reversed'
  reviewedBy: string | null
  createdAt: number
  updatedAt: number
}

export interface CommunityReportViewV1 {
  reportId: string
  relation: 'reporter' | 'subject'
  subjectType: CommunityReportV1['subjectType']
  subjectId: string
  category: CommunityReportV1['category']
  /** Only the reporter receives the original free text; subjects receive the moderator reason code. */
  details: string | null
  status: CommunityReportV1['status']
  action: CommunityReportV1['action']
  reasonCode: string | null
  createdAt: number
  updatedAt: number
}

interface CommunityReceiptV1 { fingerprint: string; result: unknown }
export interface CommunityAuditEntryV1 {
  sequence: number
  kind: string
  actorId: string
  subjectId: string
  createdAt: number
}

export interface CommunityPlatformSnapshotV1 {
  schema: 'storyforge.community-platform-snapshot'
  version: 1
  revision: number
  profiles: CommunityProfileV1[]
  edges: CommunitySocialEdgeV1[]
  lineages: CommunityReleaseLineageV1[]
  lfgPosts: CommunityLfgPostV1[]
  lfgApplications: CommunityLfgApplicationV1[]
  lfgAttendance: CommunityLfgAttendanceV1[]
  reviews: CommunityReviewV1[]
  reports: CommunityReportV1[]
  appeals: CommunityAppealV1[]
  receipts: Array<[string, CommunityReceiptV1]>
  audits: CommunityAuditEntryV1[]
  updatedAt: number
  integrityHash: string
}

export interface CommunityPlatformPersistenceV1 {
  load(): Promise<CommunityPlatformSnapshotV1 | null>
  compareAndSwap(input: { expectedRevision: number | null; snapshot: CommunityPlatformSnapshotV1 }): Promise<boolean>
}

export interface CommunityReleasePolicyV1 {
  canHost(userId: string, releaseHash: string): Promise<boolean>
  canRegisterOriginal(userId: string, releaseHash: string): Promise<boolean>
  reviewEligibility?(userId: string, releaseHash: string): Promise<{ entitled: boolean; creator: boolean }>
  isReleaseCreator?(userId: string, releaseHash: string): Promise<boolean>
}

export class CommunityAuthorityErrorV1 extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[community-authority:${code}] ${message}`)
    this.name = 'CommunityAuthorityErrorV1'
  }
}

function fail(code: string, message: string): never { throw new CommunityAuthorityErrorV1(code, message) }
function clone<T>(value: T): T { return structuredClone(value) }
function key(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) || value.length > maximum) {
    fail('protocol', `${label} 无效`)
  }
  return value
}
function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail('protocol', `${label} 无效`)
  const result = value.trim().normalize('NFC')
  if ((!allowEmpty && !result) || result.length > maximum) fail('protocol', `${label} 无效`)
  return result
}
function sha(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!/^[0-9a-f]{64}$/.test(result)) fail('protocol', `${label} 必须是 sha256`)
  return result
}
function stringList(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail('protocol', `${label} 无效`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 500))
  if (new Set(result).size !== result.length) fail('protocol', `${label} 不能重复`)
  return result
}
function locale(value: unknown): string {
  const result = text(value, 'locale', 40)
  try { new Intl.Locale(result) } catch { fail('protocol', 'locale 无效') }
  return result
}
function timeZone(value: unknown): string {
  const result = text(value, 'timeZone', 100)
  try { new Intl.DateTimeFormat('en', { timeZone: result }).format(0) } catch { fail('protocol', 'timeZone 无效') }
  return result
}
function requirePermission(principal: CommunityPrincipalV1, permission: CommunityPermissionV1): void {
  if (!principal.permissions.includes(permission)) fail('forbidden', `缺少权限:${permission}`)
}

export async function verifyCommunityPlatformSnapshotV1(snapshot: CommunityPlatformSnapshotV1): Promise<void> {
  if (snapshot.schema !== 'storyforge.community-platform-snapshot' || snapshot.version !== 1
    || !Number.isInteger(snapshot.revision) || snapshot.revision < 1
    || !Array.isArray(snapshot.profiles) || !Array.isArray(snapshot.edges)
    || !Array.isArray(snapshot.lineages) || !Array.isArray(snapshot.lfgPosts)
    || !Array.isArray(snapshot.lfgApplications) || !Array.isArray(snapshot.lfgAttendance)
    || !Array.isArray(snapshot.reviews) || !Array.isArray(snapshot.reports)
    || !Array.isArray(snapshot.appeals) || !Array.isArray(snapshot.receipts) || !Array.isArray(snapshot.audits)) {
    fail('snapshot_invalid', '社区平台快照结构无效')
  }
  const { integrityHash, ...body } = snapshot
  if (await hashCanonicalValue(body) !== integrityHash) fail('snapshot_corrupt', '社区平台快照完整性校验失败')
}

export class CommunityPlatformAuthorityV1 {
  private revision = 0
  private readonly profiles = new Map<string, CommunityProfileV1>()
  private readonly edges = new Map<string, CommunitySocialEdgeV1>()
  private readonly lineages = new Map<string, CommunityReleaseLineageV1>()
  private readonly lfgPosts = new Map<string, CommunityLfgPostV1>()
  private readonly lfgApplications = new Map<string, CommunityLfgApplicationV1>()
  private readonly lfgAttendance = new Map<string, CommunityLfgAttendanceV1>()
  private readonly reviews = new Map<string, CommunityReviewV1>()
  private readonly reports = new Map<string, CommunityReportV1>()
  private readonly appeals = new Map<string, CommunityAppealV1>()
  private readonly receipts = new Map<string, CommunityReceiptV1>()
  private readonly audits: CommunityAuditEntryV1[] = []
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly persistence: CommunityPlatformPersistenceV1,
    private readonly releasePolicy: CommunityReleasePolicyV1,
    private readonly now: () => number,
  ) {}

  static async create(input: {
    persistence: CommunityPlatformPersistenceV1
    releasePolicy: CommunityReleasePolicyV1
    now?: () => number
  }): Promise<CommunityPlatformAuthorityV1> {
    const authority = new CommunityPlatformAuthorityV1(input.persistence, input.releasePolicy, input.now ?? (() => Date.now()))
    await authority.persist(null)
    return authority
  }

  static async restore(input: {
    persistence: CommunityPlatformPersistenceV1
    releasePolicy: CommunityReleasePolicyV1
    now?: () => number
  }): Promise<CommunityPlatformAuthorityV1> {
    const snapshot = await input.persistence.load()
    if (!snapshot) fail('snapshot_missing', '社区平台快照不存在')
    await verifyCommunityPlatformSnapshotV1(snapshot)
    const authority = new CommunityPlatformAuthorityV1(input.persistence, input.releasePolicy, input.now ?? (() => Date.now()))
    authority.restoreLocal(snapshot)
    return authority
  }

  upsertProfile(input: {
    principal: CommunityPrincipalV1
    requestId: string
    handle: string
    displayName: string
    bio: string
    locale: string
    timeZone: string
    ageBand: CommunityAgeBandV1
  }): Promise<CommunityProfileV1> {
    const userId = key(input.principal.userId, 'principal.userId')
    return this.command(userId, input.requestId, input, async () => {
      if (!['adult', 'minor', 'unknown'].includes(input.ageBand)) fail('protocol', 'ageBand 无效')
      const handle = key(text(input.handle, 'handle', 40).toLocaleLowerCase(), 'handle', 40)
      const duplicate = [...this.profiles.values()].find(profile => profile.handle === handle && profile.userId !== userId)
      if (duplicate) fail('handle_taken', '公开 handle 已被使用')
      const prior = this.profiles.get(userId)
      if (prior?.status === 'suspended') fail('account_suspended', '账号处于社区冻结状态')
      const updatedAt = this.now()
      const profile: CommunityProfileV1 = {
        userId, handle, displayName: text(input.displayName, 'displayName', 100),
        bio: text(input.bio, 'bio', 2_000, true), locale: locale(input.locale), timeZone: timeZone(input.timeZone),
        ageBand: input.ageBand, status: 'active', createdAt: prior?.createdAt ?? updatedAt, updatedAt,
      }
      this.profiles.set(userId, profile)
      this.audit(prior ? 'profile.updated' : 'profile.created', userId, userId)
      return clone(profile)
    })
  }

  setSocialEdge(input: {
    principal: CommunityPrincipalV1
    requestId: string
    kind: CommunitySocialEdgeV1['kind']
    targetId: string
    active: boolean
  }): Promise<CommunitySocialEdgeV1> {
    const actorId = this.activePrincipal(input.principal)
    return this.command(actorId, input.requestId, input, async () => {
      if (!['follow-creator', 'favorite-listing', 'subscribe-listing'].includes(input.kind)
        || typeof input.active !== 'boolean') fail('protocol', '社区关系命令无效')
      const targetId = key(input.targetId, 'targetId')
      if (input.kind === 'follow-creator' && targetId === actorId) fail('self_edge', '不能关注自己')
      const edgeId = `edge.${input.kind}.${actorId}.${targetId}`
      const prior = this.edges.get(edgeId)
      const updatedAt = this.now()
      const edge: CommunitySocialEdgeV1 = {
        edgeId, kind: input.kind, actorId, targetId, active: input.active,
        createdAt: prior?.createdAt ?? updatedAt, updatedAt,
      }
      this.edges.set(edgeId, edge)
      this.audit(`social.${input.kind}.${input.active ? 'enabled' : 'disabled'}`, actorId, targetId)
      return clone(edge)
    })
  }

  registerReleaseLineage(input: {
    principal: CommunityPrincipalV1
    requestId: string
    releaseHash: string
    parentReleaseHash?: string | null
    licenseId: string
    attribution: string[]
    remixAuthorization?: {
      sourceReleaseHash: string
      licenseId: string
      attributionRequired: boolean
    } | null
  }): Promise<CommunityReleaseLineageV1> {
    const creatorId = this.activePrincipal(input.principal)
    return this.command(creatorId, input.requestId, input, async () => {
      const releaseHash = sha(input.releaseHash, 'releaseHash')
      if (this.lineages.has(releaseHash)) fail('lineage_exists', '该 Release 已登记来源')
      if (!await this.releasePolicy.canRegisterOriginal(creatorId, releaseHash)) fail('release_forbidden', '无权登记该 Release')
      const parentReleaseHash = input.parentReleaseHash == null ? null : sha(input.parentReleaseHash, 'parentReleaseHash')
      if (parentReleaseHash === releaseHash) fail('lineage_cycle', 'Release 不能派生自自身')
      const licenseId = key(input.licenseId, 'licenseId')
      const attribution = stringList(input.attribution, 'attribution', 50)
      if (parentReleaseHash) {
        const parent = this.lineages.get(parentReleaseHash)
        const authorization = input.remixAuthorization
        if (!parent || !authorization || authorization.sourceReleaseHash !== parentReleaseHash
          || authorization.licenseId !== licenseId || (authorization.attributionRequired && !attribution.length)) {
          fail('remix_forbidden', '派生 Release 缺少匹配许可或署名授权')
        }
        let cursor: CommunityReleaseLineageV1 | undefined = parent
        while (cursor) {
          if (cursor.parentReleaseHash === releaseHash) fail('lineage_cycle', 'Release 来源图形成循环')
          cursor = cursor.parentReleaseHash ? this.lineages.get(cursor.parentReleaseHash) : undefined
        }
      }
      const lineage: CommunityReleaseLineageV1 = {
        releaseHash, creatorId, parentReleaseHash, licenseId, attribution, createdAt: this.now(),
      }
      this.lineages.set(releaseHash, lineage)
      this.audit(parentReleaseHash ? 'release.remixed' : 'release.registered', creatorId, releaseHash)
      return clone(lineage)
    })
  }

  createLfgPost(input: {
    principal: CommunityPrincipalV1
    requestId: string
    releaseHash: string
    title: string
    summary: string
    locale: string
    timeZone: string
    startsAt: number
    durationMinutes: number
    playerCapacity: number
    waitlistCapacity: number
    audience: CommunityLfgPostV1['audience']
    safetyTags: string[]
  }): Promise<CommunityLfgPostV1> {
    const creatorId = this.activePrincipal(input.principal)
    return this.command(creatorId, input.requestId, input, async () => {
      const releaseHash = sha(input.releaseHash, 'releaseHash')
      if (!await this.releasePolicy.canHost(creatorId, releaseHash)) fail('entitlement_required', '没有主持该 Release 的有效权益')
      if (!Number.isInteger(input.startsAt) || input.startsAt <= this.now()) fail('protocol', 'startsAt 必须是未来时间')
      if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 30 || input.durationMinutes > 1_440
        || !Number.isInteger(input.playerCapacity) || input.playerCapacity < 1 || input.playerCapacity > 20
        || !Number.isInteger(input.waitlistCapacity) || input.waitlistCapacity < 0 || input.waitlistCapacity > 100
        || !['all-ages', 'adult-only'].includes(input.audience)) fail('protocol', '招募容量、时长或受众无效')
      const createdAt = this.now()
      const post: CommunityLfgPostV1 = {
        postId: `lfg.${crypto.randomUUID()}`, creatorId, releaseHash,
        title: text(input.title, 'title', 200), summary: text(input.summary, 'summary', 4_000),
        locale: locale(input.locale), timeZone: timeZone(input.timeZone), startsAt: input.startsAt,
        durationMinutes: input.durationMinutes, playerCapacity: input.playerCapacity,
        waitlistCapacity: input.waitlistCapacity, audience: input.audience,
        safetyTags: stringList(input.safetyTags, 'safetyTags', 50), status: 'open', createdAt, updatedAt: createdAt,
      }
      this.lfgPosts.set(post.postId, post)
      this.audit('lfg.created', creatorId, post.postId)
      return clone(post)
    })
  }

  applyToLfg(input: {
    principal: CommunityPrincipalV1
    requestId: string
    postId: string
    characterPreference: string
    note: string
  }): Promise<CommunityLfgApplicationV1> {
    const userId = this.activePrincipal(input.principal)
    return this.command(userId, input.requestId, input, async () => {
      const post = this.requirePost(input.postId)
      if (post.status !== 'open' || post.startsAt <= this.now()) fail('lfg_closed', '招募已经关闭或开始')
      if (post.creatorId === userId) fail('self_application', '主持人不能申请自己的招募')
      const profile = this.requireProfile(userId)
      if (post.audience === 'adult-only' && profile.ageBand !== 'adult') fail('age_restricted', '该招募仅面向已确认成年用户')
      const existing = [...this.lfgApplications.values()].find(row => row.postId === post.postId && row.userId === userId
        && !['declined', 'withdrawn'].includes(row.status))
      if (existing) fail('application_exists', '该账号已有有效申请')
      const createdAt = this.now()
      const application: CommunityLfgApplicationV1 = {
        applicationId: `application.${crypto.randomUUID()}`, postId: post.postId, userId,
        characterPreference: text(input.characterPreference, 'characterPreference', 300, true),
        note: text(input.note, 'note', 2_000, true), status: 'pending', createdAt, updatedAt: createdAt,
      }
      this.lfgApplications.set(application.applicationId, application)
      this.audit('lfg.applied', userId, post.postId)
      return clone(application)
    })
  }

  decideLfgApplication(input: {
    principal: CommunityPrincipalV1
    requestId: string
    applicationId: string
    decision: 'accept' | 'decline'
  }): Promise<CommunityLfgApplicationV1> {
    const actorId = this.activePrincipal(input.principal)
    return this.command(actorId, input.requestId, input, async () => {
      const application = this.requireApplication(input.applicationId)
      const post = this.requirePost(application.postId)
      if (post.creatorId !== actorId) fail('forbidden', '只有招募主持人可以处理申请')
      if (post.status !== 'open' || application.status !== 'pending') fail('invalid_transition', '申请当前不能处理')
      if (input.decision === 'decline') application.status = 'declined'
      else {
        const rows = [...this.lfgApplications.values()].filter(row => row.postId === post.postId)
        const accepted = rows.filter(row => row.status === 'accepted').length
        const waitlisted = rows.filter(row => row.status === 'waitlisted').length
        if (accepted < post.playerCapacity) application.status = 'accepted'
        else if (waitlisted < post.waitlistCapacity) application.status = 'waitlisted'
        else fail('lfg_full', '席位和候补均已满')
      }
      application.updatedAt = this.now()
      this.audit(`lfg.application.${application.status}`, actorId, application.applicationId)
      return clone(application)
    })
  }

  closeLfgPost(input: {
    principal: CommunityPrincipalV1
    requestId: string
    postId: string
    status: 'closed' | 'cancelled'
  }): Promise<CommunityLfgPostV1> {
    const actorId = this.activePrincipal(input.principal)
    return this.command(actorId, input.requestId, input, async () => {
      const post = this.requirePost(input.postId)
      if (post.creatorId !== actorId) fail('forbidden', '只有主持人可以关闭招募')
      if (post.status !== 'open') fail('invalid_transition', '招募已经结束')
      post.status = input.status
      post.updatedAt = this.now()
      if (input.status === 'cancelled') {
        for (const application of this.lfgApplications.values()) {
          if (application.postId === post.postId && ['pending', 'accepted', 'waitlisted'].includes(application.status)) {
            application.status = 'withdrawn'
            application.updatedAt = this.now()
          }
        }
      }
      this.audit(`lfg.${input.status}`, actorId, post.postId)
      return clone(post)
    })
  }

  markLfgAttendance(input: {
    principal: CommunityPrincipalV1
    requestId: string
    applicationId: string
    status: 'confirmed' | 'no-show'
  }): Promise<CommunityLfgAttendanceV1> {
    const actorId = this.activePrincipal(input.principal)
    return this.command(actorId, input.requestId, input, async () => {
      const application = this.requireApplication(input.applicationId)
      const post = this.requirePost(application.postId)
      if (post.creatorId !== actorId && !input.principal.permissions.includes('community:lfg-operations')) {
        fail('forbidden', '只有主持人或组队运营可以登记出席')
      }
      if (application.status !== 'accepted' || !['confirmed', 'no-show'].includes(input.status)) {
        fail('invalid_transition', '只有已接受成员可以登记出席')
      }
      const attendanceId = `attendance.${application.applicationId}`
      const prior = this.lfgAttendance.get(attendanceId)
      if (prior?.status === 'replaced') fail('invalid_transition', '已完成替补的缺席记录不能修改')
      const updatedAt = this.now()
      const attendance: CommunityLfgAttendanceV1 = {
        attendanceId, postId: post.postId, applicationId: application.applicationId,
        userId: application.userId, status: input.status, replacementApplicationId: null,
        markedBy: actorId, createdAt: prior?.createdAt ?? updatedAt, updatedAt,
      }
      this.lfgAttendance.set(attendanceId, attendance)
      this.audit(`lfg.attendance.${input.status}`, actorId, application.applicationId)
      return clone(attendance)
    })
  }

  promoteLfgWaitlist(input: {
    principal: CommunityPrincipalV1
    requestId: string
    absentApplicationId: string
    replacementApplicationId: string
  }): Promise<{ absent: CommunityLfgApplicationV1; replacement: CommunityLfgApplicationV1; attendance: CommunityLfgAttendanceV1 }> {
    const actorId = this.activePrincipal(input.principal)
    return this.command(actorId, input.requestId, input, async () => {
      const absent = this.requireApplication(input.absentApplicationId)
      const replacement = this.requireApplication(input.replacementApplicationId)
      if (absent.postId !== replacement.postId) fail('replacement_invalid', '替补必须来自同一招募')
      const post = this.requirePost(absent.postId)
      if (post.creatorId !== actorId && !input.principal.permissions.includes('community:lfg-operations')) {
        fail('forbidden', '只有主持人或组队运营可以安排替补')
      }
      const attendance = this.lfgAttendance.get(`attendance.${absent.applicationId}`)
      if (absent.status !== 'accepted' || replacement.status !== 'waitlisted' || attendance?.status !== 'no-show') {
        fail('replacement_invalid', '只有已登记缺席的正式成员可以由候补替换')
      }
      absent.status = 'withdrawn'
      absent.updatedAt = this.now()
      replacement.status = 'accepted'
      replacement.updatedAt = this.now()
      attendance.status = 'replaced'
      attendance.replacementApplicationId = replacement.applicationId
      attendance.updatedAt = this.now()
      this.audit('lfg.waitlist.promoted', actorId, replacement.applicationId)
      return { absent: clone(absent), replacement: clone(replacement), attendance: clone(attendance) }
    })
  }

  upsertReview(input: {
    principal: CommunityPrincipalV1
    requestId: string
    subjectType: CommunityReviewV1['subjectType']
    releaseHash: string
    postId?: string | null
    rating: number
    title: string
    body: string
    tags: string[]
    containsSpoilers: boolean
  }): Promise<CommunityReviewV1> {
    const authorId = this.activePrincipal(input.principal)
    return this.command(authorId, input.requestId, input, async () => {
      if (!['release', 'actual-play'].includes(input.subjectType)
        || !Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5
        || typeof input.containsSpoilers !== 'boolean') fail('protocol', '评价类型、星级或剧透标记无效')
      const releaseHash = sha(input.releaseHash, 'releaseHash')
      const postId = input.postId == null ? null : key(input.postId, 'postId')
      let verification: CommunityReviewV1['verification']
      let subjectKey: string
      if (input.subjectType === 'release') {
        if (postId != null) fail('protocol', '发行评价不能绑定场次')
        const eligibility = await this.releasePolicy.reviewEligibility?.(authorId, releaseHash)
        const lineageCreator = this.lineages.get(releaseHash)?.creatorId === authorId
        if (!eligibility?.entitled) fail('review_eligibility_required', '只有已验证拥有该 Release 的账号可以评价')
        if (eligibility.creator || lineageCreator) fail('self_review', '创作者不能评价自己的 Release')
        verification = 'entitlement'
        subjectKey = releaseHash
      } else {
        if (!postId) fail('protocol', '实际参团评价必须绑定场次')
        const post = this.requirePost(postId)
        if (post.releaseHash !== releaseHash || post.status !== 'closed' || this.now() < post.startsAt) {
          fail('review_eligibility_required', '场次尚未正常结束或与 Release 不匹配')
        }
        const application = [...this.lfgApplications.values()].find(row => row.postId === postId
          && row.userId === authorId && row.status === 'accepted')
        const attendance = application ? this.lfgAttendance.get(`attendance.${application.applicationId}`) : null
        if (!application || attendance?.status !== 'confirmed') {
          fail('review_eligibility_required', '只有已验证出席的正式成员可以评价场次')
        }
        verification = 'attendance'
        subjectKey = postId
      }
      const reviewId = `review.${input.subjectType}.${authorId}.${subjectKey}`
      const prior = this.reviews.get(reviewId)
      if (prior?.status === 'removed') fail('review_removed', '被治理移除的评价不能直接重发')
      const updatedAt = this.now()
      const review: CommunityReviewV1 = {
        reviewId, authorId, subjectType: input.subjectType, releaseHash, postId,
        rating: input.rating as CommunityReviewV1['rating'], title: text(input.title, 'title', 200),
        body: text(input.body, 'body', 4_000), tags: stringList(input.tags, 'tags', 20),
        containsSpoilers: input.containsSpoilers, verification, status: 'published',
        creatorResponse: prior?.creatorResponse ?? null, responseBy: prior?.responseBy ?? null,
        responseAt: prior?.responseAt ?? null, createdAt: prior?.createdAt ?? updatedAt, updatedAt,
      }
      this.reviews.set(reviewId, review)
      this.audit(prior ? 'review.updated' : 'review.created', authorId, reviewId)
      return clone(review)
    })
  }

  withdrawReview(input: {
    principal: CommunityPrincipalV1
    requestId: string
    reviewId: string
  }): Promise<CommunityReviewV1> {
    const authorId = this.activePrincipal(input.principal)
    return this.command(authorId, input.requestId, input, async () => {
      const review = this.requireReview(input.reviewId)
      if (review.authorId !== authorId) fail('forbidden', '只能撤回自己的评价')
      if (review.status !== 'published') fail('invalid_transition', '评价当前不能撤回')
      review.status = 'withdrawn'
      review.updatedAt = this.now()
      this.audit('review.withdrawn', authorId, review.reviewId)
      return clone(review)
    })
  }

  respondToReview(input: {
    principal: CommunityPrincipalV1
    requestId: string
    reviewId: string
    response: string
  }): Promise<CommunityReviewV1> {
    const responderId = this.activePrincipal(input.principal)
    return this.command(responderId, input.requestId, input, async () => {
      const review = this.requireReview(input.reviewId)
      if (review.status !== 'published') fail('invalid_transition', '评价当前不能回应')
      const isCreator = review.subjectType === 'actual-play'
        ? this.requirePost(review.postId!).creatorId === responderId
        : this.lineages.get(review.releaseHash)?.creatorId === responderId
          || await this.releasePolicy.isReleaseCreator?.(responderId, review.releaseHash) === true
      if (!isCreator) fail('forbidden', '只有发行创作者或场次主持人可以公开回应')
      review.creatorResponse = text(input.response, 'response', 2_000)
      review.responseBy = responderId
      review.responseAt = this.now()
      review.updatedAt = review.responseAt
      this.audit('review.responded', responderId, review.reviewId)
      return clone(review)
    })
  }

  reviewsFor(input: {
    subjectType: CommunityReviewV1['subjectType']
    releaseHash: string
    postId?: string | null
  }): { reviews: CommunityReviewV1[]; aggregate: CommunityReviewAggregateV1 } {
    if (!['release', 'actual-play'].includes(input.subjectType)) fail('protocol', '评价类型无效')
    const releaseHash = sha(input.releaseHash, 'releaseHash')
    const postId = input.postId == null ? null : key(input.postId, 'postId')
    if ((input.subjectType === 'release' && postId != null) || (input.subjectType === 'actual-play' && postId == null)) {
      fail('protocol', '评价目标无效')
    }
    const reviews = [...this.reviews.values()].filter(review => review.status === 'published'
      && review.subjectType === input.subjectType && review.releaseHash === releaseHash
      && review.postId === postId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.reviewId.localeCompare(right.reviewId))
      .map(clone)
    const histogram: CommunityReviewAggregateV1['histogram'] = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }
    const tagCounts = new Map<string, number>()
    for (const review of reviews) {
      histogram[String(review.rating) as keyof typeof histogram] += 1
      for (const tag of review.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
    return {
      reviews,
      aggregate: {
        subjectType: input.subjectType, releaseHash, postId, count: reviews.length,
        average: reviews.length
          ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 100) / 100
          : null,
        histogram,
        tagCounts: [...tagCounts].map(([tag, count]) => ({ tag, count }))
          .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
      },
    }
  }

  async reviewCapabilities(input: {
    principal: CommunityPrincipalV1
    subjectType: CommunityReviewV1['subjectType']
    releaseHash: string
    postId?: string | null
  }): Promise<CommunityReviewCapabilitiesV1> {
    const userId = this.activePrincipal(input.principal)
    const collection = this.reviewsFor(input)
    const canRespond = input.subjectType === 'actual-play'
      ? this.requirePost(input.postId!).creatorId === userId
      : this.lineages.get(sha(input.releaseHash, 'releaseHash'))?.creatorId === userId
        || await this.releasePolicy.isReleaseCreator?.(userId, input.releaseHash) === true
    return {
      ownReviewId: collection.reviews.find(review => review.authorId === userId)?.reviewId ?? null,
      respondableReviewIds: canRespond ? collection.reviews.map(review => review.reviewId) : [],
    }
  }

  reportsForPrincipal(input: { principal: CommunityPrincipalV1 }): CommunityReportViewV1[] {
    const userId = key(input.principal.userId, 'principal.userId')
    this.requireProfile(userId)
    return [...this.reports.values()].flatMap(report => {
      const authoredReview = report.subjectType === 'review' ? this.reviews.get(report.subjectId) : null
      const relation = report.reporterId === userId ? 'reporter' as const
        : report.subjectType === 'profile' && report.subjectId === userId ? 'subject' as const
          : authoredReview?.authorId === userId ? 'subject' as const : null
      if (!relation) return []
      return [{
        reportId: report.reportId, relation, subjectType: report.subjectType, subjectId: report.subjectId,
        category: report.category, details: relation === 'reporter' ? report.details : null,
        status: report.status, action: report.action, reasonCode: report.reasonCode,
        createdAt: report.createdAt, updatedAt: report.updatedAt,
      }]
    }).sort((left, right) => right.updatedAt - left.updatedAt || left.reportId.localeCompare(right.reportId))
  }

  appealsForPrincipal(input: { principal: CommunityPrincipalV1 }): CommunityAppealV1[] {
    const userId = key(input.principal.userId, 'principal.userId')
    this.requireProfile(userId)
    return [...this.appeals.values()].filter(appeal => appeal.appellantId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.appealId.localeCompare(right.appealId))
      .map(clone)
  }

  createReport(input: {
    principal: CommunityPrincipalV1
    requestId: string
    subjectType: CommunityReportV1['subjectType']
    subjectId: string
    category: CommunityReportV1['category']
    details: string
  }): Promise<CommunityReportV1> {
    const reporterId = this.activePrincipal(input.principal)
    return this.command(reporterId, input.requestId, input, async () => {
      if (!['profile', 'listing', 'lfg', 'room', 'review'].includes(input.subjectType)
        || !['harassment', 'unsafe-content', 'rights', 'fraud', 'minor-safety', 'other'].includes(input.category)) {
        fail('protocol', '举报类型无效')
      }
      const createdAt = this.now()
      const report: CommunityReportV1 = {
        reportId: `report.${crypto.randomUUID()}`, reporterId,
        subjectType: input.subjectType, subjectId: key(input.subjectId, 'subjectId'),
        category: input.category, details: text(input.details, 'details', 4_000),
        status: 'open', action: null, reasonCode: null, reviewedBy: null, createdAt, updatedAt: createdAt,
      }
      this.reports.set(report.reportId, report)
      this.audit('report.created', reporterId, report.reportId)
      return clone(report)
    })
  }

  decideReport(input: {
    principal: CommunityPrincipalV1
    requestId: string
    reportId: string
    action: Exclude<NonNullable<CommunityReportV1['action']>, 'none'> | 'none'
    reasonCode: string
  }): Promise<CommunityReportV1> {
    const moderatorId = key(input.principal.userId, 'principal.userId')
    return this.command(moderatorId, input.requestId, input, async () => {
      requirePermission(input.principal, 'community:moderate')
      const report = this.requireReport(input.reportId)
      if (report.status !== 'open') fail('invalid_transition', '举报当前不能裁决')
      if (!['none', 'warning', 'suspend', 'remove'].includes(input.action)) fail('protocol', '治理 action 无效')
      report.action = input.action
      report.reasonCode = key(input.reasonCode, 'reasonCode')
      report.reviewedBy = moderatorId
      report.status = input.action === 'none' ? 'dismissed' : 'actioned'
      report.updatedAt = this.now()
      if (input.action === 'suspend' && report.subjectType === 'profile') {
        const profile = this.profiles.get(report.subjectId)
        if (profile) { profile.status = 'suspended'; profile.updatedAt = this.now() }
      }
      if (input.action === 'remove' && report.subjectType === 'review') {
        const review = this.reviews.get(report.subjectId)
        if (review) { review.status = 'removed'; review.updatedAt = this.now() }
      }
      this.audit(`report.${report.status}`, moderatorId, report.reportId)
      return clone(report)
    })
  }

  appealReport(input: {
    principal: CommunityPrincipalV1
    requestId: string
    reportId: string
    statement: string
  }): Promise<CommunityAppealV1> {
    const appellantId = key(input.principal.userId, 'principal.userId')
    return this.command(appellantId, input.requestId, input, async () => {
      const report = this.requireReport(input.reportId)
      const appealedReview = report.subjectType === 'review' ? this.reviews.get(report.subjectId) : null
      if (report.status !== 'actioned'
        || (report.subjectType === 'profile' ? report.subjectId !== appellantId : appealedReview?.authorId !== appellantId)) {
        fail('appeal_forbidden', '该账号不能申诉这项治理裁决')
      }
      if ([...this.appeals.values()].some(appeal => appeal.reportId === report.reportId && appeal.status === 'open')) {
        fail('appeal_exists', '已有待处理申诉')
      }
      const createdAt = this.now()
      const appeal: CommunityAppealV1 = {
        appealId: `appeal.${crypto.randomUUID()}`, reportId: report.reportId, appellantId,
        statement: text(input.statement, 'statement', 4_000), status: 'open', reviewedBy: null,
        createdAt, updatedAt: createdAt,
      }
      this.appeals.set(appeal.appealId, appeal)
      report.status = 'appealed'
      report.updatedAt = this.now()
      this.audit('appeal.created', appellantId, appeal.appealId)
      return clone(appeal)
    })
  }

  resolveAppeal(input: {
    principal: CommunityPrincipalV1
    requestId: string
    appealId: string
    decision: 'uphold' | 'reverse'
  }): Promise<CommunityAppealV1> {
    const reviewerId = key(input.principal.userId, 'principal.userId')
    return this.command(reviewerId, input.requestId, input, async () => {
      requirePermission(input.principal, 'community:appeal-review')
      const appeal = this.appeals.get(key(input.appealId, 'appealId'))
      if (!appeal || appeal.status !== 'open') fail('invalid_transition', '申诉不存在或已处理')
      const report = this.requireReport(appeal.reportId)
      appeal.status = input.decision === 'uphold' ? 'upheld' : 'reversed'
      appeal.reviewedBy = reviewerId
      appeal.updatedAt = this.now()
      report.status = 'resolved'
      report.updatedAt = this.now()
      if (appeal.status === 'reversed' && report.action === 'suspend' && report.subjectType === 'profile') {
        const profile = this.profiles.get(report.subjectId)
        if (profile) { profile.status = 'active'; profile.updatedAt = this.now() }
      }
      if (appeal.status === 'reversed' && report.action === 'remove' && report.subjectType === 'review') {
        const review = this.reviews.get(report.subjectId)
        if (review) { review.status = 'published'; review.updatedAt = this.now() }
      }
      this.audit(`appeal.${appeal.status}`, reviewerId, appeal.appealId)
      return clone(appeal)
    })
  }

  discoverLfg(input: { locale?: string; releaseHash?: string; includeFull?: boolean } = {}): Array<{
    post: CommunityLfgPostV1
    accepted: number
    waitlisted: number
    availableSeats: number
  }> {
    const releaseHash = input.releaseHash == null ? null : sha(input.releaseHash, 'releaseHash')
    return [...this.lfgPosts.values()].filter(post => post.status === 'open' && post.startsAt > this.now())
      .filter(post => !input.locale || post.locale === locale(input.locale))
      .filter(post => !releaseHash || post.releaseHash === releaseHash)
      .map(post => {
        const applications = [...this.lfgApplications.values()].filter(row => row.postId === post.postId)
        const accepted = applications.filter(row => row.status === 'accepted').length
        const waitlisted = applications.filter(row => row.status === 'waitlisted').length
        return { post: clone(post), accepted, waitlisted, availableSeats: Math.max(0, post.playerCapacity - accepted) }
      }).filter(row => input.includeFull || row.availableSeats > 0)
      .sort((left, right) => left.post.startsAt - right.post.startsAt || left.post.postId.localeCompare(right.post.postId))
  }

  profile(userId: string): CommunityProfileV1 | null { return clone(this.profiles.get(key(userId, 'userId')) ?? null) }
  socialEdges(actorId: string): CommunitySocialEdgeV1[] {
    const id = key(actorId, 'actorId')
    return [...this.edges.values()].filter(edge => edge.actorId === id && edge.active).map(clone)
  }
  lineage(releaseHash: string): CommunityReleaseLineageV1 | null {
    return clone(this.lineages.get(sha(releaseHash, 'releaseHash')) ?? null)
  }
  applicationsForPost(input: { principal: CommunityPrincipalV1; postId: string }): CommunityLfgApplicationV1[] {
    const actorId = this.activePrincipal(input.principal)
    const post = this.requirePost(input.postId)
    if (post.creatorId !== actorId && !input.principal.permissions.includes('community:lfg-operations')) {
      fail('forbidden', '只有主持人或组队运营可以查看完整申请')
    }
    return [...this.lfgApplications.values()]
      .filter(row => row.postId === post.postId)
      .sort((left, right) => left.createdAt - right.createdAt || left.applicationId.localeCompare(right.applicationId))
      .map(clone)
  }
  applicationsForUser(input: { principal: CommunityPrincipalV1 }): CommunityLfgApplicationV1[] {
    const userId = this.activePrincipal(input.principal)
    return [...this.lfgApplications.values()]
      .filter(row => row.userId === userId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.applicationId.localeCompare(right.applicationId))
      .map(clone)
  }
  participationForUser(input: { principal: CommunityPrincipalV1 }): CommunityLfgParticipationV1[] {
    const userId = this.activePrincipal(input.principal)
    return [...this.lfgApplications.values()].filter(application => application.userId === userId)
      .map(application => ({
        post: clone(this.requirePost(application.postId)), application: clone(application),
        attendance: clone(this.lfgAttendance.get(`attendance.${application.applicationId}`) ?? null),
      }))
      .sort((left, right) => right.post.startsAt - left.post.startsAt
        || left.application.applicationId.localeCompare(right.application.applicationId))
  }
  attendanceForPost(input: { principal: CommunityPrincipalV1; postId: string }): CommunityLfgAttendanceV1[] {
    const actorId = this.activePrincipal(input.principal)
    const post = this.requirePost(input.postId)
    if (post.creatorId !== actorId && !input.principal.permissions.includes('community:lfg-operations')) {
      fail('forbidden', '只有主持人或组队运营可以查看出席记录')
    }
    return [...this.lfgAttendance.values()].filter(row => row.postId === post.postId).map(clone)
  }
  authorizeRoomHandoffForHost(input: {
    principal: CommunityPrincipalV1
    postId: string
    releaseHash: string
  }): { post: CommunityLfgPostV1; acceptedApplications: CommunityLfgApplicationV1[] } {
    const actorId = this.activePrincipal(input.principal)
    const post = this.requirePost(input.postId)
    if (post.creatorId !== actorId) fail('forbidden', '只有招募主持人可以绑定在线房间')
    if (post.status === 'cancelled' || post.releaseHash !== sha(input.releaseHash, 'releaseHash')) {
      fail('invalid_transition', '招募已取消或房间 Release 不匹配')
    }
    return {
      post: clone(post),
      acceptedApplications: [...this.lfgApplications.values()]
        .filter(row => row.postId === post.postId && row.status === 'accepted')
        .map(clone),
    }
  }
  authorizeRoomHandoffForApplicant(input: {
    principal: CommunityPrincipalV1
    applicationId: string
  }): { post: CommunityLfgPostV1; application: CommunityLfgApplicationV1; profile: CommunityProfileV1 } {
    const userId = this.activePrincipal(input.principal)
    const application = this.requireApplication(input.applicationId)
    if (application.userId !== userId || application.status !== 'accepted') {
      fail('forbidden', '只有已接受的申请人可以领取房间交接')
    }
    const post = this.requirePost(application.postId)
    if (post.status === 'cancelled') fail('invalid_transition', '招募已经取消')
    return { post: clone(post), application: clone(application), profile: clone(this.requireProfile(userId)) }
  }
  auditLog(): CommunityAuditEntryV1[] { return this.audits.map(clone) }

  private activePrincipal(principal: CommunityPrincipalV1): string {
    const userId = key(principal.userId, 'principal.userId')
    if (this.requireProfile(userId).status !== 'active') fail('account_suspended', '账号处于社区冻结状态')
    return userId
  }
  private requireProfile(userId: string): CommunityProfileV1 {
    const profile = this.profiles.get(key(userId, 'userId'))
    if (!profile) fail('profile_required', '需要先建立社区资料')
    return profile
  }
  private requirePost(postId: string): CommunityLfgPostV1 {
    const post = this.lfgPosts.get(key(postId, 'postId'))
    if (!post) fail('lfg_not_found', '招募不存在')
    return post
  }
  private requireApplication(applicationId: string): CommunityLfgApplicationV1 {
    const application = this.lfgApplications.get(key(applicationId, 'applicationId'))
    if (!application) fail('application_not_found', '招募申请不存在')
    return application
  }
  private requireReport(reportId: string): CommunityReportV1 {
    const report = this.reports.get(key(reportId, 'reportId'))
    if (!report) fail('report_not_found', '举报不存在')
    return report
  }
  private requireReview(reviewId: string): CommunityReviewV1 {
    const review = this.reviews.get(key(reviewId, 'reviewId', 500))
    if (!review) fail('review_not_found', '评价不存在')
    return review
  }
  private audit(kind: string, actorId: string, subjectId: string): void {
    this.audits.push({ sequence: this.audits.length + 1, kind, actorId, subjectId, createdAt: this.now() })
  }
  private async command<T>(actorId: string, requestIdValue: string, body: unknown, operation: () => Promise<T>): Promise<T> {
    const requestId = key(requestIdValue, 'requestId')
    return this.mutate(async () => {
      const receiptKey = `${actorId}\u0000${requestId}`
      const fingerprint = await hashCanonicalValue({ actorId, requestId, body })
      const prior = this.receipts.get(receiptKey)
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('request_conflict', 'requestId 已被不同命令使用')
        return clone(prior.result) as T
      }
      const result = await operation()
      this.receipts.set(receiptKey, { fingerprint, result: clone(result) })
      return result
    })
  }
  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void
    const previous = this.mutationTail
    this.mutationTail = new Promise(resolve => { release = resolve })
    await previous
    const backup = await this.snapshot(this.revision)
    try {
      const result = await operation()
      await this.persist(this.revision)
      return result
    } catch (error) {
      this.restoreLocal(backup)
      throw error
    } finally { release() }
  }
  private async persist(expectedRevision: number | null): Promise<void> {
    const revision = expectedRevision == null ? 1 : expectedRevision + 1
    const snapshot = await this.snapshot(revision)
    if (!await this.persistence.compareAndSwap({ expectedRevision, snapshot })) fail('persistence_conflict', '社区平台持久化版本冲突')
    this.revision = revision
  }
  private async snapshot(revision: number): Promise<CommunityPlatformSnapshotV1> {
    const body: Omit<CommunityPlatformSnapshotV1, 'integrityHash'> = {
      schema: 'storyforge.community-platform-snapshot', version: 1, revision,
      profiles: [...this.profiles.values()].map(clone), edges: [...this.edges.values()].map(clone),
      lineages: [...this.lineages.values()].map(clone), lfgPosts: [...this.lfgPosts.values()].map(clone),
      lfgApplications: [...this.lfgApplications.values()].map(clone), lfgAttendance: [...this.lfgAttendance.values()].map(clone),
      reviews: [...this.reviews.values()].map(clone),
      reports: [...this.reports.values()].map(clone),
      appeals: [...this.appeals.values()].map(clone), receipts: clone([...this.receipts]), audits: this.audits.map(clone),
      updatedAt: this.now(),
    }
    return { ...body, integrityHash: await hashCanonicalValue(body) }
  }
  private restoreLocal(snapshot: CommunityPlatformSnapshotV1): void {
    this.revision = snapshot.revision
    for (const map of [this.profiles, this.edges, this.lineages, this.lfgPosts, this.lfgApplications, this.lfgAttendance, this.reviews, this.reports, this.appeals, this.receipts]) map.clear()
    for (const row of snapshot.profiles) this.profiles.set(row.userId, clone(row))
    for (const row of snapshot.edges) this.edges.set(row.edgeId, clone(row))
    for (const row of snapshot.lineages) this.lineages.set(row.releaseHash, clone(row))
    for (const row of snapshot.lfgPosts) this.lfgPosts.set(row.postId, clone(row))
    for (const row of snapshot.lfgApplications) this.lfgApplications.set(row.applicationId, clone(row))
    for (const row of snapshot.lfgAttendance) this.lfgAttendance.set(row.attendanceId, clone(row))
    for (const row of snapshot.reviews) this.reviews.set(row.reviewId, clone(row))
    for (const row of snapshot.reports) this.reports.set(row.reportId, clone(row))
    for (const row of snapshot.appeals) this.appeals.set(row.appealId, clone(row))
    for (const [keyValue, receipt] of snapshot.receipts) this.receipts.set(keyValue, clone(receipt))
    this.audits.splice(0, this.audits.length, ...snapshot.audits.map(clone))
  }
}
