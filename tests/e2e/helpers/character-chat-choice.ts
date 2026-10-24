import type {Route} from '@playwright/test'
import {chatActionOutcomeFixture, chatActionChoiceFixture} from '../../helpers/chat-action-outcome'

/** Serialize the expression fixture for the version requested by the app. */
export function chatActionResponseFixture(route: Route, output: unknown): string {
  const messages = route.request().postDataJSON()?.messages ?? []
  return JSON.stringify(chatActionOutcomeFixture(messages, chatActionChoiceFixture(messages, output)))
}

/** Valid empty choice for expression/review-focused browser fixtures. The
 * actual default Harness still sends and records this request and charges its
 * allowance. Existing handler counters describe the other phases, not total
 * model calls. Dedicated action-choice tests supply their own nonempty/error
 * responses and verify all three requests and their durable evidence. */
export async function fulfillChatActionChoiceFixture(route: Route): Promise<boolean> {
  if (route.request().method() !== 'POST') return false
  const content = route.request().postDataJSON()?.messages?.[0]?.content
  if (typeof content !== 'string' || !content.startsWith('这是尚未发生的角色行动选择草稿')) return false
  const output = {directions: [], selectedId: null, decisionSummary: '本浏览器工程用例不增加方向建议；表达及后果仍须独立校验。'}
  await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{
    message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop',
  }]})})
  return true
}
