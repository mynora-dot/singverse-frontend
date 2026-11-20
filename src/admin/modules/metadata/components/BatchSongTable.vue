<script setup lang="ts">
import { ElButton, ElIcon } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { metadata } from '../api/metadata'
import MetadataCover from './MetadataCover.vue'
import { confidence, itemLabel } from '../batch-display'
import { providerNames } from '../types'
import type { MetadataBatch, MetadataItem } from '../types'

const props = defineProps<{ batch: MetadataBatch; busy: boolean; retryDisabledReason: string; emptyTitle?: string }>()
const emit = defineEmits<{ review: [item: MetadataItem]; retry: [itemId: string]; manual: [item: MetadataItem]; reason: [item: MetadataItem]; reset: [] }>()
function risk(item: MetadataItem) { return confidence(item, props.batch.threshold) }
function applied(item: MetadataItem) { return ['AUTO_APPLIED', 'MANUAL_APPLIED'].includes(item.status) }
</script>

<template>
  <div class="batch-song-table">
    <table v-if="batch.items.length" aria-label="歌曲资料与匹配候选">
      <colgroup><col class="order-column" /><col class="current-column" /><col /><col class="status-column" /><col class="score-column" /><col class="actions-column" /></colgroup>
      <thead><tr><th scope="col">#</th><th scope="col">原始入库信息</th><th scope="col">匹配候选 / 处理说明</th><th scope="col">状态</th><th scope="col">相似度</th><th scope="col">操作</th></tr></thead>
      <tbody>
        <tr v-for="(item, index) in batch.items" :key="item.id" :data-song-id="item.songId">
          <td class="song-order">{{ batch.page * batch.size + index + 1 }}</td>
          <td class="current-cell"><div class="song-cell"><MetadataCover :src="item.coverAvailable ? metadata.songCover(item.songId) : null" alt="当前确认封面" empty-text="暂无封面" /><div><strong>{{ item.title || '未识别歌名' }}</strong><small>{{ item.artists.join('、') || '未知歌手' }}</small></div></div></td>
          <td class="candidate-cell">
            <span class="mobile-candidate-label">匹配候选</span>
            <template v-if="item.candidates[0]"><strong :class="{ 'candidate-title': item.status === 'REVIEW' }">{{ item.candidates[0].track.title }}</strong><small>{{ item.candidates[0].track.artists.join('、') || '未知歌手' }}<template v-if="item.candidates[0].track.album"> · {{ item.candidates[0].track.album }}</template></small>
              <small class="candidate-provider">{{ providerNames[item.candidates[0].track.provider] }}<template v-if="item.candidates[0].track.releaseDate"> · {{ item.candidates[0].track.releaseDate }}</template></small>
              <small v-if="item.status === 'REVIEW' && risk(item) !== 'HIGH'" class="risk-warning">{{ risk(item) === 'NONE' ? '未找到可信匹配，低分候选仅供核对' : '未达到高相似度阈值，请核对版本和歌手' }}</small>
              <small v-else-if="item.status === 'REVIEW' && item.candidates[1] && item.candidates[0].score - item.candidates[1].score < .08" class="item-note">多个接近候选，请核对版本</small>
              <small v-if="item.error?.includes('部分平台失败')" class="risk-warning">{{ item.error }}</small>
            </template>
            <span v-else class="item-note">{{ item.status === 'PENDING' ? (batch.status === 'CANCELLED' ? '终止后不再处理' : '等待平台查询') : item.status === 'PROCESSING' ? '正在查询平台，请稍候' : item.status === 'SKIPPED_EXISTING' ? '保留已有确认结果' : item.status === 'FAILED' ? item.error || '匹配失败，请查看原因后重试' : '没有找到候选，可重新匹配或手工处理' }}</span>
          </td>
          <td class="status-cell"><span class="status-pill" :class="{ failed: item.status === 'FAILED', applied: applied(item), review: item.status === 'REVIEW' }">{{ itemLabel(item, batch.threshold, batch.status === 'CANCELLED') }}</span></td>
          <td class="score-cell"><span class="mobile-score-label">相似度</span><span :class="{ 'risk-warning': item.status === 'REVIEW' && risk(item) !== 'HIGH' }">{{ item.candidates[0] ? Math.round(item.candidates[0].score * 100) + '%' : '—' }}</span></td>
          <td class="row-actions-cell"><div class="row-actions">
            <template v-if="item.status === 'REVIEW'"><ElButton v-if="item.candidates.length" class="review-button" type="primary" plain :disabled="busy" @click="emit('review', item)">{{ risk(item) === 'HIGH' ? '审核候选' : '核对候选' }}</ElButton><ElButton v-else link type="primary" :disabled="busy || !item.sourceId" @click="emit('manual', item)">手工处理</ElButton><ElButton link :disabled="busy || !!retryDisabledReason" :title="retryDisabledReason" @click="emit('retry', item.id)">重新匹配</ElButton><ElButton v-if="item.candidates.length && risk(item) === 'NONE'" link :disabled="busy || !item.sourceId" @click="emit('manual', item)">手工处理</ElButton></template>
            <template v-else-if="item.status === 'FAILED'"><ElButton link type="primary" :disabled="busy || !!retryDisabledReason" :title="retryDisabledReason" @click="emit('retry', item.id)">重试</ElButton><ElButton link :disabled="busy" @click="emit('reason', item)">查看原因</ElButton></template>
            <template v-else-if="applied(item) || item.status === 'SKIPPED_EXISTING'"><ElButton link :disabled="busy" @click="emit('reason', item)">{{ item.status === 'SKIPPED_EXISTING' ? '跳过原因' : '应用说明' }}</ElButton><ElButton v-if="item.status === 'MANUAL_APPLIED' && item.error?.includes('查询期间歌曲已确认')" link type="primary" :disabled="busy || !!retryDisabledReason" @click="emit('retry', item.id)">重新匹配</ElButton><ElButton link type="primary" :disabled="busy || !item.sourceId" @click="emit('manual', item)">单曲处理</ElButton></template>
            <span v-else class="item-note">{{ item.status === 'PROCESSING' ? '请求进行中' : batch.status === 'CANCELLED' ? '已停止后续处理' : '等待调度' }}</span>
          </div></td>
        </tr>
      </tbody>
    </table>
    <div v-else class="batch-list-empty" role="status"><ElIcon><Search /></ElIcon><h2>{{ emptyTitle || '当前筛选没有歌曲' }}</h2><ElButton :disabled="busy" @click="emit('reset')">查看全部歌曲</ElButton></div>
  </div>
