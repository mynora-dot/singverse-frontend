import type { MediaSong } from '../media-library/types'
export function songTitle(song: MediaSong): string {
  return song.metadata && !song.metadata.stale && song.metadata.fields.includes('title') ? song.metadata.track.title || '未命名歌曲' : song.result.title || song.result.originalFilename
}
export function songArtists(song: MediaSong): string[] {
  return song.metadata && !song.metadata.stale && song.metadata.fields.includes('artists') ? (song.metadata.track.artists || []) : song.result.artists
}
export function songCoverUrl(song: Pick<MediaSong, 'id' | 'metadata'>, variant: 'thumbnail' | 'original' = 'original'): string {
  const query = new URLSearchParams()
  if (variant === 'thumbnail') query.set('variant', variant)
  const metadata = song.metadata
  if (metadata?.track.coverUrl) {
    // The endpoint is stable, but the browser must request newly saved artwork.
    query.set('v', [metadata.track.coverUrl, metadata.fieldStates?.cover?.revision, metadata.origins.cover?.appliedAt].filter(Boolean).join('|'))
  }
  return `/api/v1/metadata/songs/${encodeURIComponent(song.id)}/cover${query.size ? `?${query}` : ''}`
}
