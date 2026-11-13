<script setup lang="ts">
import { computed } from 'vue'
import { ElProgress } from 'element-plus'
import { Check, Clock, Headset, InfoFilled, Warning } from '@element-plus/icons-vue'
import type { BackgroundTask } from './api'
import { activeTask, childTaskCount, date, frameProgress, isScan, progressText, stageName, statusNames } from './presentation'

const props = defineProps<{ task: BackgroundTask }>()
const scanPipeline = computed(() => props.task.isBatch && isScan(props.task)
  && ['WAITING_RECOGNITION', 'RECOGNIZING'].includes(props.task.stage))
const scanned = computed(() => props.task.operation.status === 'COMPLETED')
const processing = computed(() => props.task.stage === 'RECOGNIZING')
const registered = computed(() => childTaskCount(props.task))
const pending = computed(() => props.task.childrenCounts.pendingDiscovery || 0)
const scanProgress = computed(() => progressText({ ...props.task, stage: props.task.operation.stage, progress: props.task.operation.progress }))
const phases = computed(() => [
  {
    label: scanned.value ? '扫描完成' : props.task.operation.status === 'FAILED' ? '扫描失败' : props.task.operation.status === 'INTERRUPTED' ? '扫描已中断' : activeTask(props.task.operation.status) ? '扫描' + statusNames[props.task.operation.status] : '扫描状态未记录',
    description: scanProgress.value,
    state: scanned.value ? 'done' : ['FAILED', 'INTERRUPTED'].includes(props.task.operation.status) ? 'error' : 'future',
    icon: scanned.value ? Check : ['FAILED', 'INTERRUPTED'].includes(props.task.operation.status) ? Warning : InfoFilled,
  },
  { label: '等待后续处理', description: processing.value ? '已进入后续处理' : '当前阶段',
    state: processing.value ? 'done' : 'current', icon: processing.value ? Check : Clock },
  { label: '音轨处理', description: processing.value ? '后续任务正在处理' : registered.value ? '已登记后续任务' : '尚未创建子任务',
    state: processing.value ? 'current' : 'future', icon: Headset },
])
</script>

<template>
  <div class="task-progress-overview">
    <div class="progress-heading">
      <h2>{{ stageName(task.stage) }}</h2>
      <span v-if="isScan(task)" class="progress-scope"><Headset aria-hidden="true" />{{ progressText(task) }}</span>
    </div>
    <template v-if="scanPipeline">
      <p class="progress-description">{{ processing ? '扫描与音轨处理分别记录，下面显示当前所处阶段。' : '批次正在等待后续音轨处理，可在下方查看已登记的任务。' }}</p>
      <ol class="task-phase-track" aria-label="批次处理阶段">
        <li v-for="phase in phases" :key="phase.label" :class="'phase-' + phase.state" :aria-current="phase.state === 'current' ? 'step' : undefined">
          <span class="phase-marker"><component :is="phase.icon" aria-hidden="true" /></span>
          <strong>{{ phase.label }}</strong><span class="phase-description">{{ phase.description }}</span>
        </li>
      </ol>
      <div class="task-waiting-note">
        <InfoFilled aria-hidden="true" />
        <div><strong>{{ pending ? pending + ' 首等待后续阶段判断或创建' : registered ? '后续任务已登记' : '尚未创建子任务' }}</strong>
          <p>已发现的歌曲数量不等于子任务数量。{{ task.waitingReason || (registered ? '具体处理状态见下方任务明细。' : '后续任务创建后，将在下方显示具体任务。') }}</p>
        </div>
      </div>
    </template>
    <div v-else class="task-current-progress" aria-live="polite">
      <p>{{ progressText(task) }}</p>
      <ElProgress v-if="task.progress.percent !== null" :percentage="Math.floor(task.progress.percent)" :stroke-width="6" />
      <p v-if="task.waitingReason" class="progress-description">{{ task.waitingReason }}</p>
    </div>
    <p v-if="frameProgress(task.execution)" class="progress-description">{{ frameProgress(task.execution) }}；此为当前阶段进度。</p>
    <p v-if="isScan(task)" class="task-scan-record">扫描自身：{{ statusNames[task.operation.status] || task.operation.businessStatus || '未记录' }} · {{ stageName(task.operation.stage) }} · {{ scanProgress }}<template v-if="task.operation.finishedAt"> · 完成于 {{ date(task.operation.finishedAt) }}</template></p>
  </div>
