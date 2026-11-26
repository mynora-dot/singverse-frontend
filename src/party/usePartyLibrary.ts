import { nextTick, reactive, watch } from 'vue'
import type { Artist, Page, Song, Tag } from './api'
import type { PartySession } from './usePartySession'
export type Finder = 'category' | 'artists' | 'recent' | 'popular' | 'favorites'
export const finders: { id: Finder; label: string; icon: string }[] = [
  { id: 'category', label: '分类', icon: 'grid' }, { id: 'artists', label: '歌手', icon: 'person' }, { id: 'recent', label: '最近', icon: 'clock' }, { id: 'popular', label: '热门', icon: 'fire' }, { id: 'favorites', label: '家庭收藏', icon: 'heart' },
]
export const dimensions = [{ id: 'LANGUAGE', label: '语种' }, { id: 'DECADE', label: '年代' }, { id: 'GENRE', label: '风格' }, { id: 'MOOD', label: '情绪' }, { id: 'SCENE', label: '场景' }]
export function usePartyLibrary(session: PartySession, scroll: { position: () => number; move: (top: number) => void }) {
  const state = reactive({ entry: 'category' as Finder, query: '', period: '30d', selected: [] as string[], tags: [] as Tag[], songs: [] as Song[], artists: [] as Artist[], artist: null as Artist | null, page: 0, total: 0, loading: false, error: '' })
  let sequence = 0, artistQuery = '', artistScroll = 0
  let suppressFilter = false
  let cache: { artists: Artist[]; total: number; page: number } | null = null
  async function load(more = false) {
    if (!session.state.credential) return
    const turn = ++sequence, token = session.state.credential.token
    state.loading = true; state.error = ''
    const page = more ? state.page + 1 : 0
    const params = new URLSearchParams({ q: state.query, page: String(page), size: '30' })
    let path = 'library/songs'
    if (state.entry === 'artists') path = state.artist ? `library/artists/${encodeURIComponent(state.artist.id)}/songs` : 'library/artists'
    if (state.entry === 'category') state.selected.forEach(id => params.append('tagIds', id))
    if (state.entry === 'recent' || state.entry === 'popular') { path = `library/${state.entry}`; if (state.entry === 'popular') params.set('period', state.period) }
    if (state.entry === 'favorites') path = 'favorites'
    try {
      const result = await session.call<Page<Song | Artist>>(`${path}?${params}`)
      if (turn !== sequence || token !== session.state.credential?.token) return
      if (state.entry === 'artists' && !state.artist) state.artists = (more ? [...state.artists, ...result.items] : result.items) as Artist[]
      else state.songs = (more ? [...state.songs, ...result.items] : result.items) as Song[]
      state.total = result.totalElements; state.page = page
    } catch (e) { if (turn === sequence) state.error = e instanceof Error ? e.message : '曲库读取失败' }
    finally { if (turn === sequence) state.loading = false }
  }
  async function tags() { try { state.tags = await session.call<Tag[]>('library/classification-tags') } catch (e) { state.error = e instanceof Error ? e.message : '分类读取失败' } }
  async function openArtist(artist: Artist) {
    artistScroll = scroll.position(); artistQuery = state.query; cache = { artists: state.artists, total: state.total, page: state.page }
    suppressFilter = true; state.artist = artist; state.query = ''; await nextTick(); suppressFilter = false; await load(); scroll.move(0)
  }
  async function closeArtist() {
    suppressFilter = true; sequence++; state.artist = null; state.query = artistQuery; state.loading = false
    if (cache) { state.artists = cache.artists; state.total = cache.total; state.page = cache.page }
    await nextTick(); suppressFilter = false
    requestAnimationFrame(() => scroll.move(artistScroll))
  }
  function toggleTag(id: string) { state.selected = state.selected.includes(id) ? state.selected.filter(t => t !== id) : [...state.selected, id] }
  const stop = watch(() => session.state.credential?.token, async token => {
    sequence++; state.tags = []; state.songs = []; state.artists = []; state.artist = null; state.selected = []; state.total = 0; state.query = ''
    if (token) { await Promise.allSettled([tags(), load()]) }
  }, { immediate: true })
  let debounce: ReturnType<typeof setTimeout> | undefined
  const stopFilters = watch(() => [state.query, state.period, state.selected.join(',')], () => {
    clearTimeout(debounce); if (suppressFilter) { suppressFilter = false; return }; debounce = setTimeout(() => { void load() }, 180)
  })
  const stopFavorites = watch(() => session.state.favoriteRevision, () => { if (state.entry === 'favorites') void load() })
  function close() { sequence++; stop(); stopFilters(); stopFavorites(); clearTimeout(debounce) }
  return { state, load, tags, toggleTag, openArtist, closeArtist, close }
}
export type PartyLibrary = ReturnType<typeof usePartyLibrary>
