import { expect, it } from 'vitest'
import { modelEndpoint, modelBaseAddress } from '../src/admin/modules/ai-settings/model-endpoint'

it.each([
  ['CHAT_COMPLETIONS', 'http://10.0.0.16:8080/v1', 'http://10.0.0.16:8080/v1/chat/completions'],
  ['CHAT_COMPLETIONS', 'https://example.test', 'https://example.test/v1/chat/completions'],
  ['RESPONSES', 'https://example.test/proxy/v1/', 'https://example.test/proxy/v1/responses'],
  ['ANTHROPIC', 'https://example.test/v1', 'https://example.test/v1/messages'],
  ['GEMINI', 'https://example.test', 'https://example.test/v1beta'],
  ['CHAT_COMPLETIONS', 'https://example.test/custom/exact/operation', 'https://example.test/custom/exact/operation'],
  ['CHAT_COMPLETIONS', 'https://example.test/v1/chat/completions', 'https://example.test/v1/chat/completions'],
  ['CHAT_COMPLETIONS', 'https://example.test/v1/responses', ''],
  ['CHAT_COMPLETIONS', 'https://user:secret@example.test/v1', ''],
  ['CHAT_COMPLETIONS', 'https://example.test/v1?key=secret', ''],
])('请求地址预览（%s，%s）', (protocol, input, want) => {
  expect(modelEndpoint(protocol!, input!)).toBe(want)
})

it('切换协议后从同一基础地址生成新接口，保留网关前缀', () => {
  const base = modelBaseAddress('https://example.test/relay/v1/responses')
  expect(modelEndpoint('CHAT_COMPLETIONS', base)).toBe('https://example.test/relay/v1/chat/completions')
})
