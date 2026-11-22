import { computed, shallowReactive, shallowRef, watch } from 'vue'
import { auth } from '../../core/auth/state'
import { shareImports, type ImportApplyMode, type ShareImportJob } from './api/shareImports'
import type { MediaSource } from './types'

type UploadSource = Pick<MediaSource, 'id' | 'name' | 'location'>
export interface PackageUpload {
  source: UploadSource
  file: File
  mode: ImportApplyMode
  controller?: AbortController
  error: string
}

// Only the browser transfer belongs to this tab. The server owns the job after HTTP 202.
export const packageUploads = shallowReactive(new Map<string, PackageUpload>())
export const acceptedUpload = shallowRef<{ sourceId: string; job: ShareImportJob }>()
export const uploadingCount = computed(() => [...packageUploads.values()].filter(item => item.controller).length)

function protectUpload(event: BeforeUnloadEvent) {
  event.preventDefault()
  event.returnValue = ''
}
watch(uploadingCount, count => {
  if (count) window.addEventListener('beforeunload', protectUpload)
  else window.removeEventListener('beforeunload', protectUpload)
}, { flush: 'sync' })

watch(() => auth.account?.username, (_, previous) => {
  if (!previous) return
  for (const item of packageUploads.values()) item.controller?.abort()
  packageUploads.clear()
  acceptedUpload.value = undefined
}, { flush: 'sync' })

export async function uploadPackage(source: UploadSource, file: File, mode: ImportApplyMode) {
  if (packageUploads.get(source.id)?.controller) return
  const controller = new AbortController()
  const item = { source: { id: source.id, name: source.name, location: source.location }, file, mode }
  packageUploads.set(source.id, { ...item, controller, error: '' })
  try {
    const job = await shareImports.upload(source.id, file, controller.signal, mode)
    if (packageUploads.get(source.id)?.controller !== controller) return
    packageUploads.delete(source.id)
    acceptedUpload.value = { sourceId: source.id, job }
  } catch (reason) {
    if (packageUploads.get(source.id)?.controller !== controller) return
    const error = controller.signal.aborted ? '上传已取消' : reason instanceof Error ? reason.message : '上传失败'
    packageUploads.set(source.id, { ...item, error })
  }
}
