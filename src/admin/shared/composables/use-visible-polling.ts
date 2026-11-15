import { onBeforeUnmount, onMounted } from 'vue'

type PollReason = 'initial' | 'resume' | 'timer' | 'manual'

/** 等上一轮完成后再计时；隐藏页面不启动请求，恢复可见时立即更新。 */
export function useVisiblePolling(
  task: (reason: PollReason) => Promise<unknown>,
  delay: () => number | undefined,
  { immediate = true }: { immediate?: boolean } = {},
) {
  let mounted = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: Promise<void> | undefined

  function clear() { clearTimeout(timer); timer = undefined }
  function schedule() {
    clear()
    if (!mounted || document.hidden || pending) return
    const milliseconds = delay()
    if (milliseconds !== undefined) timer = setTimeout(() => { void refresh('timer') }, milliseconds)
  }
  function refresh(reason: PollReason = 'manual'): Promise<void> {
    clear()
    if (!mounted || document.hidden) return Promise.resolve()
    if (pending) return pending
    // 页面负责展示读取错误；失败后仍按当前间隔重试，避免后台 Promise 未处理。
    pending = Promise.resolve().then(() => {
      if (mounted && !document.hidden) return task(reason)
    }).catch(() => undefined).then(() => {
      pending = undefined
      schedule()
    })
    return pending
  }
  function visibilityChanged() {
    if (document.hidden) clear()
    else void refresh('resume')
  }
  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', visibilityChanged)
    if (immediate) void refresh('initial')
    else schedule()
  })
  onBeforeUnmount(() => {
    mounted = false
    clear()
    document.removeEventListener('visibilitychange', visibilityChanged)
  })
  return { refresh, schedule, clear }
}
