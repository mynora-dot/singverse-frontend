import { getJson } from '../admin/shared/http/client'
export type Platform = 'mobile' | 'tv'
export type ReleaseVariant = { abi: string; size: number; sha256: string; url: string }
export type ClientRelease = { available: boolean; versionCode?: number; versionName?: string; packageName?: string; minSdk?: number; abis?: string[]; size?: number; sha256?: string; certificateSha256?: string; notes?: string; url?: string; variants?: ReleaseVariant[] }
export async function readRelease(platform: Platform): Promise<ClientRelease> {
  const raw = await getJson(`/api/v1/client-releases/${platform}`)
  if (!raw || typeof raw !== 'object' || typeof (raw as ClientRelease).available !== 'boolean') throw new Error('安装包信息无效')
  const release = raw as ClientRelease
  if (!release.available) return { available: false }
  if (!Number.isSafeInteger(release.versionCode) || release.versionCode! < 1 ||
      typeof release.versionName !== 'string' || !release.versionName.trim() ||
      release.packageName !== `com.mynora.singverse.${platform}` ||
      !Number.isSafeInteger(release.size) || release.size! < 1 || release.size! > 268435456 ||
      !Number.isSafeInteger(release.minSdk) || release.minSdk! < (platform === 'tv' ? 21 : 24) ||
      !Array.isArray(release.abis) || !release.abis.length || release.abis.some(abi => typeof abi !== 'string') ||
      !/^[a-f0-9]{64}$/.test(release.sha256 ?? '') || !/^[a-f0-9]{64}$/.test(release.certificateSha256 ?? '') ||
      (release.notes !== undefined && typeof release.notes !== 'string') ||
      release.url !== `/api/v1/client-releases/${platform}/apk`) throw new Error('安装包信息不完整或下载地址无效')
  if (release.variants !== undefined) {
    const allowed = platform === 'tv' ? ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'] : ['armeabi-v7a', 'arm64-v8a', 'x86_64']
    if (!Array.isArray(release.variants) || !release.variants.length || release.variants.length > allowed.length ||
        release.variants.some(variant => !variant || !allowed.includes(variant.abi) ||
          !Number.isSafeInteger(variant.size) || variant.size < 1 || variant.size > 268435456 ||
          !/^[a-f0-9]{64}$/.test(variant.sha256) || variant.url !== `/api/v1/client-releases/${platform}/apk?abi=${variant.abi}`) ||
        new Set(release.variants.map(variant => variant.abi)).size !== release.variants.length) throw new Error('分架构安装包信息或下载地址无效')
  }
  return release
}
export function reachableOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && !['localhost', '::1', '[::1]', '0.0.0.0'].includes(url.hostname.toLowerCase()) &&
      !/^127\./.test(url.hostname) && !url.hostname.endsWith('.localhost')
  } catch { return false }
}
