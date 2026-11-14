import { authRequest } from '../../core/auth/api'

export interface FavoriteSong {
  id: string; title: string; artists: string[]; album?: string | null
  addedAt: string; available: boolean; coverPath?: string; revision?: string
}
export interface FavoriteState { songIds: string[]; revision: number }
export interface FavoritePage {
  items: FavoriteSong[]; page: number; size: number
  totalElements: number; totalFavorites: number; revision: number
}
export const favoritesApi = {
  list: (q = '', availability = 'ALL', sort = 'RECENT', page = 0) =>
    authRequest<FavoritePage>(`/api/v1/favorites?${new URLSearchParams({ q, availability, sort, page: String(page), size: '20' })}`),
  ids: () => authRequest<FavoriteState>('/api/v1/favorites/ids'),
  set: (songIds: string[], selected: boolean) => authRequest<FavoriteState>('/api/v1/favorites', 'PUT', { songIds, selected }),
  library: (q = '', page = 0) => authRequest<{ items: FavoriteSong[]; totalElements: number }>(
    `/api/v1/mobile/library/songs?${new URLSearchParams({ q, page: String(page), size: '20' })}`),
}
