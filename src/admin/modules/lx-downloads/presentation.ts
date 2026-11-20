import type { Track } from './api'

/** Decode catalog text as text only; never interpret provider strings as markup. */
export function catalogText(value: string) {
  const entities: Record<string, string> = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>' }
  let text = value.replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
  for (let i = 0; i < 2; i++) text = text.replace(/&(#x[0-9a-f]+|#\d+|amp|nbsp|quot|apos|lt|gt);/gi, (original, code: string) => {
    if (!code.startsWith('#')) return entities[code.toLowerCase()] || original
    const point = Number.parseInt(code.slice(code[1]?.toLowerCase() === 'x' ? 2 : 1), code[1]?.toLowerCase() === 'x' ? 16 : 10)
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : original
  })
  return text.replace(/[\u0000-\u001f\u007f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim()
}
export function displayTrack(track: Track): Track {
  return { ...track, title: catalogText(track.title), album: catalogText(track.album), artists: track.artists.map(catalogText).filter(name => name && !/^nbsp$/i.test(name)) }
}
export const versionNames = { all: '全部版本', live: '现场 / 演唱会', instrumental: '伴奏 / 纯音乐', remix: '重混 / DJ', other: '其他或未标注版本' }
export type VersionFilter = keyof typeof versionNames
export function recordingVersion(track: Track): Exclude<VersionFilter, 'all'> {
  const text = `${track.title} ${track.album}`
  if (/伴奏|纯音乐|instrumental|karaoke|off\s*vocal/i.test(text)) return 'instrumental'
  if (/remix|\bdj\b|重混|混音/i.test(text)) return 'remix'
  if (/\blive\b|现场|演唱会|音乐会/i.test(text)) return 'live'
  return 'other'
}
function normalize(value: string) { return catalogText(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '') }
export function relevance(track: Track, query: string) {
  const tokens = query.trim().split(/\s+/).map(normalize).filter(Boolean)
  const title = normalize(track.title), artist = normalize(track.artists.join(' ')), album = normalize(track.album)
  const scores = tokens.map(token => title === token ? 8 : title.includes(token) ? 6 : artist.includes(token) ? 4 : album.includes(token) ? 1 : 0)
  const compactQuery = normalize(query)
  const titleMention = title.length > 1 && compactQuery.includes(title) ? 30 : 0
  const artistMention = track.artists.some(name => normalize(name).length > 1 && compactQuery.includes(normalize(name))) ? 10 : 0
  return titleMention + artistMention + scores.reduce<number>((sum, score) => sum + score, 0) + (scores.length && scores.every(score => score > 0) ? 100 : 0)
}
export function searchResults(tracks: Track[], query: string, filter: string, version: VersionFilter, sort: string) {
  const tokens = filter.trim().split(/\s+/).map(normalize).filter(Boolean)
  const rows = tracks.filter(track => (version === 'all' || recordingVersion(track) === version)
    && tokens.every(token => normalize(`${track.title} ${track.artists.join(' ')} ${track.album}`).includes(token)))
  return sort === 'platform' ? rows : rows.slice().sort((a, b) => relevance(b, query) - relevance(a, query))
}
export function downloadName(tracks: Track[], collection?: string) {
  const first = tracks[0] ? displayTrack(tracks[0]) : undefined
  const identity = catalogText(collection || '') || (first ? `${first.title} · ${first.artists.join(' / ')}` : '歌曲下载')
  return `${identity.slice(0, 150)}${tracks.length > 1 ? ` 等 ${tracks.length} 首` : ''}`
}
