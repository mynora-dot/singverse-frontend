<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ value: unknown }>()
const labels: Record<string, string> = { id: '标识', name: '名称', title: '歌曲', artists: '歌手', artist: '歌手', language: '语言', album: '专辑', status: '状态', state: '状态', count: '歌曲数', total: '总计', totalElements: '总计', songCount: '歌曲数', sourceName: '媒体库', sourceId: '媒体库标识', quality: '音质', kind: '处理类型', backend: '处理引擎', selected: '收藏', description: '说明', summary: '结果', message: '说明', error: '错误', phase: '阶段', progress: '进度', completed: '已完成', failed: '失败', succeeded: '成功', merged: '合并已有任务', batchId: '批次标识', taskId: '任务标识', headline: '电视标题', subtitle: '电视说明', autoRotate: '自动轮播', rotationSeconds: '轮播间隔（秒）', handlingNote: '处理备注', resolvedSongId: '关联歌曲', enabled: '启用', model: '模型', version: '版本', dimension: '分类维度', active: '启用', type: '类型', unavailable: '不可用', missingCount: '已移除歌曲', path: '保存位置', trackIds: '歌曲标识', songIds: '歌曲标识', targets: '目标', changes: '改动', outputFormat: '输出格式', source: '来源', provider: '服务商', protocol: '协议', timeoutSeconds: '超时（秒）', maxResults: '最多结果', toolCount: '可用工具', ready: '就绪', pending: '待处理', activeTasks: '进行中任务', reviewItems: '待审核项目', durationMs: '时长（毫秒）', notes: '说明', impact: '影响' }
const states: Record<string, string> = { RUNNING: '执行中', WAITING: '等待确认', PENDING: '待处理', QUEUED: '排队中', COMPLETED: '已完成', SUCCEEDED: '已完成', FAILED: '失败', STOPPED: '已停止', CANCELLED: '已取消', INTERRUPTED: '已中断', PARTIAL: '部分完成', APPROVED: '已确认', REJECTED: '已拒绝', STALE: '内容已变化', UNCERTAIN: '需要核对', EXECUTING: '执行中', PREPARING: '准备中', LANGUAGE: '语言', DECADE: '年代', GENRE: '曲风', MOOD: '情绪', SCENE: '场景', CUSTOM: '自定义' }
const object = computed(() => props.value && typeof props.value === 'object' && !Array.isArray(props.value) ? props.value as Record<string, unknown> : null)
const collection = computed(() => {
  if (Array.isArray(props.value)) return props.value
  for (const key of ['items', 'songs', 'tracks', 'results', 'targets']) if (Array.isArray(object.value?.[key])) return object.value[key] as unknown[]
  return null
})
const fields = computed(() => Object.entries(object.value ?? {}).filter(([key, v]) => labels[key] && v != null && (typeof v !== 'object' || Array.isArray(v) && v.every(x => typeof x !== 'object'))))
const nested = computed(() => Object.entries(object.value ?? {}).filter(([key, v]) => ['batch', 'result', 'counts', 'settings', 'evidence', 'playlist', 'favorites', 'usage', 'models', 'searches', 'features', 'progress', 'statistics', 'recipe'].includes(key) && v != null && typeof v === 'object'))
function display(v: unknown): string { if (v === null || v === undefined || v === '') return '—'; if (typeof v === 'boolean') return v ? '是' : '否'; if (Array.isArray(v)) return v.map(display).join('、'); return states[String(v)] ?? String(v) }
function itemName(v: unknown, i: number) { if (typeof v !== 'object' || v === null) return display(v); const r = v as Record<string, unknown>; return display(r.title || r.name || r.songTitle || r.id || `项目 ${i + 1}`) }
function itemDetail(v: unknown) { if (!v || typeof v !== 'object') return ''; const r = v as Record<string, unknown>; return [r.artists || r.artist, r.language, r.status || r.state, r.sourceName].filter(Boolean).map(display).join(' · ') }
</script>
<template>
  <div class="result-content">
    <ul v-if="collection" class="result-items"><li v-for="(item, index) in collection.slice(0, 100)" :key="index"><span class="result-item-order">{{ index + 1 }}</span><div><strong>{{ itemName(item, index) }}</strong><small v-if="itemDetail(item)">{{ itemDetail(item) }}</small></div></li><li v-if="!collection.length" class="result-empty">没有符合条件的项目</li><li v-if="collection.length > 100">其余 {{ collection.length - 100 }} 项请在业务页面查看</li></ul>
    <details v-if="collection?.some(item => item && typeof item === 'object' && 'id' in item)" class="result-identities"><summary>查看对象标识（{{ collection.length }} 项）</summary><div v-for="(item, index) in collection" :key="index"><template v-if="item && typeof item === 'object' && 'id' in item"><strong>{{ itemName(item, index) }}</strong><code>{{ item.id }}</code></template></div></details>
    <dl v-if="fields.length"><template v-for="([key, value]) in fields" :key="key"><dt>{{ labels[key] }}</dt><dd>{{ display(value) }}</dd></template></dl>
    <ResultContent v-for="([key, value]) in nested" :key="key" :value="value" />
    <p v-if="typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'">{{ display(value) }}</p>
    <p v-if="object && !fields.length && !collection && !nested.length" class="result-empty">详细结果请打开业务页面查看。</p>
  </div>
</template>
<style scoped>
.result-identities{font-size:12px;color:var(--sv-text-secondary)}.result-identities summary{display:flex;align-items:center;min-height:44px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.result-identities>div{padding:6px 0}.result-identities strong{font-weight:500}.result-identities code{display:block;overflow-wrap:anywhere;font-size:12px}
.result-content{font-size:14px;line-height:1.65;min-width:0}.result-items{list-style:none;padding:0;margin:0}.result-items li{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid var(--sv-border-subtle)}.result-items li:last-child{border-bottom:0}.result-item-order{width:22px;flex-shrink:0;color:var(--sv-text-secondary);font-variant-numeric:tabular-nums}.result-items strong{font-size:14px;font-weight:550;overflow-wrap:anywhere}.result-items small{display:block;color:var(--sv-text-secondary);font-size:13px;margin-top:3px}.result-items code{display:block;font-family:inherit;font-size:12px;color:var(--sv-text-secondary);margin-top:4px;overflow-wrap:anywhere}.result-items li>div{min-width:0}.result-empty{color:var(--sv-text-secondary);padding:12px 0}dl{display:grid;grid-template-columns:minmax(80px,130px) minmax(0,1fr);gap:9px 16px;margin:12px 0}dt{color:var(--sv-text-secondary)}dd{margin:0;overflow-wrap:anywhere}p{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
