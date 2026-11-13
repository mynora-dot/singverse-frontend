<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElAlert, ElButton, ElDialog, ElPagination } from 'element-plus'
import { authRequest } from '../../../core/auth/api'
import { base, type Batch, type BatchItem } from '../api'
import { backendName, failure, isRecognition, itemStates, profileName, recognitionName } from '../presentation'

const props = defineProps<{ batch?: Batch; ready: boolean; busy: boolean; error?: string }>()
const emit = defineEmits<{ start: []; close: []; cancel: [] }>()
const preparing = computed(() => props.batch?.state === 'PREPARING')
const pending = computed(() => props.batch?.counts.PENDING || 0)
const recognizing = computed(() => isRecognition(props.batch))
const items = ref<BatchItem[]>([]), itemPage = ref(0), itemsLoading = ref(false), itemsError = ref('')
let itemRequest = 0
async function loadItems() {
  const id = props.batch?.id, turn = ++itemRequest
  if (!id || props.batch?.state !== 'PREVIEW') return
  itemsLoading.value = true; itemsError.value = ''
  try {
    const value = await authRequest<Batch>(`${base}/batches/${encodeURIComponent(id)}?page=${itemPage.value}`)
    if (turn === itemRequest) items.value = value.items || []
  } catch (error) { if (turn === itemRequest) itemsError.value = failure(error, '无法读取歌曲明细') }
  finally { if (turn === itemRequest) itemsLoading.value = false }
}
function changePage(next: number) { itemPage.value = next; void loadItems() }
watch(() => props.batch?.state === 'PREVIEW' ? props.batch.id : '', id => {
  itemRequest++; items.value = []; itemPage.value = 0; itemsError.value = ''; itemsLoading.value = false
  if (id && props.batch?.items) items.value = props.batch.items
  else if (id) void loadItems()
}, { immediate: true })
onBeforeUnmount(() => { itemRequest++ })
function itemReason(item: BatchItem) {
  if (item.error) return item.error
  if (item.state === 'PENDING') return item.category === 'UNPROBED' ? '先读取音轨，确认适用后处理' : recognizing.value ? '识别已有音轨' : '生成独立伴奏'
  if (item.state === 'SKIPPED') return ({ READY: recognizing.value ? '已有确认标记，予以保留' : '已有伴奏', PROCESSING: '已有处理任务', INAPPLICABLE: recognizing.value ? '仅双音轨支持自动区分原唱与伴奏' : '音轨数量不适用分离，请先检查已有音轨' } as Record<string, string>)[item.category] || '当前状态无需处理'
  return itemStates[item.state] || item.state
}
const skipped = computed(() => {
  const c = props.batch?.categories || {}
  if (recognizing.value) return [['已有确认标记，予以保留', c.READY], ['已有识别任务', c.PROCESSING], ['不是双音轨，无需区分', c.INAPPLICABLE]].filter(([, count]) => count) as [string, number][]
  return [['已有伴奏', c.READY], ['正在生成', c.PROCESSING], ['多音轨或无音轨，不需要生成', c.INAPPLICABLE]].filter(([, count]) => count) as [string, number][]
})
</script>

