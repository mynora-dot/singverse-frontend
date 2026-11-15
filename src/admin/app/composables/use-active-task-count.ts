import { onBeforeUnmount, ref, watch } from 'vue'
import { auth, authRequest } from '../../core/auth/api'

/** 顶栏任务徽章：只取活跃总数，30s 轮询，页面隐藏或未登录时暂停。 */
export function useActiveTaskCount(intervalMs = 30000) {
  const count = ref(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = true, generation = 0
  let pending: { generation: number; promise: Promise<void> } | undefined
  function refresh(): Promise<void> {
    clearTimeout(timer)
    if (!active || !auth.account || document.visibilityState === 'hidden') return Promise.resolve()
    const token = generation
    if (pending?.generation === token) return pending.promise
    const promise = authRequest<{ totalElements?: number }>('/api/v1/background-tasks?view=ACTIVE&page=0&size=1')
      .then(page => { if (active && token === generation) count.value = page.totalElements ?? 0 })
      .catch(() => { /* 徽章是辅助信息，读取失败保留上次数值。 */ })
      .finally(() => {
        if (pending?.promise === promise) pending = undefined
        if (token === generation) schedule()
      })
    pending = { generation: token, promise }
    return promise
  }
  function schedule() {
    if (timer) clearTimeout(timer)
    if (!active || !auth.account || document.visibilityState === 'hidden') return
    timer = setTimeout(() => { void refresh() }, intervalMs)
  }
  function onVisibility() {
    if (document.visibilityState === 'visible') void refresh()
    else { generation++; clearTimeout(timer) }
  }
  watch(() => auth.account?.username, () => {
    generation++; count.value = 0; clearTimeout(timer)
    void refresh()
  }, { immediate: true, flush: 'sync' })
  document.addEventListener('visibilitychange', onVisibility)
  onBeforeUnmount(() => { active = false; generation++; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility) })
  return { count, refresh }
}
