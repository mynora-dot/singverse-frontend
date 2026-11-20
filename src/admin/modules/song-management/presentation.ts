import type { MediaSong, MediaSource } from '../media-library/types'
import type { Tag, Dimension } from '../classification/types'
import { dimensionNames } from '../classification/types'
export const songColumns = [
  { id: 'album', label: '专辑与发行信息' }, { id: 'classification', label: '分类标签' },
  { id: 'file', label: '文件格式与大小' }, { id: 'location', label: '歌曲来源' },
  { id: 'status', label: '识别与资料状态' }, { id: 'parsed', label: '文件名解析细节' },
  { id: 'timestamps', label: '扫描与修改时间' },
] as const
export type SongColumn = typeof songColumns[number]['id']
export const defaultSongColumns: SongColumn[] = ['album', 'classification', 'status']
export function confirmedField(song: MediaSong, field: 'album' | 'releaseDate' | 'durationMs') {
  return song.metadata && !song.metadata.stale && song.metadata.fields.includes(field) ? song.metadata.track[field] : null
}
export function fileSize(value: number | null) {
  if (value === null || !Number.isFinite(value) || value < 0) return '大小未提供'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`
}
export function fileFormat(song: MediaSong) { return (song.result.extension || song.relativePath.split('.').pop() || '未知格式').toUpperCase() }
export function platformDuration(song: MediaSong) {
  const value = confirmedField(song, 'durationMs')
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return ''
  const seconds = Math.floor(value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export function displayTime(value: string | null) {
  if (!value) return '未提供'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}
export function indexTags(tags: readonly Tag[]): ReadonlyMap<string, Tag> { return new Map(tags.map(tag => [tag.id, tag])) }
export function songTags(song: MediaSong, tags: readonly Tag[] | ReadonlyMap<string, Tag>) {
  return Object.entries(song.classification?.dimensions ?? {}).flatMap(([dim, value]) => (value?.tagIds ?? []).map(id => {
    const tag = 'get' in tags ? tags.get(id) : tags.find(t => t.id === id)
    return { id, name: tag?.name ?? '标签信息未加载', dimension: dimensionNames[dim as Dimension] ?? dim, active: tag?.active ?? false, locked: !!value?.locked }
  }))
}
export const languageLabels: Record<string, string> = { MANDARIN: '国语', CANTONESE: '粤语', ENGLISH: '英语', JAPANESE: '日语', KOREAN: '韩语', MULTILINGUAL: '多语种', OTHER: '其他', UNKNOWN: '语种未知' }
export const versionLabels: Record<string, string> = { ORIGINAL: '原唱', ACCOMPANIMENT: '伴奏', LIVE: '现场', COVER: '翻唱', UNKNOWN: '版本未知' }

// 原始解析证据保持不变；只有有效且明确确认的核心身份信息才解除业务复核提示。
export function sharedIdentity(song: MediaSong): boolean {
  return !song.metadata?.stale && ['title', 'artists'].some(field => song.metadata?.origins[field]?.kind === 'SHARED')
}
export function identityReviewed(song: MediaSong): boolean {
  const metadata = song.metadata
  return !!metadata && !metadata.stale && !sharedIdentity(song) && metadata.fields.includes('title') && metadata.fields.includes('artists')
    && !!metadata.track.title?.trim() && metadata.track.artists?.some(artist => !!artist.trim())
}
export function needsSongReview(song: MediaSong): boolean { return sharedIdentity(song) || song.result.needsReview && !identityReviewed(song) }
export function songReviewLabel(song: MediaSong): string {
  return sharedIdentity(song) ? '共享信息待核对' : identityReviewed(song) ? '歌曲信息已复核' : song.result.needsReview ? '文件名待复核' : '文件名完整'
}

export function songVersionSummary(song: MediaSong): string {
  const album = confirmedField(song, 'album')
  const date = confirmedField(song, 'releaseDate')
  const version = !song.metadata?.stale && song.metadata?.variant?.kind || song.result.versionType
  return [typeof album === 'string' ? album : '', typeof date === 'string' ? date.slice(0, 4) : '',
    version && !['ORIGINAL', 'UNKNOWN'].includes(version) ? versionLabels[version] || version : '', fileFormat(song)].filter(Boolean).join(' · ')
}
export function songFileName(song: MediaSong): string {
  return song.relativePath?.split(/[\\/]/).pop() || song.result.originalFilename || '文件名未提供'
}
export function songDurationText(song: MediaSong): string {
  const milliseconds = !song.metadata?.stale ? song.metadata?.media?.durationMs : null
  if (typeof milliseconds !== 'number' || milliseconds <= 0) return platformDuration(song)
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export function songDurationCaption(song: MediaSong): string {
  return !song.metadata?.stale && (song.metadata?.media?.durationMs ?? 0) > 0 ? '文件实际时长' : '资料参考时长'
}
export function sourceDisplayLabels(sources: MediaSource[]): Record<string, string> {
  return Object.fromEntries(sources.map(source => {
    if (sources.filter(other => other.name === source.name).length < 2) return [source.id, source.name]
    let location = source.location.split('/').filter(Boolean).slice(-2).join('/')
    try { const url = new URL(source.location); location = `${url.host}/${decodeURIComponent(url.pathname).split('/').filter(Boolean).slice(-2).join('/')}` } catch { /* local path */ }
    return [source.id, `${source.name} · ${location || source.id.slice(0, 8)}`]
  }))
}