</template>

<style scoped>
.batch-song-table { min-width: 0; width: 100%; border: 1px solid var(--sv-border-subtle); border-radius: 8px; overflow: hidden; background: var(--sv-surface-2); }
table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 14px; }
.order-column { width: 42px; }.current-column { width: 26%; }.status-column { width: 144px; }.score-column { width: 78px; }.actions-column { width: 180px; }
th { padding: 12px; background: var(--sv-surface-3); color: var(--sv-text-secondary); text-align: left; font-size: 12px; font-weight: 500; }
td { padding: 12px; border-top: 1px solid var(--sv-border-subtle); vertical-align: middle; line-height: 1.5; overflow-wrap: anywhere; }
.song-order { text-align: center; color: var(--sv-text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.song-cell { display: flex; align-items: center; gap: 12px; min-width: 0; }.song-cell>div { min-width: 0; }.song-cell>.metadata-cover { width: 44px; height: 46px; flex-shrink: 0; border-radius: 4px; }
strong { display: block; font-weight: 600; font-size: 14px; color: var(--sv-text-primary); }small { display: block; font-size: 12px; color: var(--sv-text-secondary); margin-top: 2px; line-height: 1.5; }
.candidate-title { color: var(--sv-accent-primary); }.candidate-cell .candidate-provider { display: none; }.risk-warning { color: var(--sv-semantic-warn); }.item-note { font-size: 12px; color: var(--sv-text-secondary); }
.status-pill { display: inline-block; padding: 3px 6px; border-radius: 4px; font-size: 12px; background: var(--sv-surface-3); color: var(--sv-text-secondary); }.status-pill.review { background: var(--sv-semantic-warn-soft); color: var(--sv-semantic-warn); }.status-pill.applied { color: var(--sv-semantic-ok); background: var(--sv-semantic-ok-soft); }.status-pill.failed { color: var(--sv-semantic-danger); background: var(--sv-semantic-danger-soft); }
.score-cell { font-size: 13px; font-variant-numeric: tabular-nums; }.row-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }.row-actions .el-button { margin: 0; min-height: 44px; font-size: 12px; padding: 0; }.row-actions .review-button { padding: 0 10px; }
.mobile-candidate-label, .mobile-score-label { display: none; }.batch-list-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 20px; text-align: center; }.batch-list-empty>.el-icon { font-size: 28px; color: var(--sv-text-secondary); }.batch-list-empty h2 { margin: 0; font-size: 18px; }.batch-list-empty p { margin: 0; color: var(--sv-text-secondary); font-size: 14px; }.batch-list-empty .el-button { margin-top: 8px; min-height: 44px; }
@media(max-width: 1100px) and (min-width: 769px) { .current-column { width: 24%; }.status-column { width: 120px; }.score-column { width: 66px; }.actions-column { width: 150px; }td, th { padding: 10px 8px; }.song-cell { gap: 8px; } }
@media(max-width: 768px) {
  .batch-song-table { border: 0; border-radius: 0; background: none; overflow: visible; }table, tbody { display: block; }thead, colgroup { display: none; }
  tr { position: relative; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 12px 8px; margin-bottom: 12px; padding: 12px; border: 1px solid var(--sv-border-subtle); border-radius: 8px; background: var(--sv-surface-2); }
  td { display: block; padding: 0; border: 0; min-width: 0; }.song-order { display: none; }.current-cell { grid-column: 1; grid-row: 1; }.status-cell { grid-column: 2; grid-row: 1; align-self: start; text-align: right; }.status-pill { max-width: 110px; font-size: 12px; }
  .candidate-cell { grid-column: 1/-1; grid-row: 2; background: var(--sv-surface-3); border: 1px solid var(--sv-border-subtle); border-radius: 6px; padding: 10px 12px; }.mobile-candidate-label { display: block; color: var(--sv-text-secondary); font-size: 12px; margin-bottom: 4px; }.candidate-cell .candidate-provider { display: block; }
  .score-cell { grid-column: 1/-1; grid-row: 3; justify-self: start; align-self: center; display: flex; gap: 6px; font-size: 12px; }.mobile-score-label { display: inline; color: var(--sv-text-secondary); }.row-actions-cell { grid-column: 1/-1; grid-row: 3; justify-self: end; padding-left: 90px; }.row-actions { gap: 4px 12px; justify-content: flex-end; }.row-actions .el-button { min-width: 44px; font-size: 12px; }
  .song-cell { align-items: flex-start; gap: 8px; }.song-cell strong, .candidate-cell strong { font-size: 16px; }.song-cell>.metadata-cover { width: 42px; height: 44px; }.song-cell small, .candidate-cell>small { font-size: 14px; }.candidate-cell>small.risk-warning, .candidate-cell>.candidate-provider, .candidate-cell>.item-note { font-size: 12px; }
}
</style>
