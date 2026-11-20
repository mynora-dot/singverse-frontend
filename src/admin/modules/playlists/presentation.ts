import type { Song } from './api'
import { versionLabels } from '../song-management/presentation'
export function playlistSongVersion(song?: Song): string {
  if (!song) return ''
  const seconds = song.durationMs && song.durationMs > 0 ? Math.floor(song.durationMs / 1000) : 0
  return [song.album, song.releaseDate?.slice(0, 4),
    song.version && !['UNKNOWN', 'ORIGINAL'].includes(song.version) ? versionLabels[song.version] || song.version : '',
    seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''].filter(Boolean).join(' · ')
}
export function playlistSongSource(song?: Song): string {
  return [song?.sourceName, song?.relativePath].filter(Boolean).join(' · ')
}
