import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { authRequest } from '../../core/auth/api'
import { useVisiblePolling } from '../../shared/composables/use-visible-polling'

interface ShareJob {
  id: string
  state: string
  total_count: number
  processed_count: number
}

export function useSourceShare(sourceId: string, loadJobs = () => true) {
  const base = '/api/v1/media-sources/' + encodeURIComponent(sourceId) + '/embedded-metadata/share-jobs'
  const job = ref<ShareJob>()
  const busy = ref(false), error = ref(''), readError = ref(false)
  const active = computed(() => ['WAITING', 'QUEUED', 'RUNNING'].includes(job.value?.state ?? ''))
  const progress = computed(() => Math.min(99, Math.round((job.value?.processed_count ?? 0) * 100 / Math.max(1, job.value?.total_count ?? 0))))
  const download = computed(() => job.value?.state === 'SUCCEEDED' ? base + '/' + encodeURIComponent(job.value.id) + '/download' : '')
  let revision = 0, readVersion = 0
  onBeforeUnmount(() => { revision++ })

  async function read() {
    const token = revision, version = ++readVersion
    try {
      const latest = await authRequest<ShareJob>(base + '/latest')
      if (token !== revision || version !== readVersion) return
      job.value = latest?.id ? latest : undefined
      if (readError.value) error.value = ''
      readError.value = false
    } catch (cause) {
      if (token !== revision || version !== readVersion) return
      readError.value = true
      error.value = cause instanceof Error ? cause.message : '读取导出任务失败'
    }
  }
  const polling = useVisiblePolling(async () => { if (loadJobs()) await read() }, () => active.value ? 2000 : readError.value ? 10000 : undefined)
  watch(loadJobs, enabled => { if (enabled) void polling.refresh() })

  async function start() {
    if (busy.value || active.value) return
    const token = ++revision
    busy.value = true
    error.value = ''
    try {
      if (job.value?.state === 'FAILED') {
        await authRequest(base + '/' + encodeURIComponent(job.value.id) + '/resume', 'POST')
      } else {
        const created = await authRequest<ShareJob>(base, 'POST')
        if (token !== revision) return
        job.value = created
      }
      if (token === revision) await read()
    } catch (cause) {
      if (token === revision) error.value = cause instanceof Error ? cause.message : '导出资料包失败'
    } finally {
      if (token === revision) { busy.value = false; polling.schedule() }
    }
  }
  return { job, busy, error, active, progress, download, start }
}
