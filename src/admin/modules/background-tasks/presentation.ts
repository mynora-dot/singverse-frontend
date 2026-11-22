import type { BackgroundTask, TaskExecution, TaskItem } from './api'

export const typeNames: Record<string, string> = {
  SHARE_IMPORT: '曲库资料导入', SOURCE_INGEST: '来源入库', ARTIST_ARTWORK: '歌手封面获取', LX_DOWNLOAD: '歌曲下载', LOCAL_SCAN: '本地扫描', WEBDAV_SCAN: 'WebDAV 扫描', METADATA: '歌曲资料匹配', CLASSIFICATION: 'AI 分类',
  AUDIO_DISCOVERY: '自动音轨识别', AUDIO_BATCH: '批量音轨处理', AUDIO_JOB: '单曲音频处理', TRANSCODE: '离线转码', CACHE_CLEANUP: '缓存清理', SHARE_EXPORT: '分享包导出',
}
export const statusNames: Record<string, string> = {
  QUEUED: '排队中', RUNNING: '运行中', PAUSED: '已暂停', CANCELLING: '取消中', AWAITING_CONFIRMATION: '等待开始',
  COMPLETED: '处理完成', PARTIAL: '部分完成', FAILED: '失败', CANCELLED: '已取消', INTERRUPTED: '已中断', BLOCKED: '未能继续', EXPIRED: '已过期',
}
export const itemStatusNames: Record<string, string> = {
  RESOLVING: '获取歌曲地址', DOWNLOADING: '正在下载', PUBLISHING: '正在加入曲库', SUCCESS: '已加入曲库',
  NO_MATCH: '未找到匹配', ...statusNames, PENDING: '等待处理', PROCESSING: '处理中', PROBING: '读取音轨', REVIEW: '待审核',
  AUTO_APPLIED: '已自动保存', MANUAL_APPLIED: '已人工保存', APPLIED: '已保存', SKIPPED_EXISTING: '保留已有结果',
  SKIPPED: '已跳过', UNCHANGED: '无需更改', SUCCEEDED: '处理成功',
}
const stages: Record<string, string> = {
  FETCHING_ARTWORK: '获取歌手封面', RESOLVING: '获取歌曲地址', DOWNLOADING: '正在下载', PUBLISHING: '正在加入曲库',
  DISCOVERING: '发现待处理歌曲', RECOGNIZING: '处理扫描后的音轨任务', WAITING_RECOGNITION: '等待后续音轨处理', LEGACY: '未记录原始批次',
  ...statusNames, SCANNING: '遍历目录', READING_TAGS: '读取文件标签', COMMITTING: '保存索引', MATCHING: '匹配元数据',
  CLASSIFYING: '生成分类建议', PREPARING: '准备批次', PREVIEW: '等待确认开始', PROCESSING: '处理歌曲',
  PARSING: '解析资料包', APPLYING: '保存共享资料', IMPORTED: '资料已导入', VERIFYING: '核对媒体路径', WAITING: '准备资料快照', STARTING: '正在启动', SUCCEEDED: '处理完成', CLEAR: '清理全部', POLICY: '按策略回收', DELETE: '清理指定缓存',
  probe: '读取歌曲', extract: '准备音频', separate: '生成伴奏', encode: '保存结果', validate: '校验结果', hash: '校验结果',
  download: '读取素材', transcode: '转换媒体', analyze: '分析音轨', inference: '模型推理',
}
export const activeTask = (status: string) => ['QUEUED', 'RUNNING', 'PAUSED', 'CANCELLING', 'AWAITING_CONFIRMATION'].includes(status)
export const countNames: Record<string, string> = { completed: '完成', queued: '排队', running: '运行', failed: '失败', review: '待审核', uncertain: '识别不确定' }
export const isScan = (task: BackgroundTask) => task.type.endsWith('SCAN')
export function compactTaskName(task: BackgroundTask) {
  const suffix = task.subjectName ? ' · ' + task.subjectName : ''
  return suffix && task.name.endsWith(suffix) ? task.name.slice(0, -suffix.length) : task.name
}
export function taskHighlights(task: BackgroundTask) {
  return Object.entries(countNames).flatMap(([key, label]) => {
    const value = Math.max(task.childrenCounts[key] || 0, Number(task.statistics[key] || 0))
    return value > 0 ? [{ key, label, value }] : []
  })
}
/** 待登记的歌曲也会计入 queued；不能将它们误当成已创建的子任务。 */
export function childTaskCount(task: BackgroundTask) {
  const counts = task.childrenCounts
  if (typeof counts.total === 'number') return Math.max(0, counts.total)
  const queued = Math.max(0, (counts.queued || 0) - (counts.pendingDiscovery || 0))
  const registered = ['completed', 'running', 'failed', 'cancelled', 'interrupted', 'skipped']
    .reduce((total, key) => total + (counts[key] || 0), queued)
  return Math.max(registered, counts.review || 0, counts.uncertain || 0)
}
export const stageName = (stage: string) => stages[stage] || stage || '等待更新'
export function tone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'primary' {
  if (status === 'COMPLETED') return 'success'
  if (['FAILED', 'INTERRUPTED'].includes(status)) return 'danger'
  if (['PARTIAL', 'BLOCKED', 'PAUSED'].includes(status)) return 'warning'
  return status === 'RUNNING' ? 'primary' : 'info'
}
export function date(value?: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未记录' }
export function progressText(task: BackgroundTask) {
  const { completed, total, unit } = task.progress
  const suffix = unit === 'SONGS' ? '首' : unit === 'ARTISTS' ? '位' : '项'
  const scope = task.stage === 'PREPARING' ? '已准备' : task.stage === 'READING_TAGS' ? '已读取' : '已处理'
  if (completed !== null && total !== null) return scope + ' ' + completed.toLocaleString() + ' / ' + total.toLocaleString() + ' ' + suffix
  if (task.type.endsWith('SCAN')) return '已发现 ' + Number(task.statistics.total_songs || 0).toLocaleString() + ' 首歌曲'
  if (task.type === 'SHARE_EXPORT') return '已导出 ' + Number(task.statistics.exportedSongs || 0).toLocaleString() + ' 首 · ' + Number(task.statistics.parts || 0) + ' 个分包'
  if (completed !== null) return scope + ' ' + completed.toLocaleString() + ' ' + suffix
  return activeTask(task.status) ? '正在处理，整体进度暂不可用' : '查看处理结果'
}
export function frameProgress(execution?: TaskExecution) {
  const progress = execution?.progress
  if (execution?.stage !== 'separate' || !progress || progress.frames <= 0) return ''
  return '当前阶段 ' + Math.floor(Math.max(0, Math.min(1, progress.completedFrames / progress.frames)) * 100) + '% · ' + progress.completedFrames.toLocaleString() + ' / ' + progress.frames.toLocaleString() + ' 帧'
}
export function bytes(value: number) {
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(2) + ' GiB'
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(1) + ' MiB'
  return Math.max(0, value).toLocaleString() + ' B'
}
const statisticNames: Record<string, string> = {
  added_count: '新增', updated_count: '更新', preserved_count: '保留本地修改', unchanged_count: '未变化', present_count: '已核对媒体', missing_count: '媒体缺失', mismatch_count: '大小不符', unreachable_count: '连接问题',
  noMatch: '未找到匹配', interrupted: '已中断', cancelled: '已取消',
  pending: '等待处理', processing: '正在处理', review: '待审核', failed: '失败', skipped: '跳过', applied: '已保存',
  prepared: '已准备', directories: '已遍历目录', entries: '已访问条目', total_songs: '发现歌曲',
  matched_songs: '匹配歌曲', review_songs: '待复核歌曲', skipped_files: '跳过文件', added_songs: '新增歌曲',
  reused_songs: '复用歌曲', missing_songs: '本次未发现', removed_songs: '移出索引', removed: '已清理缓存',
  freedBytes: '已释放空间', usageBeforeBytes: '清理前占用', usageAfterBytes: '清理后占用', targetBytes: '目标占用',
  shortfallBytes: '空间缺口', exportedSongs: '已导出歌曲', snapshotSongs: '快照歌曲', parts: '已生成分包',
}
export function statistics(task: BackgroundTask) {
  return Object.entries(task.statistics).flatMap(([key, value]) => typeof value === 'number' && statisticNames[key]
    ? [{ key, label: statisticNames[key]!, value: key.endsWith('Bytes') ? bytes(value) : value.toLocaleString() }] : [])
}
export const skipReasons: Record<string, string> = {
  PLAYING: '正在播放', DOWNLOADING: '正在下载', PINNED: '歌曲已固定', RECENT_PLAY: '近期播放保护', PREFETCH: '正在预取',
  DELETING: '正在删除', BUILDING: '正在接收', CHANGED: '缓存状态变化', STATISTICS_NOT_READY: '统计尚未就绪', MANUAL: '当前采用手动策略',
}

const errorNames: Record<string, string> = {
  AUDIO_EXECUTION_FAILED: '音轨处理失败，请到原唱与伴奏页面查看处理详情后重试。',
}
export function failureText(value: string) { return errorNames[value.trim()] || value.trim() }
export const unsuccessful = (status: string) => ['FAILED', 'INTERRUPTED', 'BLOCKED', 'PARTIAL'].includes(status)
export function taskFailure(task: BackgroundTask, items: TaskItem[] = [], children: BackgroundTask[] = []) {
  const messages = items.filter(item => unsuccessful(item.status)).map(item => ({ title: item.title, message: item.message || item.execution?.reason || '' }))
    .concat(children.filter(child => unsuccessful(child.status)).map(child => ({ title: child.subjectName || child.name, message: child.error || child.execution?.reason || '' })))
    .filter(item => item.message.trim())
  const concrete = messages.find(item => !/^[A-Z_]+$/.test(item.message.trim())) || messages[0]
  // A batch's generic code must not hide the actionable cause in its song records.
  if (concrete && (!task.error.trim() || /^[A-Z_]+$/.test(task.error.trim()))) return `${concrete.title ? concrete.title + '：' : ''}${failureText(concrete.message)}`
  return failureText(task.error || task.execution?.reason || '')
}
export function failureGuidance(task: BackgroundTask, reason: string) {
  if (task.type === 'LX_DOWNLOAD') return /403|音源|解析|地址/.test(reason)
    ? '请重新搜索这首歌，选择其他平台或版本；必要时在下载页更换音源。已入库的歌曲会保留。'
    : '请到下载记录查看失败歌曲并重试；已入库的歌曲会保留。'
  if (task.type.startsWith('AUDIO')) return '请到原唱与伴奏查看失败步骤和处理环境，再决定重试。现有可用音轨会保留。'
  return '请查看下方明细，并到相关页面处理后重试。'
}
export function progressStatus(status: string): 'exception' | 'warning' | 'success' | undefined {
  return ['FAILED', 'INTERRUPTED'].includes(status) ? 'exception' : ['PARTIAL', 'BLOCKED'].includes(status) ? 'warning' : status === 'COMPLETED' ? 'success' : undefined
}
