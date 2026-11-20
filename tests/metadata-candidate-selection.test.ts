import { expect, it } from 'vitest'
import { hasCloseAlternative, highSimilarityCandidate } from '../src/admin/modules/metadata/candidate-selection'
import type { MetadataCandidate } from '../src/admin/modules/metadata/types'

function candidate(id: string, score: number): MetadataCandidate {
  return { id, score, track: { provider: 'QQ', externalId: id, title: '歌名', artists: ['歌手'], album: null, releaseDate: null, aliases: [], durationMs: null, coverUrl: null, availability: 'UNKNOWN', fetchedAt: '' } }
}

it.each([
  ['同分', .95, .95, true],
  ['相近', .95, .90, true],
  ['恰好八点且浮点相减偏小', .95, .87, false],
  ['恰好八点且浮点相减偏大', .93, .85, false],
  ['刚好低于八点', .95, .871, true],
  ['恰好八点伴随浮点噪声', .9499999999999999, .8700000000000001, false],
  ['低于八点伴随浮点噪声', .9500000000000001, .8710000000000001, true],
  ['统一为千分精度', .9496, .8704, false],
] as const)('%s：只有千分分差小于80时需人工选择', (_name, bestScore, otherScore, close) => {
  const best = candidate('best', bestScore), other = candidate('other', otherScore)
  expect(hasCloseAlternative([best, other], best)).toBe(close)
  expect(highSimilarityCandidate([other, best], .9)).toEqual(close ? null : best)
})
