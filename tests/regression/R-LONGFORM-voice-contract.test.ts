import { describe, expect, it } from 'vitest'
import { assertVoiceTransport, speechText, voiceEndpoint, DEFAULT_COMPANION } from '../../src/lib/longform-voice/contract'

describe('长篇语音有限边界', () => {
  it('只开放登记的临时输入与只读输出，不允许其他调用方', () => {
    for (const id of ['longform.voice.input', 'longform.voice.output']) {
      expect(() => assertVoiceTransport(id, 'src/lib/longform-voice/session.ts')).not.toThrow()
      expect(() => assertVoiceTransport(id, 'src/components/fake.tsx')).toThrow('未登记')
    }
    expect(() => assertVoiceTransport('prose.chapter.generate', 'src/lib/longform-voice/session.ts')).toThrow()
  })
  it.each(['http://remote.example/v1', 'https://secret@example.org/v1', 'https://example.org/v1?key=secret', 'file:///tmp/a'])('拒绝不安全或混入凭据的地址 %s', (baseUrl) => {
    expect(() => voiceEndpoint({ ...DEFAULT_COMPANION.input, baseUrl, model: 'asr' }, 'transcriptions')).toThrow()
  })
  it('接受独立本地服务，保持版本路径，不替用户猜模型', () => {
    expect(voiceEndpoint({ ...DEFAULT_COMPANION.input, baseUrl: 'http://localhost:8000/v1/', model: 'asr' }, 'transcriptions')).toBe('http://localhost:8000/v1/audio/transcriptions')
    expect(() => voiceEndpoint({ ...DEFAULT_COMPANION.output, baseUrl: 'https://example.org/v1', model: 'tts' }, 'speech')).toThrow('音色')
  })
  it('朗读去除代码与装饰，明确限制一次长度', () => {
    expect(speechText('**回复** [链接](https://a)\n```json\n{"key":123}\n```')).toBe('回复 链接')
    expect(speechText('文'.repeat(2100))).toHaveLength(2000)
  })
})
