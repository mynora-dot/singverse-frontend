const nicknameKey = 'singverse-party:nickname:v1'

function nickname(value: unknown): string {
  if (typeof value !== 'string') return ''
  const name = value.trim()
  return name && Array.from(name).length <= 30 ? name : ''
}

export function readPartyNickname(): string {
  try { return nickname(localStorage.getItem(nicknameKey)) }
  catch { return '' }
}

export function rememberPartyNickname(value: string) {
  const name = nickname(value)
  if (!name) return
  try { localStorage.setItem(nicknameKey, name) }
  catch { /* Joining still works when persistent storage is unavailable. */ }
}
