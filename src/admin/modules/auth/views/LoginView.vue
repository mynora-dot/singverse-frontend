<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Warning } from '@element-plus/icons-vue'
import { authRequest, refreshAccount } from '../../../core/auth/api'
import { readLoginPreferences, saveLoginPreferences, readBrowserPassword, saveBrowserPassword, safeLoginRedirect, type SavedPassword } from '../../../core/auth/login-preferences'
import PasswordRecoveryView from './PasswordRecoveryView.vue'

const props = defineProps<{ redirect?: string }>()
const emit = defineEmits<{ dismiss: [] }>()
const route = useRoute(), router = useRouter()
const preferences = readLoginPreferences()
const username = ref(preferences.username || 'admin')
const password = ref(''), code = ref(''), stage = ref(false), busy = ref(false), error = ref('')
const passwordVisible = ref(false)
const rememberPassword = ref(preferences.rememberPassword), autoLogin = ref(preferences.autoLogin)
const recovering = ref(false), notice = ref('')
const recoveryForm = ref<InstanceType<typeof PasswordRecoveryView>>()
const usernameInput = ref<HTMLInputElement>(), codeInput = ref<HTMLInputElement>()
let active = true
let pendingCredential: SavedPassword | null = null
let credentialTimer: ReturnType<typeof setTimeout> | undefined

function clearPendingCredential() {
  pendingCredential = null
  clearTimeout(credentialTimer)
  credentialTimer = undefined
}

async function focusInitial() {
  await nextTick()
  if (recovering.value) { void recoveryForm.value?.focusInitial(); return }
  ;(stage.value ? codeInput.value : usernameInput.value)?.focus({ preventScroll: true })
}
defineExpose({ focusInitial })
onMounted(async () => {
  if (!rememberPassword.value) return
  const initialUsername = username.value
  const saved = await readBrowserPassword()
  if (active && saved && !busy.value && !stage.value && !recovering.value && !password.value && username.value === initialUsername) {
    username.value = saved.username
    password.value = saved.password
  }
})
onBeforeUnmount(() => { active = false; password.value = ''; code.value = ''; clearPendingCredential() })

async function submit() {
  if (busy.value || (stage.value ? !code.value.trim() : !username.value.trim() || !password.value)) return
  busy.value = true
  error.value = ''
  notice.value = ''
  if (!stage.value) {
    clearPendingCredential()
    if (rememberPassword.value) pendingCredential = { username: username.value, password: password.value }
  }
  try {
    const result = stage.value
      ? await authRequest<{ state: string }>('/api/v1/auth/mfa/verify', 'POST', { code: code.value.trim() })
      : await authRequest<{ state: string }>('/api/v1/auth/login', 'POST', { username: username.value, password: password.value, autoLogin: autoLogin.value })
    if (!active) return
    password.value = ''
    code.value = ''
    passwordVisible.value = false
    if (result.state === 'mfaRequired') {
      stage.value = true
      credentialTimer = setTimeout(clearPendingCredential, 5 * 60 * 1000)
      void focusInitial()
      return
    }
    if (result.state !== 'authenticated') throw new Error('登录响应异常，请重试')
    const account = await refreshAccount()
    if (!active) return
    if (!account) throw new Error('会话未建立，请重新登录')
    saveLoginPreferences({ username: account.username, rememberPassword: rememberPassword.value, autoLogin: autoLogin.value })
    if (rememberPassword.value && pendingCredential) {
      void saveBrowserPassword(pendingCredential).then(saved => {
        if (!saved) ElMessage.info('如需记住密码，请在浏览器的密码管理器中保存此账号。')
      })
    }
    clearPendingCredential()
    const redirect = props.redirect ?? (typeof route.query.redirect === 'string' ? route.query.redirect : '/overview')
    await router.replace(safeLoginRedirect(redirect))
  } catch (e) {
    if (active) {
      error.value = e instanceof Error ? e.message : '登录失败，请重试'
      if (!stage.value) clearPendingCredential()
      if (stage.value) { code.value = ''; void focusInitial() }
    }
  } finally { if (active) busy.value = false }
}
function restart() {
  if (busy.value) return
  stage.value = false
  code.value = ''
  password.value = ''
  error.value = ''
  notice.value = ''
  clearPendingCredential()
  void focusInitial()
}
function showRecovery() {
  if (busy.value) return
  restart()
  recovering.value = true
  void focusInitial()
}
function returnToLogin(resetUsername?: string) {
  recovering.value = false
  restart()
  if (resetUsername) {
    username.value = resetUsername
    autoLogin.value = false
    notice.value = '密码已重置，请使用新密码登录。原有二次验证保持不变。'
  }
  void focusInitial()
}
</script>

