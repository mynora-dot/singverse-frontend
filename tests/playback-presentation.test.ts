import { expect, it } from 'vitest'
import type { PlaybackEntry } from '../src/admin/modules/playback-history/api'
import { inclusionLabel } from '../src/admin/modules/playback-history/presentation'

it('解释后端的计入结果，区分后台试听、短歌未播完和不足30秒', () => {
  const entry: Pick<PlaybackEntry, 'effective' | 'clientType' | 'playedMs' | 'durationMs' | 'status'> = { effective: false, clientType: 'TV', playedMs: 12000, durationMs: 240000, status: 'SKIPPED' }
  expect(inclusionLabel(entry)).toBe('未计入：不足30秒')
  expect(inclusionLabel({ ...entry, clientType: 'ADMIN', playedMs: 240000 })).toBe('未计入：后台试听')
  expect(inclusionLabel({ ...entry, durationMs: 20000 })).toBe('未计入：短歌未播完')
  expect(inclusionLabel({ ...entry, effective: true, playedMs: 10000, durationMs: 10000, status: 'COMPLETED' })).toBe('计入热门排行')
  // Do not invent an exclusion reason when the record cannot explain the server result.
  expect(inclusionLabel({ ...entry, playedMs: 240000, status: 'COMPLETED' })).toBe('未计入热门排行')
})
