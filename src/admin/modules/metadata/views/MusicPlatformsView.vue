<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElAlert, ElButton, ElMessage, ElMessageBox, ElSkeleton } from 'element-plus'
import PageHeader from '../../../shared/ui/PageHeader.vue'
import { metadata } from '../api/metadata'
import { metadataDefaults, providerNames, type MetadataSettings, type MusicProvider } from '../types'

const route = useRoute()
const router = useRouter()
const platforms = Object.keys(providerNames) as MusicProvider[]
type SettingsDraft = MetadataSettings & Required<Pick<MetadataSettings, 'minIntervalSeconds' | 'maxIntervalSeconds'>>
const config = ref<SettingsDraft>({ enabled: true, providers: [...platforms], autoApply: false, ...metadataDefaults })
const ready = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const baseline = ref('')
const locked = computed(() => busy.value || loading.value)
const dirty = computed(() => ready.value && JSON.stringify(config.value) !== baseline.value)
const validation = computed(() => {
  const { enabled, providers, threshold, minIntervalSeconds, maxIntervalSeconds } = config.value
  const intervalValid = Number.isInteger(minIntervalSeconds) && Number.isInteger(maxIntervalSeconds)
    && minIntervalSeconds >= 0 && maxIntervalSeconds <= 300 && minIntervalSeconds <= maxIntervalSeconds
  return {
    providers: enabled && !providers.length ? '请至少选择一个平台，或关闭平台查询。' : '',
    threshold: Number.isFinite(threshold) && threshold >= .8 && threshold <= 1 ? '' : '阈值需要在 80%～100% 之间。',
    interval: intervalValid ? '' : '请求间隔需要在 0～300 秒之间，最大值不能小于最小值。',
  }
})
const invalid = computed(() => Object.values(validation.value).some(Boolean))
const thresholdPercent = computed({
  get: () => Math.round(config.value.threshold * 100),
  set: value => { config.value.threshold = Number(value) / 100 },
})
const returnTo = computed(() => typeof route.query.returnTo === 'string' && /^\/(library(?:\/|\?|$)|system\/tasks(?:\/|\?|$))/.test(route.query.returnTo) ? route.query.returnTo : '/library/songs/metadata')
let active = true

function applySavedSettings(settings: MetadataSettings) {
  config.value = {
    ...settings,
    providers: [...settings.providers],
    minIntervalSeconds: settings.minIntervalSeconds ?? metadataDefaults.minIntervalSeconds,
    maxIntervalSeconds: settings.maxIntervalSeconds ?? metadataDefaults.maxIntervalSeconds,
  }
  baseline.value = JSON.stringify(config.value)
  ready.value = true
}

async function load() {
  if (locked.value || dirty.value) return
  loading.value = true
  error.value = ''
  try {
    const settings = await metadata.settings()
    if (active) applySavedSettings(settings)
  } catch (failure) {
    if (active) error.value = failure instanceof Error ? failure.message : '音乐平台读取失败，请重试。'
  } finally {
    if (active) loading.value = false
  }
}

function enableAll() {
  config.value.enabled = true
  config.value.providers = [...platforms]
}

async function save() {
  if (locked.value || !dirty.value || invalid.value) return
  busy.value = true
  error.value = ''
  try {
    const status = await metadata.latest().then(batch => batch?.status, () => 'UNKNOWN')
    if (!active) return
    if (status === 'RUNNING' || status === 'UNKNOWN') {
      const running = status === 'RUNNING'
      const message = running
        ? '保存会暂停当前匹配批次。已写入的结果会保留，可在歌曲信息页继续。'
        : '暂时无法读取匹配任务状态。保存会暂停正在运行的匹配批次，可在歌曲信息页继续。'
      try {
        await ElMessageBox.confirm(message, running ? '保存并暂停批次' : '确认保存设置', {
          confirmButtonText: running ? '保存并暂停' : '保存设置',
          cancelButtonText: '继续编辑',
        })
      } catch {
        return
      }
    }
    if (!active) return
    const result = await metadata.saveSettings({ ...config.value, providers: [...config.value.providers] })
    if (!active) return
    applySavedSettings(result)
    ElMessage.success('音乐平台设置已保存')
  } catch (failure) {
    if (active) error.value = failure instanceof Error ? failure.message : '保存失败，修改已保留，可重试。'
  } finally {
    if (active) busy.value = false
  }
}

