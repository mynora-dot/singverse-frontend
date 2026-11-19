<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'
import { ElAlert, ElButton, ElTag } from 'element-plus'
import { readRelease, reachableOrigin, type ClientRelease, type Platform } from './api'
const origin = window.location.origin
const canShare = reachableOrigin(origin)
const platforms: { id: Platform; title: string; description: string; minimum: string }[] = [
  { id: 'mobile', title: '手机端', description: '连接家庭曲库，在手机上练唱、录音和管理作品。', minimum: 'Android 7.0 / API 24' },
  { id: 'tv', title: '电视端', description: '安装到 Android 电视，连接 NAS 后点歌和播放。', minimum: 'Android 5.0 / API 21' },
]
const states = reactive<Record<Platform, { release: ClientRelease | null; abi: string; loading: boolean; error: string }>>({
  mobile: { release: null, abi: '', loading: false, error: '' }, tv: { release: null, abi: '', loading: false, error: '' },
})
const selected = computed(() => Object.fromEntries(platforms.map(({ id }) => {
  const state = states[id], release = state.release
  const variant = release?.variants?.find(variant => variant.abi === state.abi)
  return [id, variant ? { ...release, ...variant, abis: [variant.abi] } : release]
})) as Record<Platform, ClientRelease | null>)
function abiLabel(abi: string) { return ({ 'arm64-v8a': 'ARM64（64 位）', 'armeabi-v7a': 'ARMv7（32 位）', x86: 'x86（32 位）', x86_64: 'x86_64（64 位）' } as Record<string, string>)[abi] ?? abi }
let active = true
async function load(platform: Platform) {
  const state = states[platform]
  if (state.loading) return
  state.loading = true; state.error = ''; state.release = null
  try {
    const release = await readRelease(platform)
    if (active) { state.release = release; state.abi = release.abis?.[0] ?? release.variants?.[0]?.abi ?? '' }
  }
  catch (error) { if (active) state.error = error instanceof Error ? error.message : '安装包信息读取失败' }
  finally { if (active) state.loading = false }
}
function qr(platform: Platform) { return `/api/v1/client-releases/${platform}/qr?origin=${encodeURIComponent(origin)}` }
function size(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MB` }
onMounted(() => { for (const platform of platforms) void load(platform.id) })
onBeforeUnmount(() => { active = false })
</script>
<template>
  <div class="client-downloads">
    <ElAlert v-if="!canShare" title="当前使用本机地址，其他设备无法通过此地址访问。" description="请改用手机和电视可达的 NAS 局域网地址打开此页，再扫描二维码。" type="warning" :closable="false" show-icon />
    <div class="download-grid">
      <article v-for="platform in platforms" :id="platform.id" :key="platform.id" class="sv-panel download-card">
        <div class="download-title"><h2>{{ platform.title }}</h2><ElTag effect="plain">{{ platform.minimum }}</ElTag></div>
        <p>{{ platform.description }}</p>
        <p v-if="states[platform.id].loading" role="status">正在读取安装包…</p>
        <template v-else-if="states[platform.id].error">
          <ElAlert :title="states[platform.id].error" type="error" :closable="false" show-icon />
          <ElButton @click="load(platform.id)">重新读取{{ platform.title }}安装包</ElButton>
        </template>
        <template v-else-if="states[platform.id].release?.available">
          <label v-if="states[platform.id].release?.variants?.length" class="abi-picker">处理器架构
            <select v-model="states[platform.id].abi" :aria-label="`${platform.title}处理器架构`">
              <option v-for="variant in states[platform.id].release!.variants" :key="variant.abi" :value="variant.abi">{{ abiLabel(variant.abi) }}</option>
            </select>
          </label>
          <dl>
            <div><dt>版本</dt><dd>{{ selected[platform.id]!.versionName }} <small>（{{ selected[platform.id]!.versionCode }}）</small></dd></div>
            <div><dt>安装包</dt><dd>{{ size(selected[platform.id]!.size!) }} · {{ selected[platform.id]!.abis!.join(' / ') }}</dd></div>
            <div><dt>最低系统</dt><dd>Android API {{ selected[platform.id]!.minSdk }}</dd></div>
          </dl>
          <p v-if="selected[platform.id]!.notes" class="release-notes">{{ selected[platform.id]!.notes }}</p>
          <a class="el-button el-button--primary download-link" :href="selected[platform.id]!.url" download>下载{{ platform.title }} APK</a>
          <figure v-if="canShare" class="download-qr"><img :src="qr(platform.id)" :alt="`${platform.title}安装包下载二维码`" width="176" height="176"><figcaption>使用手机扫码下载，电视也可通过 U 盘安装</figcaption></figure>
          <details><summary>查看安装包校验信息</summary><p>SHA-256</p><code>{{ selected[platform.id]!.sha256 }}</code><p>签名证书 SHA-256</p><code>{{ selected[platform.id]!.certificateSha256 }}</code></details>
        </template>
        <p v-else class="muted">当前管理平台尚未提供{{ platform.title }}安装包，请联系管理员更新平台镜像。</p>
      </article>
    </div>
    <p class="download-note">安装包由当前 NAS 提供。首次安装时，按 Android 系统提示允许安装应用；安装和更新由你确认。微信内无法下载安装时，请在系统浏览器中打开。</p>
  </div>
</template>
<style scoped>
.client-downloads { display: grid; gap: 20px; }
.download-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.download-card { padding: 24px; display: flex; flex-direction: column; gap: 18px; }
.download-card h2 { margin: 0; font-size: 22px; }
.download-title { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.download-card p { margin: 0; line-height: 1.7; color: var(--sv-text-secondary); }
.download-card dl { margin: 0; display: grid; gap: 10px; }
.download-card dl div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 12px; }
.download-card dt, .download-note { color: var(--sv-text-secondary); }
.download-card dd { margin: 0; overflow-wrap: anywhere; }
.abi-picker { display: grid; gap: 8px; font-size: 14px; }
.abi-picker select { font: inherit; padding: 8px; max-width: 260px; }
.download-link { align-self: flex-start; text-decoration: none; }
.download-qr { margin: 0; display: grid; justify-items: start; gap: 8px; }
.download-qr img { background: white; border-radius: 8px; }
.download-qr figcaption { font-size: 13px; color: var(--sv-text-secondary); }
.download-card details { font-size: 12px; line-height: 1.7; }
.download-card summary { cursor: pointer; }
.download-card code { display: block; overflow-wrap: anywhere; }
.release-notes { white-space: pre-wrap; }
.download-note { margin: 0; font-size: 13px; line-height: 1.8; }
@media (max-width: 760px) { .download-grid { grid-template-columns: 1fr; } .download-card { padding: 20px; } }
</style>
