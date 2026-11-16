import type {
  CommunityAgeBandV1,
  CommunityAppealV1,
  CommunityLfgApplicationV1,
  CommunityLfgAttendanceV1,
  CommunityLfgParticipationV1,
  CommunityLfgPostV1,
  CommunityProfileV1,
  CommunityReviewAggregateV1,
  CommunityReviewCapabilitiesV1,
  CommunityReviewV1,
  CommunityReportV1,
  CommunityReportViewV1,
  CommunitySocialEdgeV1,
} from './authority'

interface FetchResponseV1 { ok: boolean; status: number; text(): Promise<string> }
type FetchV1 = (input: string, init: {
  method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal
}) => Promise<FetchResponseV1>

export class CommunityHttpErrorV1 extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
  ) {
    super(`[community-http:${code}] ${message}`)
    this.name = 'CommunityHttpErrorV1'
  }
}

function fail(code: string, message: string, retryable = false, status: number | null = null): never {
  throw new CommunityHttpErrorV1(code, message, retryable, status)
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protocol', `${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    fail('protocol', `${label} 字段不符合协议`)
  }
}
function text(value: unknown, label: string, maximum = 2_000, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > maximum) fail('protocol', `${label} 无效`)
  return value
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum) fail('protocol', `${label} 无效`)
  return Number(value)
}
function sha(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!/^[0-9a-f]{64}$/.test(result)) fail('protocol', `${label} 不是 sha256`)
  return result
}

function profile(value: unknown): CommunityProfileV1 {
  const row = record(value, 'profile')
  exact(row, ['userId', 'handle', 'displayName', 'bio', 'locale', 'timeZone', 'ageBand', 'status', 'createdAt', 'updatedAt'], 'profile')
  if (!['adult', 'minor', 'unknown'].includes(String(row.ageBand)) || !['active', 'suspended'].includes(String(row.status))) {
    fail('protocol', 'profile 枚举无效')
  }
  return {
    userId: text(row.userId, 'profile.userId', 200), handle: text(row.handle, 'profile.handle', 40),
    displayName: text(row.displayName, 'profile.displayName', 100), bio: text(row.bio, 'profile.bio', 2_000, true),
    locale: text(row.locale, 'profile.locale', 40), timeZone: text(row.timeZone, 'profile.timeZone', 100),
    ageBand: row.ageBand as CommunityAgeBandV1, status: row.status as CommunityProfileV1['status'],
    createdAt: integer(row.createdAt, 'profile.createdAt'), updatedAt: integer(row.updatedAt, 'profile.updatedAt'),
  }
}

function post(value: unknown): CommunityLfgPostV1 {
  const row = record(value, 'lfg post')
  exact(row, [
    'postId', 'creatorId', 'releaseHash', 'title', 'summary', 'locale', 'timeZone', 'startsAt',
    'durationMinutes', 'playerCapacity', 'waitlistCapacity', 'audience', 'safetyTags', 'status',
    'createdAt', 'updatedAt',
  ], 'lfg post')
  if (!['all-ages', 'adult-only'].includes(String(row.audience)) || !['open', 'closed', 'cancelled'].includes(String(row.status))
    || !Array.isArray(row.safetyTags) || row.safetyTags.some(item => typeof item !== 'string')) {
    fail('protocol', 'lfg post 枚举或 safetyTags 无效')
  }
  return {
    postId: text(row.postId, 'lfg post.postId', 200), creatorId: text(row.creatorId, 'lfg post.creatorId', 200),
    releaseHash: sha(row.releaseHash, 'lfg post.releaseHash'), title: text(row.title, 'lfg post.title', 200),
    summary: text(row.summary, 'lfg post.summary', 4_000), locale: text(row.locale, 'lfg post.locale', 40),
    timeZone: text(row.timeZone, 'lfg post.timeZone', 100), startsAt: integer(row.startsAt, 'lfg post.startsAt'),
    durationMinutes: integer(row.durationMinutes, 'lfg post.durationMinutes', 30),
    playerCapacity: integer(row.playerCapacity, 'lfg post.playerCapacity', 1),
    waitlistCapacity: integer(row.waitlistCapacity, 'lfg post.waitlistCapacity'),
    audience: row.audience as CommunityLfgPostV1['audience'], safetyTags: [...row.safetyTags] as string[],
    status: row.status as CommunityLfgPostV1['status'],
    createdAt: integer(row.createdAt, 'lfg post.createdAt'), updatedAt: integer(row.updatedAt, 'lfg post.updatedAt'),
  }
}

