import type { MetadataCandidate } from './types'
/** Only preview an unambiguous high-scoring result; scores do not identify a recording version. */
export function highSimilarityCandidate(candidates: MetadataCandidate[], threshold: number): MetadataCandidate | null {
  let best: MetadataCandidate | null = null
  for (const candidate of candidates) if (candidate.score >= threshold && (!best || candidate.score > best.score)) best = candidate
  return best && !hasCloseAlternative(candidates, best) ? best : null
}
export function hasCloseAlternative(candidates: MetadataCandidate[], selected: MetadataCandidate): boolean {
  // Match the server's thousandth precision so an exact eight-point gap stays distinct.
  const selectedScore = Math.round(selected.score * 1000)
  return candidates.some(candidate => candidate.id !== selected.id && selectedScore - Math.round(candidate.score * 1000) < 80)
}

/** Keep recording evidence visible before a user selects a candidate. */
export function candidateDetails(candidate: MetadataCandidate): string {
  const track = candidate.track
  const evidence = [track.title, track.album, ...track.aliases].filter(Boolean).join(' ')
  const version = /\blive\b|现场|演唱会|concert/i.test(evidence) ? '现场 / 演唱会' : /伴奏|instrumental|karaoke/i.test(evidence) ? '伴奏' : /remix|混音/i.test(evidence) ? '混音版' : '版本未标注'
  const seconds = track.durationMs == null ? null : Math.round(track.durationMs / 1000)
  const duration = seconds == null ? '时长未知' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return [track.album || '专辑未知', track.releaseDate || '日期未知', duration, version].join(' · ')
}