<template>
  <PasswordRecoveryView v-if="recovering" ref="recoveryForm" :username="username" @back="returnToLogin()" @reset="returnToLogin" />
  <section v-else class="login-card" aria-labelledby="login-title">
    <h1 id="login-title">{{ stage ? '二次验证' : '登录管理中心' }}</h1>
    <p id="login-description" class="login-description">{{ stage ? '输入验证器动态码，或使用一枚恢复码。' : '使用管理员账号管理家庭曲库。' }}</p>
    <div v-if="error" class="login-error" role="alert"><Warning aria-hidden="true" /><p>{{ error }}</p></div>
    <p v-if="notice" class="login-notice" role="status">{{ notice }}</p>
    <form class="login-form" :aria-busy="busy" @submit.prevent="submit">
      <template v-if="!stage">
        <div class="login-field">
          <label for="login-username">账号</label>
          <input id="login-username" ref="usernameInput" v-model="username" name="username" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" :disabled="busy" required>
        </div>
        <div class="login-field">
          <label for="login-password">密码</label>
          <div class="login-password-wrap">
            <input id="login-password" v-model="password" name="password" :type="passwordVisible ? 'text' : 'password'" :autocomplete="rememberPassword ? 'current-password' : 'off'" maxlength="256" placeholder="请输入密码" :disabled="busy" required>
            <button class="login-password-toggle" type="button" :aria-label="passwordVisible ? '隐藏密码' : '显示密码'" :aria-pressed="passwordVisible" aria-controls="login-password" :disabled="busy" @click="passwordVisible = !passwordVisible">{{ passwordVisible ? '隐藏' : '显示' }}</button>
          </div>
        </div>
        <div class="login-options">
          <div class="login-preferences">
            <label><input v-model="rememberPassword" type="checkbox" name="rememberPassword" :disabled="busy"><span>记住密码</span></label>
            <label><input v-model="autoLogin" type="checkbox" name="autoLogin" :disabled="busy"><span>自动登录</span></label>
          </div>
          <button class="login-inline-button" type="button" :disabled="busy" @click="showRecovery">忘记密码？</button>
        </div>
        <p v-if="rememberPassword || autoLogin" class="login-preference-hint"><span v-if="rememberPassword">登录后，请在浏览器提示中确认保存密码。</span><span v-if="autoLogin">30 天内自动登录，退出登录后失效。</span></p>
      </template>
      <div v-else class="login-field">
        <label for="login-code">动态码 / 恢复码</label>
        <input id="login-code" ref="codeInput" v-model="code" name="code" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" maxlength="128" placeholder="输入动态码或恢复码" :disabled="busy" required>
      </div>
      <button class="login-submit" type="submit" :disabled="busy || (stage ? !code.trim() : !username.trim() || !password)">
        <span v-if="busy" class="login-spinner" aria-hidden="true" />{{ busy ? '正在验证…' : stage ? '验证并登录' : '登录管理中心' }}
      </button>
      <button v-if="stage" class="login-text-button" type="button" :disabled="busy" @click="restart">返回密码登录</button>
      <button class="login-text-button login-return" type="button" @click="emit('dismiss')">返回首页</button>
    </form>
    <details class="login-help">
      <summary>无法登录？</summary>
      <p>忘记密码时，可通过上方入口使用一次性重置码。若也丢失了二次验证方式，请在部署主机停止业务服务后，使用 <code>singverse --reset-admin</code> 进行管理员恢复。</p>
    </details>
  </section>
</template>