function application(value: unknown): CommunityLfgApplicationV1 {
  const row = record(value, 'lfg application')
  exact(row, [
    'applicationId', 'postId', 'userId', 'characterPreference', 'note', 'status', 'createdAt', 'updatedAt',
  ], 'lfg application')
  if (!['pending', 'accepted', 'waitlisted', 'declined', 'withdrawn'].includes(String(row.status))) {
    fail('protocol', 'lfg application.status 无效')
  }
  return {
    applicationId: text(row.applicationId, 'application.applicationId', 200),
    postId: text(row.postId, 'application.postId', 200), userId: text(row.userId, 'application.userId', 200),
    characterPreference: text(row.characterPreference, 'application.characterPreference', 300, true),
    note: text(row.note, 'application.note', 2_000, true), status: row.status as CommunityLfgApplicationV1['status'],
    createdAt: integer(row.createdAt, 'application.createdAt'), updatedAt: integer(row.updatedAt, 'application.updatedAt'),
  }
}

function attendance(value: unknown): CommunityLfgAttendanceV1 {
  const row = record(value, 'lfg attendance')
  exact(row, [
    'attendanceId', 'postId', 'applicationId', 'userId', 'status', 'replacementApplicationId',
    'markedBy', 'createdAt', 'updatedAt',
  ], 'lfg attendance')
  if (!['confirmed', 'no-show', 'replaced'].includes(String(row.status))) fail('protocol', 'attendance.status 无效')
  return {
    attendanceId: text(row.attendanceId, 'attendance.attendanceId', 200),
    postId: text(row.postId, 'attendance.postId', 200), applicationId: text(row.applicationId, 'attendance.applicationId', 200),
    userId: text(row.userId, 'attendance.userId', 200), status: row.status as CommunityLfgAttendanceV1['status'],
    replacementApplicationId: row.replacementApplicationId == null
      ? null : text(row.replacementApplicationId, 'attendance.replacementApplicationId', 200),
    markedBy: text(row.markedBy, 'attendance.markedBy', 200),
    createdAt: integer(row.createdAt, 'attendance.createdAt'), updatedAt: integer(row.updatedAt, 'attendance.updatedAt'),
  }
}

function review(value: unknown): CommunityReviewV1 {
  const row = record(value, 'review')
  exact(row, [
    'reviewId', 'authorId', 'subjectType', 'releaseHash', 'postId', 'rating', 'title', 'body', 'tags',
    'containsSpoilers', 'verification', 'status', 'creatorResponse', 'responseBy', 'responseAt', 'createdAt', 'updatedAt',
  ], 'review')
  if (!['release', 'actual-play'].includes(String(row.subjectType))
    || ![1, 2, 3, 4, 5].includes(Number(row.rating))
    || !['entitlement', 'attendance'].includes(String(row.verification))
    || !['published', 'withdrawn', 'removed'].includes(String(row.status))
    || typeof row.containsSpoilers !== 'boolean' || !Array.isArray(row.tags)
    || row.tags.some(tag => typeof tag !== 'string')) fail('protocol', 'review 枚举或 tags 无效')
  return {
    reviewId: text(row.reviewId, 'review.reviewId', 500), authorId: text(row.authorId, 'review.authorId', 200),
    subjectType: row.subjectType as CommunityReviewV1['subjectType'], releaseHash: sha(row.releaseHash, 'review.releaseHash'),
    postId: row.postId == null ? null : text(row.postId, 'review.postId', 200),
    rating: integer(row.rating, 'review.rating', 1) as CommunityReviewV1['rating'],
    title: text(row.title, 'review.title', 200), body: text(row.body, 'review.body', 4_000),
    tags: [...row.tags] as string[], containsSpoilers: row.containsSpoilers,
    verification: row.verification as CommunityReviewV1['verification'], status: row.status as CommunityReviewV1['status'],
    creatorResponse: row.creatorResponse == null ? null : text(row.creatorResponse, 'review.creatorResponse', 2_000),
    responseBy: row.responseBy == null ? null : text(row.responseBy, 'review.responseBy', 200),
    responseAt: row.responseAt == null ? null : integer(row.responseAt, 'review.responseAt'),
    createdAt: integer(row.createdAt, 'review.createdAt'), updatedAt: integer(row.updatedAt, 'review.updatedAt'),
  }
}

