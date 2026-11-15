<script setup lang="ts">
// 为 NodeTab 的模型与设备交互测试提供节点加载和刷新；生产入口由 ComputeOverview 管理。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import NodeTab from '../../src/admin/modules/audio-processing/components/NodeTab.vue'
import { base, type Node } from '../../src/admin/modules/audio-processing/api'
import { readiness, failure } from '../../src/admin/modules/audio-processing/presentation'
import { authRequest } from '../../src/admin/core/auth/api'

const node = ref<Node>(), error = ref('')
const ready = computed(() => readiness(node.value, error.value))
let active = true, generation = 0
async function reload(refresh = false) {
  const turn = ++generation
  try {
    const value = await authRequest<Node>(`${base}/node${refresh ? '?refresh=true' : ''}`, 'GET', undefined, 60000)
    if (active && turn === generation) { node.value = value; error.value = '' }
  } catch (e) { if (active && turn === generation) { node.value = undefined; error.value = failure(e) } }
}
onMounted(() => { void reload() })
onBeforeUnmount(() => { active = false; generation++ })
</script>

<template><NodeTab :node="node" :node-error="error" :readiness="ready" :reload="reload" /></template>