</template>

<style scoped>
.progress-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
.progress-heading h2{margin:0;font-size:18px;font-weight:600;line-height:1.5}
.progress-scope{display:flex;align-items:center;gap:8px;flex:none;color:var(--sv-text-secondary);font-size:14px;line-height:27px}
.progress-scope svg{width:18px;height:18px;color:var(--sv-accent-primary)}
.progress-description,.task-scan-record{margin:10px 0 0;color:var(--sv-text-secondary);font-size:14px;line-height:1.7}
.task-phase-track{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;list-style:none;padding:0;margin:28px 0 24px}
.task-phase-track li{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0}
.task-phase-track li:not(:last-child):after{content:'';position:absolute;top:18px;left:44px;right:-6px;height:1px;background:var(--sv-border-default)}
.phase-marker{display:grid;place-items:center;width:36px;height:36px;margin-bottom:2px;border:1px solid var(--sv-border-default);border-radius:50%;background:var(--sv-surface-1);color:var(--sv-text-secondary)}
.phase-marker svg{width:18px;height:18px}
.phase-done .phase-marker{color:var(--sv-semantic-ok);background:var(--sv-semantic-ok-soft);border-color:color-mix(in srgb,var(--sv-semantic-ok),transparent 70%)}
.phase-current .phase-marker{color:var(--sv-accent-primary);background:var(--sv-accent-soft);border-color:color-mix(in srgb,var(--sv-accent-primary),transparent 65%)}
.phase-error .phase-marker{color:var(--sv-semantic-danger);background:var(--sv-semantic-danger-soft);border-color:var(--sv-semantic-danger)}
.task-phase-track strong{font-size:14px;font-weight:600;line-height:1.5}
.phase-description{font-size:14px;line-height:1.6;color:var(--sv-text-secondary)}
.task-waiting-note{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;margin:0 0 16px;border-radius:8px;background:var(--sv-accent-soft);font-size:14px;line-height:1.7}
.task-waiting-note>svg{width:18px;height:18px;flex:none;margin-top:3px;color:var(--sv-accent-primary)}
.task-waiting-note strong{font-weight:600;color:var(--sv-accent-primary)}
.task-waiting-note p{margin:4px 0 0;color:var(--sv-text-secondary)}
.task-current-progress{display:grid;gap:12px;margin:12px 0 20px;font-size:14px;line-height:1.7}
.task-current-progress p{margin:0;color:var(--sv-text-secondary)}
.task-scan-record{margin-top:16px}
@media(max-width:700px){
  .progress-heading{display:block}.progress-scope{margin-top:8px;font-size:16px;line-height:1.6}
  .progress-heading h2{font-size:18px}.progress-description,.task-scan-record,.task-current-progress,.task-waiting-note{font-size:16px}
  .task-phase-track{grid-template-columns:1fr;gap:0;margin:24px 0}
  .task-phase-track li{display:grid;grid-template-columns:36px minmax(0,1fr);column-gap:14px;row-gap:4px;padding-bottom:24px}
  .task-phase-track li:last-child{padding-bottom:0}.task-phase-track li:not(:last-child):after{top:44px;bottom:8px;left:17px;right:auto;width:1px;height:auto}
  .phase-marker{grid-column:1;grid-row:1 / span 2;margin:0}.task-phase-track strong{font-size:16px;grid-column:2;line-height:1.5}.phase-description{grid-column:2;font-size:16px}
  .task-waiting-note{padding:14px}.task-waiting-note>svg{margin-top:5px}
}
</style>
