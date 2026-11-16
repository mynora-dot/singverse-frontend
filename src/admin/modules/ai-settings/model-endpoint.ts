const operations: Record<string, string> = { CHAT_COMPLETIONS: '/chat/completions', RESPONSES: '/responses', ANTHROPIC: '/messages' }
const versionPath = /\/v\d+(?:(?:alpha|beta)\d*)?$/i

// Preview only. Go validates and canonicalizes the address before any request.
export function modelEndpoint(protocol: string, value: string): string {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return ''
    let path = url.pathname.replace(/\/+$/, '')
    const operation = operations[protocol]
    if (protocol !== 'GEMINI' && !operation) return ''
    if (Object.values(operations).some(suffix => path.endsWith(suffix) && suffix !== operation)) return ''
    if (!path) path = protocol === 'GEMINI' ? '/v1beta' : '/v1'
    if (protocol !== 'GEMINI' && versionPath.test(path)) path += operation
    url.pathname = path
    return url.href
  } catch { return '' }
}

export function modelBaseAddress(value: string): string {
  return value.trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses|messages)$/, '')
}
