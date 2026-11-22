import type { MediaSong } from '../media-library/types'
import type { AppliedMetadata, FormalLyrics, MusicProvider } from './types'
export const editableReviewFields = ['title', 'artists', 'album', 'releaseDate', 'aliases', 'durationMs'] as const
export const reviewFields = [...editableReviewFields, 'lyrics', 'cover'] as const
export type ReviewField = typeof reviewFields[number]
export type Value = string | string[] | number | null
export type Values = Record<Exclude<ReviewField, 'lyrics'>, Value> & { lyrics?: FormalLyrics | null }
export type ReviewEdits = Partial<Pick<Values, typeof editableReviewFields[number]>>
export interface SingleReview { song: MediaSong; fingerprint: string; version: string; values: Values }
export type CoverQuality = 'ORIGINAL' | 'HIGH'
export interface ReviewApply { requestId: string; fingerprint: string; version: string; candidateId: string | null; fields: ReviewField[]; edits: ReviewEdits; coverCandidateId: string | null; coverAssetId: string | null; coverQuality?: CoverQuality }
export interface ReviewResult { metadata: AppliedMetadata | null; updated: ReviewField[]; skipped: ReviewField[]; retained: ReviewField[]; before: Values; after: Values }
export type CandidateLyrics = { status: 'AVAILABLE'; lyrics: FormalLyrics } | { status: 'MISSING' | 'UNSUPPORTED'; lyrics: null }
export type LyricsState = CandidateLyrics['status'] | 'IDLE' | 'LOADING' | 'ERROR'
export interface CoverAsset { id: string; mime: string; width: number; height: number; createdAt: string }
export interface CoverChoice { candidateId: string; provider: MusicProvider; externalId: string; title: string; artists: string[]; album: string | null; coverUrl: string; width: number | null; height: number | null }
export interface CoverSelection { kind: 'candidate' | 'asset' | 'current'; id: string; value: string; url: string; label: string; quality?: CoverQuality; provider?: MusicProvider; originalValue?: string; width?: number | null; height?: number | null }