function reviewCollection(value: unknown): { reviews: CommunityReviewV1[]; aggregate: CommunityReviewAggregateV1 } {
  const result = record(value, 'review collection')
  exact(result, ['reviews', 'aggregate'], 'review collection')
  if (!Array.isArray(result.reviews) || result.reviews.length > 10_000) fail('protocol', 'reviews 响应无效')
  const aggregate = record(result.aggregate, 'review aggregate')
  exact(aggregate, ['subjectType', 'releaseHash', 'postId', 'count', 'average', 'histogram', 'tagCounts'], 'review aggregate')
  const histogram = record(aggregate.histogram, 'review histogram')
  exact(histogram, ['1', '2', '3', '4', '5'], 'review histogram')
  if (!['release', 'actual-play'].includes(String(aggregate.subjectType))
    || (aggregate.average != null && (typeof aggregate.average !== 'number' || aggregate.average < 1 || aggregate.average > 5))
    || !Array.isArray(aggregate.tagCounts) || aggregate.tagCounts.length > 1_000) fail('protocol', 'review aggregate 无效')
  return {
    reviews: result.reviews.map(review),
    aggregate: {
      subjectType: aggregate.subjectType as CommunityReviewV1['subjectType'],
      releaseHash: sha(aggregate.releaseHash, 'aggregate.releaseHash'),
      postId: aggregate.postId == null ? null : text(aggregate.postId, 'aggregate.postId', 200),
      count: integer(aggregate.count, 'aggregate.count'), average: aggregate.average == null ? null : aggregate.average,
      histogram: {
        '1': integer(histogram['1'], 'histogram.1'), '2': integer(histogram['2'], 'histogram.2'),
        '3': integer(histogram['3'], 'histogram.3'), '4': integer(histogram['4'], 'histogram.4'),
        '5': integer(histogram['5'], 'histogram.5'),
      },
      tagCounts: aggregate.tagCounts.map((item, index) => {
        const row = record(item, `tagCounts[${index}]`)
        exact(row, ['tag', 'count'], `tagCounts[${index}]`)
        return { tag: text(row.tag, 'tag', 500), count: integer(row.count, 'tag.count', 1) }
      }),
    },
  }
}

function reportView(value: unknown): CommunityReportViewV1 {
  const row = record(value, 'report view')
  exact(row, [
    'reportId', 'relation', 'subjectType', 'subjectId', 'category', 'details', 'status', 'action',
    'reasonCode', 'createdAt', 'updatedAt',
  ], 'report view')
  if (!['reporter', 'subject'].includes(String(row.relation))
    || !['profile', 'listing', 'lfg', 'room', 'review'].includes(String(row.subjectType))
    || !['harassment', 'unsafe-content', 'rights', 'fraud', 'minor-safety', 'other'].includes(String(row.category))
    || !['open', 'dismissed', 'actioned', 'appealed', 'resolved'].includes(String(row.status))
    || (row.action != null && !['none', 'warning', 'suspend', 'remove'].includes(String(row.action)))) {
    fail('protocol', 'report view 枚举无效')
  }
  return {
    reportId: text(row.reportId, 'report.reportId', 200), relation: row.relation as CommunityReportViewV1['relation'],
    subjectType: row.subjectType as CommunityReportV1['subjectType'], subjectId: text(row.subjectId, 'report.subjectId', 500),
    category: row.category as CommunityReportV1['category'], details: row.details == null ? null : text(row.details, 'report.details', 4_000),
    status: row.status as CommunityReportV1['status'], action: row.action as CommunityReportV1['action'],
    reasonCode: row.reasonCode == null ? null : text(row.reasonCode, 'report.reasonCode', 200),
    createdAt: integer(row.createdAt, 'report.createdAt'), updatedAt: integer(row.updatedAt, 'report.updatedAt'),
  }
}

