import fs from 'node:fs'
import { createFeedbackApp } from './server.mjs'
process.umask(0o077)
const env = Object.fromEntries(fs.readFileSync('/etc/storyforge-feedback/env', 'utf8').split(/\r?\n/).filter(x => x && !x.startsWith('#') && x.includes('=')).map(x => [x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]))
if (!env.GITHUB_TOKEN || (env.GITHUB_REPO && env.GITHUB_REPO !== 'yuanbw2025/storyforge')) throw new Error('Feedback configuration unavailable')
createFeedbackApp({ githubToken: env.GITHUB_TOKEN, uploadDir: '/var/www/storyforge-feedback/uploads', publicUploadPrefix: 'https://docs.storyforge-lab.com/feedback-files' }).listen(8787, '127.0.0.1')
