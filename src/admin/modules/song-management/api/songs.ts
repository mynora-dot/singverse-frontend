import { authRequest } from '../../../core/auth/api'
import { media } from '../../media-library/api/media'
import type { MediaSource, SongPage } from '../../media-library/types'

export type SongSort = 'SCANNED_DESC' | 'UPDATED_DESC'
export interface SongTextTracks { songId: string; items: { id: string; format: 'lrc' | 'srt' | 'vtt' | 'text'; text: string }[]; warnings: string[] }
export interface SongFilters { sourceId: string; q: string; search?: string; status: string; page: number; size?: number; tagIds?: string[]; unclassified?: boolean; sort?: SongSort }
export const songs = {
  textTracks: (id: string) => authRequest<SongTextTracks>(`/api/v1/media-songs/${encodeURIComponent(id)}/text-tracks`),
  list: (filters: SongFilters) => {
    const query = new URLSearchParams({ page: String(filters.page), size: String(filters.size ?? 20), status: filters.status })
    if (filters.sourceId) query.set('sourceId', filters.sourceId)
    if (filters.search?.trim()) query.set('search', filters.search.trim())
    if (filters.q.trim()) query.set('q', filters.q.trim())
    filters.tagIds?.forEach(id => query.append('tagIds', id))
    if (filters.unclassified) query.set('unclassified', 'true')
    if (filters.sort) query.set('sort', filters.sort)
    return authRequest<SongPage>(`/api/v1/media-songs?${query}`)
  },
  sources: async () => {
    const items: MediaSource[] = []
    for (let page = 0; ; page++) {
      const result = await media.list(page, 100)
      items.push(...result.items)
      if (!result.items.length || items.length >= result.totalElements) return items
    }
  },
}