function appeal(value: unknown): CommunityAppealV1 {
  const row = record(value, 'appeal')
  exact(row, ['appealId', 'reportId', 'appellantId', 'statement', 'status', 'reviewedBy', 'createdAt', 'updatedAt'], 'appeal')
  if (!['open', 'upheld', 'reversed'].includes(String(row.status))) fail('protocol', 'appeal.status 无效')
  return {
    appealId: text(row.appealId, 'appeal.appealId', 200), reportId: text(row.reportId, 'appeal.reportId', 200),
    appellantId: text(row.appellantId, 'appeal.appellantId', 200), statement: text(row.statement, 'appeal.statement', 4_000),
    status: row.status as CommunityAppealV1['status'],
    reviewedBy: row.reviewedBy == null ? null : text(row.reviewedBy, 'appeal.reviewedBy', 200),
    createdAt: integer(row.createdAt, 'appeal.createdAt'), updatedAt: integer(row.updatedAt, 'appeal.updatedAt'),
  }
}

function socialEdge(value: unknown): CommunitySocialEdgeV1 {
  const row = record(value, 'social edge')
  exact(row, ['edgeId', 'kind', 'actorId', 'targetId', 'active', 'createdAt', 'updatedAt'], 'social edge')
  if (!['follow-creator', 'favorite-listing', 'subscribe-listing'].includes(String(row.kind))
    || typeof row.active !== 'boolean') fail('protocol', 'social edge 无效')
  return {
    edgeId: text(row.edgeId, 'edge.edgeId', 500), kind: row.kind as CommunitySocialEdgeV1['kind'],
    actorId: text(row.actorId, 'edge.actorId', 200), targetId: text(row.targetId, 'edge.targetId', 200),
    active: row.active, createdAt: integer(row.createdAt, 'edge.createdAt'), updatedAt: integer(row.updatedAt, 'edge.updatedAt'),
  }
}

function normalizedBaseUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, '')
  let url: URL
  try { url = new URL(raw) } catch { fail('configuration', '社区服务地址无效') }
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    fail('configuration', '社区服务必须使用 HTTPS（本机开发地址除外）')
  }
  return raw
}

export class CommunityHttpClientV1 {
  readonly baseUrl: string
  private readonly fetchImpl: FetchV1
  private readonly timeoutMs: number

  constructor(input: { baseUrl: string; fetch?: FetchV1; timeoutMs?: number }) {
    this.baseUrl = normalizedBaseUrl(input.baseUrl)
    this.fetchImpl = input.fetch ?? globalThis.fetch?.bind(globalThis)
    this.timeoutMs = input.timeoutMs ?? 30_000
    if (typeof this.fetchImpl !== 'function' || !Number.isInteger(this.timeoutMs)
      || this.timeoutMs < 100 || this.timeoutMs > 120_000) fail('configuration', '社区 HTTP 配置无效')
  }

