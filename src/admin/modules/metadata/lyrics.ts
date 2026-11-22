import type { FormalLyrics } from './types'

export function lyricText(lyrics?: FormalLyrics | null): string {
  if (!lyrics) return ''
  if (Array.isArray(lyrics.lines) && lyrics.lines.length) return lyrics.lines.map(line => line?.text ?? '').join('\n').trim()
  return (lyrics.text ?? '')
    .replace(/^[ \t]*\[(?:ti|ar|al|au|by|offset|length|re|ve|id|kana|high|language|total|tool):[^\]\r\n]*\][ \t]*(?:\r?\n|$)/gmi, '')
    .replace(/\[\d{1,3}:\d{2}(?:[.,:]\d{1,3})?\]/g, '')
    .trim()
}

export const hasLyrics = (lyrics?: FormalLyrics | null) => !!lyricText(lyrics)

export function sameLyrics(before?: FormalLyrics | null, after?: FormalLyrics | null): boolean {
  if (!before || !after) return !hasLyrics(before) && !hasLyrics(after)
  const key = ({ timing, text, language, lines }: FormalLyrics) => [
    timing, text?.replace(/\r\n/g, '\n').trim(), language,
    Array.isArray(lines) ? lines.map(line => [line?.time, line?.text]) : null,
  ]
  return JSON.stringify(key(before)) === JSON.stringify(key(after))
}