async function canLeave() {
  if (busy.value) { ElMessage.info('正在保存设置，请稍候'); return false }
  if (!dirty.value) return true
  try { await ElMessageBox.confirm('离开会放弃尚未保存的音乐平台设置。', '有未保存的设置', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑' }); return true } catch { return false }
}
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) event.preventDefault() }
onBeforeRouteLeave(canLeave)
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => { active = false; window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <section class="music-platforms-page">
    <PageHeader title="音乐平台">
      <template #actions>
        <ElButton :disabled="busy" @click="router.push(returnTo)">
          {{ route.query.returnTo ? '返回原页面' : '查看歌曲信息' }}
        </ElButton>
      </template>
    </PageHeader>
    <ElAlert v-if="error && !ready" :title="error" type="error" :closable="false" show-icon>
      <ElButton text @click="load">重新读取</ElButton>
    </ElAlert>
    <div v-if="loading" class="platform-loading sv-glass" role="status">
      <span class="sr-only">正在读取音乐平台设置</span>
      <ElSkeleton :rows="5" animated aria-hidden="true" />
    </div>
    <form v-if="ready" class="platform-form sv-glass" aria-label="音乐平台设置" :aria-busy="busy" @submit.prevent="save">
      <fieldset class="platform-sections" :disabled="locked">
        <section class="platform-panel" aria-labelledby="platform-query-title">
          <div class="platform-heading">
            <h2 id="platform-query-title"><label for="platform-query">平台查询</label></h2>
            <div class="platform-switch">
              <input id="platform-query" v-model="config.enabled" type="checkbox" name="enabled" role="switch" />
              <span class="platform-switch-track" aria-hidden="true"></span>
            </div>
          </div>
          <div class="platform-options" role="group" aria-label="查询平台" :aria-describedby="validation.providers ? 'platform-provider-error' : undefined">
            <label v-for="platform in platforms" :key="platform" class="platform-option">
              <img :src="`/assets/music-platforms/${platform.toLowerCase()}.png`" alt="" width="18" height="18" />
              <span>{{ providerNames[platform] }}</span>
              <input v-model="config.providers" type="checkbox" name="providers" :value="platform" />
            </label>
          </div>
          <p v-if="validation.providers" id="platform-provider-error" class="platform-error" role="alert">{{ validation.providers }}</p>
          <div class="platform-selection-action">
            <ElButton text type="primary" :disabled="locked || (config.enabled && config.providers.length === platforms.length)" @click="enableAll">
              启用全部平台
            </ElButton>
          </div>
        </section>
        <section class="platform-panel" aria-labelledby="platform-batch-title">
          <div class="platform-heading">
            <h2 id="platform-batch-title">批量匹配</h2>
          </div>
          <div class="platform-setting">
            <label for="platform-auto-apply">自动应用高相似度候选</label>
            <div class="platform-switch">
              <input id="platform-auto-apply" v-model="config.autoApply" type="checkbox" name="autoApply" role="switch" />
              <span class="platform-switch-track" aria-hidden="true"></span>
            </div>
          </div>
          <div class="platform-setting">
            <label for="platform-threshold">匹配阈值<span class="sr-only">（百分比）</span></label>
            <div class="platform-value">
              <input
                id="platform-threshold" v-model.number="thresholdPercent" name="threshold"
                type="number" inputmode="numeric" min="80" max="100" step="1" required
                :aria-invalid="!!validation.threshold"
                :aria-describedby="validation.threshold ? 'platform-threshold-error' : undefined"
              />
              <span aria-hidden="true">%</span>
            </div>
            <p v-if="validation.threshold" id="platform-threshold-error" class="platform-error" role="alert">{{ validation.threshold }}</p>
          </div>
          <div class="platform-setting" role="group" aria-labelledby="platform-interval-label">
            <span id="platform-interval-label">每首歌后等待</span>
            <div class="platform-value">
              <input
                v-model.number="config.minIntervalSeconds" name="minIntervalSeconds" aria-label="最短请求间隔（秒）"
                type="number" inputmode="numeric" min="0" max="300" step="1" required
                :aria-invalid="!!validation.interval"
                :aria-describedby="validation.interval ? 'platform-interval-error' : undefined"
              />
              <span aria-hidden="true">至</span>
              <input
                v-model.number="config.maxIntervalSeconds" name="maxIntervalSeconds" aria-label="最长请求间隔（秒）"
                type="number" inputmode="numeric" min="0" max="300" step="1" required
                :aria-invalid="!!validation.interval"
                :aria-describedby="validation.interval ? 'platform-interval-error' : undefined"
              />
              <span aria-hidden="true">秒</span>
            </div>
            <p v-if="validation.interval" id="platform-interval-error" class="platform-error" role="alert">{{ validation.interval }}</p>
          </div>
        </section>
      </fieldset>
      <footer class="platform-save">
        <p v-if="error" class="platform-error" role="alert">{{ error }}</p>
        <ElButton type="primary" native-type="submit" :loading="busy" :disabled="locked || !dirty || invalid">保存设置</ElButton>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.music-platforms-page {
  --platform-gutter: clamp(12px, 2.4vw, 28px);
  max-width: 1120px;
}

.platform-loading { padding: var(--platform-gutter); }

.platform-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}

