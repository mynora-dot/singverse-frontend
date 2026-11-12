import { onBeforeUnmount, onMounted, ref } from 'vue'
import { authRequest } from '../../core/auth/api'
import { base, type Node } from '../audio-processing/api'
import { failure } from '../audio-processing/presentation'
import type { HardwareSettingsValue } from './hardware'

/** 只通过同源 Go 接口读取节点；连接变化由父组件 key 隔离迟到结果。 */
export function useComputeResources(videoEnabled: boolean, audioEnabled: boolean) {
  const node = ref<Node>(), hardware = ref<HardwareSettingsValue>()
  const nodeError = ref(''), hardwareError = ref(''), actionError = ref('')
  const nodeLoading = ref(audioEnabled), hardwareLoading = ref(videoEnabled), busy = ref(false)
  let active = true, nodeGeneration = 0, hardwareGeneration = 0, timer: ReturnType<typeof setTimeout> | undefined
  async function reloadNode(refresh = false) {
    if (!audioEnabled) return
    const turn = ++nodeGeneration
    nodeLoading.value = true
    try {
      const value = await authRequest<Node>(`${base}/node${refresh ? '?refresh=true' : ''}`, 'GET', undefined, 60000)
      if (active && turn === nodeGeneration) { node.value = value; nodeError.value = '' }
    } catch (error) { if (active && turn === nodeGeneration) nodeError.value = failure(error, '读取伴奏准备情况失败，请重试。') }
    finally { if (active && turn === nodeGeneration) nodeLoading.value = false }
  }
  async function reloadHardware() {
    if (!videoEnabled && !audioEnabled) return
    const turn = ++hardwareGeneration
    hardwareLoading.value = true
    try {
      const value = await authRequest<HardwareSettingsValue>('/api/v1/transcoding/hardware-settings')
      if (active && turn === hardwareGeneration) { hardware.value = value; hardwareError.value = '' }
    } catch (error) { if (active && turn === hardwareGeneration) hardwareError.value = failure(error, '读取视频和共享策略失败，请重试。') }
    finally { if (active && turn === hardwareGeneration) hardwareLoading.value = false }
  }
  async function run(task: () => Promise<unknown>, refresh = false) {
    if (busy.value || !active) return
    busy.value = true; actionError.value = ''
    try { await task(); if (active) await reloadNode(refresh) }
    catch (error) { if (active) actionError.value = failure(error) }
    finally { if (active) busy.value = false }
  }
  async function saveFallback(enabled: boolean) {
    if (!hardware.value || busy.value) return false
    const current = hardware.value
    busy.value = true; actionError.value = ''
    try {
      const value = await authRequest<HardwareSettingsValue>('/api/v1/transcoding/hardware-settings', 'POST', { backend: current.backend, revision: current.revision, cpuFallback: enabled }, 45000)
      if (!active) return false
      hardware.value = value; hardwareError.value = ''
      await reloadNode()
      return true
    } catch (error) { if (active) actionError.value = failure(error, '保存共享策略失败，请重新读取后重试。'); return false }
    finally { if (active) busy.value = false }
  }
  async function poll() {
    if (!busy.value) await reloadNode()
    if (active && audioEnabled) timer = setTimeout(poll, 4000)
  }
  onMounted(() => { void reloadHardware(); if (audioEnabled) void poll() })
  onBeforeUnmount(() => { active = false; nodeGeneration++; hardwareGeneration++; clearTimeout(timer) })
  return { node, hardware, nodeError, hardwareError, actionError, nodeLoading, hardwareLoading, busy, reloadNode, reloadHardware, run, saveFallback }
}
