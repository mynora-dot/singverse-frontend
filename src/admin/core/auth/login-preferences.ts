const storageKey = 'singverse:login-preferences:v1'

interface LoginPreferences {
  username: string
  rememberPassword: boolean
  autoLogin: boolean
}

export function readLoginPreferences(): LoginPreferences {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (value && typeof value === 'object') {
      const saved = value as Record<string, unknown>
      return {
        username: typeof saved.username === 'string' && saved.username.length <= 32 ? saved.username : '',
        rememberPassword: saved.rememberPassword === true,
        autoLogin: saved.autoLogin === true,
      }
    }
  } catch { /* Storage can be unavailable in private browser contexts. */ }
  return { username: '', rememberPassword: false, autoLogin: false }
}

export function saveLoginPreferences(value: LoginPreferences) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      username: value.rememberPassword || value.autoLogin ? value.username : '',
      rememberPassword: value.rememberPassword,
      autoLogin: value.autoLogin,
    }))
  } catch { /* Login still works without browser storage. */ }
}

export function disableAutomaticLogin() {
  saveLoginPreferences({ ...readLoginPreferences(), autoLogin: false })
}

export function safeLoginRedirect(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && value !== '/' &&
    !value.startsWith('//') && !value.includes('\\') && !/^\/login(?:[/?#]|$)/.test(value)
    ? value : '/overview'
}

export interface SavedPassword { username: string; password: string }
type BrowserPasswordCredential = Credential & { password: string }
type PasswordCredentialConstructor = new (data: { id: string; password: string }) => BrowserPasswordCredential

function passwordCredentialConstructor() {
  return (window as Window & { PasswordCredential?: PasswordCredentialConstructor }).PasswordCredential
}

// Credentials stay in the browser password manager. Application storage holds
// only the username and preferences, never the password or a session token.
export async function readBrowserPassword(): Promise<SavedPassword | null> {
  if (!window.isSecureContext || !passwordCredentialConstructor() || !navigator.credentials) return null
  try {
    const options: CredentialRequestOptions & { password: boolean } = { password: true, mediation: 'silent' }
    const credential = await navigator.credentials.get(options) as BrowserPasswordCredential | null
    return credential?.type === 'password' && typeof credential.password === 'string'
      ? { username: credential.id, password: credential.password } : null
  } catch { return null }
}

export async function saveBrowserPassword(value: SavedPassword): Promise<boolean> {
  const PasswordCredential = passwordCredentialConstructor()
  if (!window.isSecureContext || !PasswordCredential || !navigator.credentials) return false
  try {
    await navigator.credentials.store(new PasswordCredential({ id: value.username, password: value.password }))
    return true
  } catch { return false }
}