<template>
  <ElDialog :model-value="!!batch" :title="recognizing ? '确认批量自动识别' : '确认生成伴奏'" width="min(520px, 94vw)" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @close="emit('close')">
    <template v-if="batch">
      <ElAlert v-if="error" :title="error" type="error" :closable="false" show-icon role="alert" class="preview-error" />
      <p v-if="preparing" class="lead" role="status">正在准备所选歌曲：{{ batch.prepared ?? 0 }} / {{ batch.selectionTotal ?? batch.total }}。准备完成后请确认开始。</p>
      <p v-else-if="batch.state === 'FAILED'" class="lead" role="alert">{{ batch.error || '歌曲准备失败，请重新选择歌曲后重试。' }}</p>
      <p v-else-if="batch.state === 'CANCELLED'" class="lead">已取消准备。</p>
      <p v-else class="lead">将为 <strong>{{ pending }}</strong> 首歌曲{{ recognizing ? '重新识别原唱与伴奏' : '生成独立伴奏' }}。</p>
      <div v-if="batch.state === 'PREVIEW'" class="preview-totals" :class="{ 'has-failed': batch.counts.FAILED }"><div><span>本次选择</span><strong>{{ batch.total }}<small>首</small></strong></div><div><span>可处理</span><strong>{{ pending }}<small>首</small></strong></div><div><span>跳过</span><strong>{{ batch.counts.SKIPPED || 0 }}<small>首</small></strong></div><div v-if="batch.counts.FAILED"><span>准备失败</span><strong>{{ batch.counts.FAILED }}<small>首</small></strong></div></div>
      <p v-if="recognizing" class="muted">方式：{{ recognitionName(batch.kind) }}。{{ batch.kind === 'FAST' ? '按音轨标签和短片段人声判断，不生成新的伴奏文件。' : '分离多个片段的人声进行对比，耗时较长。' }}只有判断可靠时才自动保存标记，无法确定的保留待人工确认。</p>
      <p v-else class="muted">方案：{{ profileName(batch.separationProfile) }} · {{ batch.outputFormat === 'flac' ? 'FLAC' : 'AAC 192k' }}</p>
      <p v-if="!recognizing && batch.separationProfile === 'DSP_FAST'" class="muted">中心抵消也可能削弱鼓、贝斯和主奏，并留下混响。建议先对代表歌曲进行短片试听。</p>
      <ul v-if="batch.state === 'PREVIEW'" class="breakdown">
        <li v-if="recognizing && batch.categories.UNCONFIRMED">重新识别 {{ batch.categories.UNCONFIRMED }} 首（双音轨、尚未确认）</li>
        <li v-if="!recognizing && batch.categories.ELIGIBLE">直接生成 {{ batch.categories.ELIGIBLE }} 首（单音轨）</li>
        <li v-if="batch.categories.UNPROBED">先读取音轨 {{ batch.categories.UNPROBED }} 首，{{ recognizing ? '确认有两条音轨后再自动识别' : '确认只有一条音轨后才生成' }}</li>
        <li v-for="[reason, count] in skipped" :key="reason" class="muted">跳过 {{ count }} 首：{{ reason }}</li>
      </ul>
      <section v-if="batch.state === 'PREVIEW'" class="preview-songs" aria-label="本次处理歌曲明细" :aria-busy="itemsLoading">
        <h3>歌曲明细</h3><p v-if="itemsLoading" class="muted" role="status">正在读取歌曲明细…</p>
        <ElAlert v-if="itemsError" :title="itemsError" type="error" :closable="false"><ElButton link @click="loadItems">重试明细</ElButton></ElAlert>
        <ul v-else><li v-for="item in items" :key="item.song_id"><span><strong>{{ item.title }}</strong><small>{{ itemReason(item) }}</small></span><span class="item-outcome" :class="{ 'is-pending': item.state === 'PENDING' }">{{ item.state === 'PENDING' ? '可处理' : itemStates[item.state] || item.state }}</span></li></ul>
        <ElPagination v-if="batch.total > 50" :current-page="itemPage + 1" :page-size="50" :pager-count="5" :total="batch.total" layout="prev, pager, next" @current-change="changePage($event - 1)" />
      </section>
      <p v-if="recognizing" class="muted">任务在后台逐首处理，可关闭页面，稍后到“识别任务”查看结果或停止。已有确认标记会保留。</p>
      <p v-else class="muted">使用设备：{{ batch.backend ? backendName(batch.backend) : '自动选择已通过试跑的设备' }}。生成在后台进行，可以随时在“生成任务”中查看或停止；已生成的伴奏会保留。</p>
      <p v-if="batch.state === 'PREVIEW' && !pending" class="muted">{{ recognizing ? '所选歌曲中没有需要自动识别的双音轨或待读取歌曲。' : '所选歌曲都不需要生成。' }}</p>
    </template>
    <template #footer>
      <ElButton :disabled="busy" @click="emit('close')">返回</ElButton>
      <ElButton v-if="preparing" :disabled="busy" @click="emit('cancel')">取消准备</ElButton>
      <ElButton type="primary" :loading="busy" :disabled="busy || itemsLoading || !!itemsError || batch?.state !== 'PREVIEW' || !ready || !pending" @click="emit('start')">{{ recognizing ? '开始识别' : '开始生成' }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.lead{margin:0 0 12px;font-size:15px;color:var(--sv-text-primary)}.breakdown{margin:0 0 12px;padding-left:20px;display:grid;gap:4px;font-size:var(--sv-font-body)}.muted{margin:0;font-size:var(--sv-font-meta);line-height:1.6;color:var(--sv-text-secondary)}
.preview-totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 20px;padding:16px;border:1px solid var(--sv-border-subtle);border-radius:8px;background:var(--sv-surface-1)}.preview-totals>div{display:grid;gap:6px}.preview-totals span{font-size:12px;color:var(--sv-text-secondary)}.preview-totals strong{font-size:24px;line-height:1.3;color:var(--sv-text-primary);font-weight:600}.preview-totals small{margin-left:4px;font-size:12px;font-weight:400;color:var(--sv-text-secondary)}.breakdown{margin-top:16px;padding-left:20px;gap:8px}.preview-error{margin-bottom:16px}.muted+.muted{margin-top:12px}
.preview-songs{margin:20px 0}.preview-songs h3{margin:0 0 8px;font-size:14px;font-weight:600;color:var(--sv-text-primary)}.preview-songs ul{max-height:240px;overflow-y:auto;padding:0;margin:0;list-style:none;border-block:1px solid var(--sv-border-subtle)}.preview-songs li{display:flex;align-items:center;gap:16px;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--sv-border-subtle)}.preview-songs li:last-child{border:0}.preview-songs li>span:first-child{min-width:0}.preview-songs strong{display:block;font-size:14px;font-weight:500;color:var(--sv-text-primary);overflow-wrap:anywhere}.preview-songs small{display:block;margin-top:4px;font-size:13px;line-height:1.6;color:var(--sv-text-secondary);overflow-wrap:anywhere}.item-outcome{flex:none;font-size:12px;color:var(--sv-text-secondary)}.item-outcome.is-pending{color:var(--sv-accent-primary)}.preview-songs :deep(.el-pagination){justify-content:center;margin-top:8px}
.preview-totals.has-failed{grid-template-columns:repeat(4,minmax(0,1fr))}
@media(max-width:560px){.lead,.breakdown,.muted{font-size:16px}.preview-totals{padding:12px;gap:8px}.preview-totals span,.preview-totals small{font-size:13px}}
:global(.el-dialog:has(.preview-totals) .el-dialog__footer .el-button){min-height:44px}
.muted{font-size:14px}
@media(max-width:560px){.muted{font-size:16px}}
</style>