  async discoverLfg(input: { locale?: string; releaseHash?: string; includeFull?: boolean } = {}) {
    const value = await this.post('/v1/community/lfg/discover', input)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'lfg discover 响应无效')
    return value.map((item, index) => {
      const row = record(item, `lfg discover[${index}]`)
      exact(row, ['post', 'accepted', 'waitlisted', 'availableSeats'], `lfg discover[${index}]`)
      return {
        post: post(row.post), accepted: integer(row.accepted, 'accepted'),
        waitlisted: integer(row.waitlisted, 'waitlisted'), availableSeats: integer(row.availableSeats, 'availableSeats'),
      }
    })
  }

  async upsertProfile(input: {
    accessToken: string; requestId: string; handle: string; displayName: string; bio: string
    locale: string; timeZone: string; ageBand: CommunityAgeBandV1
  }): Promise<CommunityProfileV1> {
    const { accessToken, ...body } = input
    return profile(await this.post('/v1/community/profiles', body, accessToken))
  }

  async setSocialEdge(input: {
    accessToken: string; requestId: string; kind: CommunitySocialEdgeV1['kind']; targetId: string; active: boolean
  }): Promise<CommunitySocialEdgeV1> {
    const { accessToken, ...body } = input
    return socialEdge(await this.post('/v1/community/social', body, accessToken))
  }

  async mySocialEdges(accessToken: string): Promise<CommunitySocialEdgeV1[]> {
    const value = await this.post('/v1/community/social/mine', {}, accessToken)
    if (!Array.isArray(value) || value.length > 100_000) fail('protocol', 'social edges 响应无效')
    return value.map(socialEdge)
  }

  async listReviews(input: {
    subjectType: CommunityReviewV1['subjectType']; releaseHash: string; postId?: string | null
  }): Promise<{ reviews: CommunityReviewV1[]; aggregate: CommunityReviewAggregateV1 }> {
    return reviewCollection(await this.post('/v1/community/reviews/list', input))
  }

  async upsertReview(input: {
    accessToken: string; requestId: string; subjectType: CommunityReviewV1['subjectType']; releaseHash: string
    postId: string | null; rating: number; title: string; body: string; tags: string[]; containsSpoilers: boolean
  }): Promise<CommunityReviewV1> {
    const { accessToken, ...body } = input
    return review(await this.post('/v1/community/reviews', body, accessToken))
  }

  async reviewCapabilities(input: {
    accessToken: string; subjectType: CommunityReviewV1['subjectType']; releaseHash: string; postId?: string | null
  }): Promise<CommunityReviewCapabilitiesV1> {
    const { accessToken, ...body } = input
    const row = record(await this.post('/v1/community/reviews/capabilities', body, accessToken), 'review capabilities')
    exact(row, ['ownReviewId', 'respondableReviewIds'], 'review capabilities')
    if (!Array.isArray(row.respondableReviewIds) || row.respondableReviewIds.length > 10_000
      || row.respondableReviewIds.some(item => typeof item !== 'string')) fail('protocol', 'review capabilities 无效')
    return {
      ownReviewId: row.ownReviewId == null ? null : text(row.ownReviewId, 'ownReviewId', 500),
      respondableReviewIds: [...row.respondableReviewIds] as string[],
    }
  }

  async withdrawReview(input: { accessToken: string; requestId: string; reviewId: string }): Promise<CommunityReviewV1> {
    const { accessToken, ...body } = input
    return review(await this.post('/v1/community/reviews/withdraw', body, accessToken))
  }

  async respondToReview(input: {
    accessToken: string; requestId: string; reviewId: string; response: string
  }): Promise<CommunityReviewV1> {
    const { accessToken, ...body } = input
    return review(await this.post('/v1/community/reviews/respond', body, accessToken))
  }

  async createReport(input: {
    accessToken: string; requestId: string; subjectType: CommunityReportV1['subjectType']; subjectId: string
    category: CommunityReportV1['category']; details: string
  }): Promise<CommunityReportViewV1> {
    const { accessToken, ...body } = input
    const report = record(await this.post('/v1/community/reports', body, accessToken), 'created report')
    return reportView({
      reportId: report.reportId, relation: 'reporter', subjectType: report.subjectType, subjectId: report.subjectId,
      category: report.category, details: report.details, status: report.status, action: report.action,
      reasonCode: report.reasonCode, createdAt: report.createdAt, updatedAt: report.updatedAt,
    })
  }

  async myReports(accessToken: string): Promise<CommunityReportViewV1[]> {
    const value = await this.post('/v1/community/reports/mine', {}, accessToken)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'my reports 响应无效')
    return value.map(reportView)
  }

  async createAppeal(input: {
    accessToken: string; requestId: string; reportId: string; statement: string
  }): Promise<CommunityAppealV1> {
    const { accessToken, ...body } = input
    return appeal(await this.post('/v1/community/appeals', body, accessToken))
  }

  async myAppeals(accessToken: string): Promise<CommunityAppealV1[]> {
    const value = await this.post('/v1/community/appeals/mine', {}, accessToken)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'my appeals 响应无效')
    return value.map(appeal)
  }

  async createLfg(input: {
    accessToken: string; requestId: string; releaseHash: string; title: string; summary: string
    locale: string; timeZone: string; startsAt: number; durationMinutes: number
    playerCapacity: number; waitlistCapacity: number; audience: CommunityLfgPostV1['audience']; safetyTags: string[]
  }): Promise<CommunityLfgPostV1> {
    const { accessToken, ...body } = input
    return post(await this.post('/v1/community/lfg', body, accessToken))
  }

  async applyToLfg(input: {
    accessToken: string; requestId: string; postId: string; characterPreference: string; note: string
  }): Promise<CommunityLfgApplicationV1> {
    const { accessToken, ...body } = input
    return application(await this.post('/v1/community/lfg/applications', body, accessToken))
  }

  async applicationsForPost(input: { accessToken: string; postId: string }): Promise<CommunityLfgApplicationV1[]> {
    const value = await this.post('/v1/community/lfg/applications/list', { postId: input.postId }, input.accessToken)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'post applications 响应无效')
    return value.map(application)
  }

  async myApplications(accessToken: string): Promise<CommunityLfgApplicationV1[]> {
    const value = await this.post('/v1/community/lfg/my-applications', {}, accessToken)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'my applications 响应无效')
    return value.map(application)
  }

  async myParticipation(accessToken: string): Promise<CommunityLfgParticipationV1[]> {
    const value = await this.post('/v1/community/lfg/my-participation', {}, accessToken)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'my participation 响应无效')
    return value.map((item, index) => {
      const row = record(item, `participation[${index}]`)
      exact(row, ['post', 'application', 'attendance'], `participation[${index}]`)
      return { post: post(row.post), application: application(row.application), attendance: row.attendance == null ? null : attendance(row.attendance) }
    })
  }

  async decideApplication(input: {
    accessToken: string; requestId: string; applicationId: string; decision: 'accept' | 'decline'
  }): Promise<CommunityLfgApplicationV1> {
    const { accessToken, ...body } = input
    return application(await this.post('/v1/community/lfg/applications/decide', body, accessToken))
  }

  async closeLfg(input: {
    accessToken: string; requestId: string; postId: string; status: 'closed' | 'cancelled'
  }): Promise<CommunityLfgPostV1> {
    const { accessToken, ...body } = input
    return post(await this.post('/v1/community/lfg/close', body, accessToken))
  }

  async markAttendance(input: {
    accessToken: string; requestId: string; applicationId: string; status: 'confirmed' | 'no-show'
  }): Promise<CommunityLfgAttendanceV1> {
    const { accessToken, ...body } = input
    return attendance(await this.post('/v1/community/lfg/attendance', body, accessToken))
  }

  async attendanceForPost(input: { accessToken: string; postId: string }): Promise<CommunityLfgAttendanceV1[]> {
    const value = await this.post('/v1/community/lfg/attendance/list', { postId: input.postId }, input.accessToken)
    if (!Array.isArray(value) || value.length > 10_000) fail('protocol', 'attendance list 响应无效')
    return value.map(attendance)
  }

  async promoteWaitlist(input: {
    accessToken: string; requestId: string; absentApplicationId: string; replacementApplicationId: string
  }): Promise<{ absent: CommunityLfgApplicationV1; replacement: CommunityLfgApplicationV1; attendance: CommunityLfgAttendanceV1 }> {
    const { accessToken, ...body } = input
    const row = record(await this.post('/v1/community/lfg/promote-waitlist', body, accessToken), 'waitlist promotion')
    exact(row, ['absent', 'replacement', 'attendance'], 'waitlist promotion')
    return { absent: application(row.absent), replacement: application(row.replacement), attendance: attendance(row.attendance) }
  }

  async bindRoomHandoffs(input: {
    accessToken: string
    requestId: string
    postId: string
    roomId: string
    releaseHash: string
    expiresAt: number
    bindings: Array<{ applicationId: string; actorKey: string }>
  }): Promise<Array<{
    applicationId: string; postId: string; applicantId: string; roomId: string
    releaseHash: string; actorKey: string; expiresAt: number; createdAt: number
  }>> {
    const { accessToken, ...body } = input
    const value = await this.post('/v1/community/lfg/room-handoffs/bind', body, accessToken)
    if (!Array.isArray(value) || value.length > 20) fail('protocol', 'room handoffs 响应无效')
    return value.map((item, index) => {
      const row = record(item, `room handoffs[${index}]`)
      exact(row, [
        'schema', 'version', 'applicationId', 'postId', 'applicantId', 'roomId',
        'releaseHash', 'actorKey', 'expiresAt', 'createdAt',
      ], `room handoffs[${index}]`)
      if (row.schema !== 'storyforge.lfg-room-handoff' || row.version !== 1) fail('protocol', 'room handoff schema 无效')
      return {
        applicationId: text(row.applicationId, 'handoff.applicationId', 200),
        postId: text(row.postId, 'handoff.postId', 200), applicantId: text(row.applicantId, 'handoff.applicantId', 200),
        roomId: text(row.roomId, 'handoff.roomId', 200), releaseHash: sha(row.releaseHash, 'handoff.releaseHash'),
        actorKey: text(row.actorKey, 'handoff.actorKey', 200),
        expiresAt: integer(row.expiresAt, 'handoff.expiresAt'), createdAt: integer(row.createdAt, 'handoff.createdAt'),
      }
    })
  }

  async claimRoomHandoff(input: { accessToken: string; applicationId: string }): Promise<{
    applicationId: string; roomId: string; releaseHash: string; actorKey: string
    inviteId: string; inviteToken: string; displayName: string; expiresAt: number
  }> {
    const row = record(await this.post('/v1/community/lfg/room-handoffs/claim', {
      applicationId: input.applicationId,
    }, input.accessToken), 'room handoff claim')
    exact(row, [
      'applicationId', 'roomId', 'releaseHash', 'actorKey', 'inviteId', 'inviteToken', 'displayName', 'expiresAt',
    ], 'room handoff claim')
    return {
      applicationId: text(row.applicationId, 'handoff.applicationId', 200),
      roomId: text(row.roomId, 'handoff.roomId', 200), releaseHash: sha(row.releaseHash, 'handoff.releaseHash'),
      actorKey: text(row.actorKey, 'handoff.actorKey', 200), inviteId: text(row.inviteId, 'handoff.inviteId', 200),
      inviteToken: text(row.inviteToken, 'handoff.inviteToken', 500),
      displayName: text(row.displayName, 'handoff.displayName', 100), expiresAt: integer(row.expiresAt, 'handoff.expiresAt'),
    }
  }

  private async post(path: string, body: unknown, accessToken: string | null = null): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
      if (accessToken) headers.authorization = `Bearer ${accessToken}`
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      })
      const raw = await response.text()
      if (new TextEncoder().encode(raw).byteLength > 2_000_000) fail('response_too_large', '社区响应超过客户端上限')
      let value: unknown
      try { value = JSON.parse(raw) } catch { fail('protocol', '社区响应不是合法 JSON') }
      if (!response.ok) {
        const error = record(value, 'error response')
        const code = typeof error.code === 'string' ? error.code : 'request_failed'
        const message = typeof error.message === 'string' ? error.message : '社区请求失败'
        fail(code, message, response.status === 408 || response.status === 429 || response.status >= 500, response.status)
      }
      return value
    } catch (error) {
      if (error instanceof CommunityHttpErrorV1) throw error
      if (controller.signal.aborted) fail('timeout', '社区请求超时', true)
      fail('network', '无法连接社区服务', true)
    } finally { clearTimeout(timeout) }
  }
}
