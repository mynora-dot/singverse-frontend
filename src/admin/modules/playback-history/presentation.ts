import type { PlaybackEntry, PlaybackStatus } from './api'

export const statusNames: Record<PlaybackStatus, string> = {
  PLAYING: '播放中', COMPLETED: '自然播完', SKIPPED: '已切歌', STOPPED: '已停止', ERROR: '播放失败', INTERRUPTED: '播放中断',
}
export const clientNames = { TV: '电视', MOBILE: '手机', ADMIN: '后台试听' }
export function versionLabel(value: string) {
  return !value || value === 'UNKNOWN' ? '版本未标注' : value
}
export function inclusionLabel(entry: Pick<PlaybackEntry, 'effective' | 'clientType' | 'playedMs' | 'durationMs' | 'status'>) {
  if (entry.effective) return '计入热门排行'
  if (entry.clientType === 'ADMIN') return '未计入：后台试听'
  if (entry.durationMs && entry.durationMs > 0 && entry.durationMs < 30000) {
    return entry.status !== 'COMPLETED' || entry.playedMs < entry.durationMs ? '未计入：短歌未播完' : '未计入热门排行'
  }
  return entry.playedMs < 30000 ? '未计入：不足30秒' : '未计入热门排行'
}
export function date(value: string | null) {
  if (!value) return '—'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '时间未知' : time.toLocaleString('zh-CN', { hour12: false })
}
export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  return hours ? `${hours} 小时 ${Math.floor(seconds % 3600 / 60)} 分` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}
