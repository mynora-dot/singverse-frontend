<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { Warning } from '@element-plus/icons-vue'
import { auth, authRequest } from '../../../core/auth/api'
import { disableAutomaticLogin } from '../../../core/auth/login-preferences'

const props = defineProps<{ username: string }>()
const emit = defineEmits<{ back: []; reset: [username: string] }>()
const username = ref(props.username), resetToken = ref(''), password = ref(''), confirmation = ref('')
const busy = ref(false), error = ref(''), copyMessage = ref('')
const deployment = ref('local')
const usernameInput = ref<HTMLInputElement>()
let active = true
const validPassword = computed(() => Array.from(password.value).length >= 15 && Array.from(password.value).length <= 128)
const commands = computed(() => {
  if (deployment.value === 'native') return 'bin/singverse --issue-password-reset'
  const compose = deployment.value === 'local'
    ? 'docker compose --env-file .env.local --project-directory . -f infra/docker/compose/compose.yaml -f infra/docker/compose/compose.local.yaml'
    : 'docker compose --project-directory . -f infra/docker/compose/compose.yaml'
  return `${compose} stop singverse-go-backend\n${compose} run --rm --no-deps singverse-go-backend --issue-password-reset\n${compose} up -d --no-deps --no-build --pull never singverse-go-backend`
})

async function focusInitial() { await nextTick(); usernameInput.value?.focus({ preventScroll: true }) }
defineExpose({ focusInitial })
onBeforeUnmount(() => { active = false; resetToken.value = ''; password.value = ''; confirmation.value = '' })

async function copyCommands() {
  let copied = false
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(commands.value); copied = true }
  } catch { /* HTTP LAN pages use the selected-text fallback below. */ }
  if (!copied) {
    const previous = document.activeElement
    const field = document.createElement('textarea')
    field.value = commands.value
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;left:-9999px;top:0'
    document.body.appendChild(field)
    field.select()
    try { copied = document.execCommand('copy') } catch { /* Manual selection remains available. */ }
    field.remove()
    if (previous instanceof HTMLElement) previous.focus({ preventScroll: true })
  }
  if (active) copyMessage.value = copied ? '命令已复制' : '请选中下方命令手动复制'
}

async function submit() {
  if (busy.value) return
  error.value = ''
  if (!username.value.trim() || !/^[A-Za-z0-9_-]{43}$/.test(resetToken.value.trim())) { error.value = '请输入账号和完整的 43 位重置码'; return }
  if (!validPassword.value) { error.value = '新密码需要 15～128 个字符'; return }
  if (password.value !== confirmation.value) { error.value = '两次输入的新密码不一致'; return }
  busy.value = true
  try {
    await authRequest('/api/v1/auth/password/reset', 'POST', { username: username.value, resetToken: resetToken.value.trim(), newPassword: password.value })
    if (!active) return
    auth.account = null
    disableAutomaticLogin()
    emit('reset', username.value)
  } catch (e) { if (active) error.value = e instanceof Error ? e.message : '密码重置失败，请重试' }
  finally { if (active) busy.value = false }
}
</script>

<template>
  <section class="login-card" aria-labelledby="login-title">
    <h1 id="login-title">忘记密码</h1>
    <p id="login-description" class="login-description">使用部署主机生成的一次性重置码，设置新的登录密码。</p>
    <details class="login-help login-recovery-guide">
      <summary>如何获取重置码</summary>
      <p>在部署主机的 Go 后端项目目录执行命令，按提示输入 RESET。重新启动服务后，在下方输入重置码；15 分钟内有效，仅能使用一次。</p>
      <label class="login-deployment-label" for="recovery-deployment">运行方式</label>
      <select id="recovery-deployment" v-model="deployment" :disabled="busy">
        <option value="local">本地源码 Docker</option><option value="docker">正式镜像 Docker</option><option value="native">原生进程</option>
      </select>
      <p v-if="deployment === 'native'">先停止业务进程，沿用原配置执行以下命令，然后重新启动业务进程。</p>
      <pre class="login-recovery-commands">{{ commands }}</pre>
      <button class="login-inline-button" type="button" @click="copyCommands">复制命令</button>
      <span class="login-copy-status" role="status">{{ copyMessage }}</span>
      <p>重置密码会退出所有设备，保留原有二次验证。若也丢失了二次验证方式，请在主机上使用管理员恢复命令。</p>
    </details>
    <div v-if="error" class="login-error" role="alert"><Warning aria-hidden="true" /><p>{{ error }}</p></div>
    <form class="login-form" :aria-busy="busy" @submit.prevent="submit">
      <div class="login-field"><label for="reset-username">账号</label><input id="reset-username" ref="usernameInput" v-model="username" name="username" autocomplete="username" maxlength="32" autocapitalize="none" spellcheck="false" :disabled="busy" required></div>
      <div class="login-field"><label for="reset-token">一次性重置码</label><input id="reset-token" v-model="resetToken" name="resetToken" type="password" autocomplete="one-time-code" maxlength="43" placeholder="粘贴部署主机生成的重置码" :disabled="busy" required></div>
      <div class="login-field"><label for="reset-password">新密码</label><input id="reset-password" v-model="password" name="newPassword" type="password" autocomplete="new-password" maxlength="256" placeholder="15～128 个字符，支持空格" :disabled="busy" required></div>
      <div class="login-field"><label for="reset-confirmation">确认新密码</label><input id="reset-confirmation" v-model="confirmation" name="confirmPassword" type="password" autocomplete="new-password" maxlength="256" placeholder="再次输入新密码" :disabled="busy" required></div>
      <button class="login-submit" type="submit" :disabled="busy || !username.trim() || !resetToken.trim() || !password || !confirmation"><span v-if="busy" class="login-spinner" aria-hidden="true" />{{ busy ? '正在重置…' : '重置密码' }}</button>
      <button class="login-text-button login-return" type="button" :disabled="busy" @click="emit('back')">返回登录</button>
    </form>
  </section>
</template>