.platform-panel {
  min-width: 0;
  padding: 16px var(--platform-gutter);
}

.platform-panel + .platform-panel { border-inline-start: 1px solid var(--sv-border-subtle); }

.platform-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  margin-bottom: 8px;
}

.platform-heading h2 { font-size: 17px; }
.platform-heading label, .platform-setting label { cursor: pointer; }
.platform-switch {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
}
.platform-switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.platform-switch-track {
  display: flex;
  align-items: center;
  width: 100%;
  height: 22px;
  padding: 2px;
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius-full);
  background: var(--sv-surface-3);
  pointer-events: none;
}
.platform-switch-track::before {
  content: '';
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--sv-text-secondary);
}
.platform-switch input:checked + .platform-switch-track {
  justify-content: flex-end;
  border-color: var(--sv-accent-primary);
  background: var(--sv-accent-primary);
}
.platform-switch input:checked + .platform-switch-track::before { background: var(--sv-on-accent); }
.platform-switch input:focus-visible + .platform-switch-track { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.platform-switch input:disabled { cursor: default; }
.platform-switch input:disabled + .platform-switch-track { opacity: .55; }

@media (forced-colors: active) {
  .platform-switch input { opacity: 1; }
  .platform-switch-track { display: none; }
}

.platform-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--sv-border-subtle);
  border-radius: var(--sv-radius-md);
  background: var(--sv-border-subtle);
}

.platform-option {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 8px 12px;
  background: var(--sv-surface-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.platform-option img { object-fit: contain; border-radius: 4px; }
.platform-option span { overflow-wrap: anywhere; }
.platform-option input { width: 17px; height: 17px; margin: 0; accent-color: var(--sv-accent-primary); cursor: inherit; }
.platform-option:has(:disabled) { cursor: default; }
.platform-option:hover:not(:has(:disabled)) { background: var(--sv-surface-1); }
.platform-option:has(:focus-visible) { outline: 2px solid var(--sv-accent-primary); outline-offset: -2px; }
.platform-option input:focus-visible { outline: none; }

.platform-selection-action { display: flex; justify-content: flex-end; margin-top: 4px; }

.platform-setting {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 12px;
  min-height: 64px;
  padding-block: 8px;
  border-top: 1px solid var(--sv-border-subtle);
  font-size: 14px;
  font-weight: 500;
}

.platform-value { display: flex; align-items: center; gap: 8px; }
.platform-value span { min-width: 1em; color: var(--sv-text-secondary); font-size: 13px; text-align: center; }
.platform-value input {
  width: clamp(56px, 7vw, 76px);
  min-height: 44px;
  padding: 6px 8px;
  border: 1px solid var(--sv-border-strong);
  border-radius: var(--sv-radius-md);
  background: var(--sv-surface-2);
  color: var(--sv-text-primary);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.platform-value input:focus-visible { outline-offset: 2px; }
.platform-value input[aria-invalid='true'] { border-color: var(--sv-semantic-danger); }
.platform-error { margin-block: 6px 0; color: var(--sv-semantic-danger); font-size: 13px; overflow-wrap: anywhere; }
.platform-setting > .platform-error { grid-column: 1 / -1; margin-block: 0; }

.platform-save {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px var(--platform-gutter);
  border-top: 1px solid var(--sv-border-subtle);
}

.platform-save .platform-error { flex: 1 1 200px; margin-block: 0; }
.music-platforms-page :deep(.el-button) { min-height: 44px; }

@media (max-width: 760px) {
  .platform-sections { grid-template-columns: minmax(0, 1fr); }
  .platform-panel + .platform-panel { border-inline-start: 0; border-top: 1px solid var(--sv-border-subtle); }
}

@media (max-width: 420px) {
  .platform-option { gap: 6px; padding-inline: 6px; }
  .platform-option img, .platform-option input { width: 16px; height: 16px; }
  .platform-value { gap: 6px; }
  .platform-save :deep(.el-button) { flex: 1 1 auto; }
}
</style>
