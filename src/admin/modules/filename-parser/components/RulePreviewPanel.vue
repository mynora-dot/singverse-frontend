<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Clock, Warning } from '@element-plus/icons-vue'
import { ElIcon } from 'element-plus'
import type { RulePreview } from '../types'

const props = defineProps<{ preview: RulePreview | null; stale: boolean; detailsOnly?: boolean; profileName?: string }>()
const statuses: Record<string, string> = { DISABLED: '已停用', NO_MATCH: '未匹配', PARTIAL: '部分捕获', AMBIGUOUS: '存在歧义', MATCHED: '完整匹配' }
const status = computed(() => !props.preview ? '试解析后，核对歌名和歌手' : props.stale ? '结果已过期，请重新试解析' : props.preview.selectedRule ? '已提取歌名和歌手，请核对' : '未提取到完整的歌名和歌手')
const selectedIndex = computed(() => props.preview?.attempts.findIndex(a => a.id === props.preview?.selectedRule?.id) ?? -1)
</script>

<template>
  <div v-if="!detailsOnly" class="filename-result" :class="{ stale, failed: preview && !preview.selectedRule }" aria-live="polite">
    <div class="result-summary"><p class="result-status"><ElIcon v-if="preview"><Clock v-if="stale" /><CircleCheck v-else-if="preview.selectedRule" /><Warning v-else /></ElIcon>{{ status }}</p><p v-if="preview?.selectedRule" class="result-meta">{{ stale ? '上次命中' : '命中' }}{{ selectedIndex >= 0 ? `第 ${selectedIndex + 1} 项` : '格式' }}：{{ preview.selectedRule.name }}</p><p v-else-if="preview" class="result-meta">仅尝试当前方案中的启用格式，不使用其他格式兜底。</p><p v-if="stale && preview" class="result-meta">上次文件名：{{ preview.result.originalFilename }}</p></div>
    <div class="result-field"><span>{{ stale ? '上次歌名' : '歌名' }}</span><strong data-testid="parsed-title">{{ preview?.result.title || (preview ? '未确定' : '—') }}</strong></div>
    <div class="result-field"><span>{{ stale ? '上次歌手' : '歌手' }}</span><strong data-testid="parsed-artists">{{ preview?.result.artists.join('、') || (preview ? '未确定' : '—') }}</strong></div>
    <div v-if="$slots.actions" class="result-actions"><slot name="actions" /></div>
  </div>
  <div v-else-if="preview" class="filename-diagnostics">
    <p v-if="stale" class="diagnostic-stale">这是上次试解析的记录，当前输入或格式已变化，请重新试解析。</p>
    <p class="diagnostic-context">{{ profileName ? `试解析方案：${profileName}；` : '' }}文件名：{{ preview.result.originalFilename }}</p>
    <dl class="diagnostic-fields"><div><dt>标准化名称</dt><dd>{{ preview.result.normalizedFilename || '—' }}</dd></div><div><dt>实际匹配文本</dt><dd>{{ preview.matchTarget || '—' }}</dd></div><div><dt>结构置信度（非正确率）</dt><dd>{{ Math.round(preview.result.confidence * 100) }}%</dd></div><div><dt>未识别片段</dt><dd>{{ preview.result.unparsedTokens.join('；') || '无' }}</dd></div></dl>
    <ol class="attempts"><li v-for="attempt in preview.attempts" :key="attempt.id"><div class="attempt-title"><strong>{{ attempt.name }}</strong><span>{{ attempt.id === preview.selectedRule?.id ? '本次采用' : statuses[attempt.status] }}</span></div><p>{{ attempt.detail }}</p><pre v-if="Object.keys(attempt.captures).length">{{ JSON.stringify(attempt.captures, null, 2) }}</pre><pre v-if="attempt.candidates.length">{{ JSON.stringify(attempt.candidates, null, 2) }}</pre></li></ol>
    <p v-if="!preview.attempts.length" class="diagnostic-context">方案中没有可尝试的格式。</p>
    <details class="raw-data"><summary>查看完整解析数据</summary><pre>{{ JSON.stringify(preview, null, 2) }}</pre></details>
  </div>
  <p v-else class="diagnostic-context">试解析后可查看逐项匹配记录。</p>
</template>

<style scoped>
.filename-result{display:grid;grid-template-columns:minmax(240px,1.2fr) minmax(0,.75fr) minmax(0,.75fr);align-items:center;gap:8px 28px;padding:16px 20px;background:var(--sv-surface-0);border-top:1px solid var(--sv-border-subtle)}.result-status{display:flex;align-items:center;gap:8px;margin:0;font-size:14px;font-weight:500;color:var(--sv-text-secondary);line-height:1.7}.result-status .el-icon{color:var(--sv-semantic-ok);flex:none}.result-meta{margin:4px 0 0;color:var(--sv-text-tertiary);font-size:12px;line-height:1.7;overflow-wrap:anywhere}.result-field{display:flex;flex-direction:column;gap:4px;min-width:0}.result-field>span{color:var(--sv-text-tertiary);font-size:12px}.result-field strong{font-size:20px;line-height:1.4;font-weight:600;overflow-wrap:anywhere}.result-actions{grid-column:1/-1;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.filename-result.stale{background:var(--sv-semantic-warn-soft)}.stale .result-status,.failed .result-status{color:var(--sv-semantic-warn)}.stale .result-status .el-icon,.failed .result-status .el-icon{color:inherit}.stale .result-field strong{color:var(--sv-text-secondary)}.diagnostic-context,.diagnostic-stale{font-size:14px;line-height:1.7;overflow-wrap:anywhere}.diagnostic-context{color:var(--sv-text-secondary)}.diagnostic-stale{padding:12px;background:var(--sv-semantic-warn-soft);color:var(--sv-semantic-warn);border-radius:var(--sv-radius-sm)}.diagnostic-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.diagnostic-fields dt{font-size:12px;color:var(--sv-text-tertiary)}.diagnostic-fields dd{margin:4px 0 0;font-size:14px;overflow-wrap:anywhere}.attempts{list-style:none;margin:16px 0;padding:0}.attempts li{padding:16px 0;border-top:1px solid var(--sv-border-subtle)}.attempt-title{display:flex;align-items:center;justify-content:space-between;gap:16px}.attempt-title strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}.attempt-title span{font-size:12px;flex:none;color:var(--sv-text-secondary)}.attempts p{font-size:14px;color:var(--sv-text-secondary);line-height:1.7;margin:8px 0 0}.filename-diagnostics pre{margin:8px 0 0;padding:12px;background:var(--sv-surface-3);border-radius:var(--sv-radius-sm);font-size:12px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere}.raw-data summary{min-height:40px;align-content:center;cursor:pointer;font-size:12px;color:var(--sv-text-secondary)}
@media(max-width:768px){.filename-result{grid-template-columns:1fr 1fr;padding:16px;gap:12px 20px}.result-summary{grid-column:1/-1}.result-field strong{font-size:20px}.result-status{font-size:14px}.result-actions{gap:8px}.diagnostic-fields{grid-template-columns:1fr}.raw-data summary{min-height:44px}}
</style>
