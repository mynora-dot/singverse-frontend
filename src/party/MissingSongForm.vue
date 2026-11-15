<script setup lang="ts">
import { ref } from 'vue'
import { PartyHttpError, requestId } from './api'
import type { PartySession } from './usePartySession'
const props = defineProps<{ keyword: string; session: PartySession }>()
const title = ref(props.keyword), artist = ref(''), version = ref(''), description = ref(''), busy = ref(false), done = ref(false), error = ref('')
let pending: { requestId: string; title: string; artist: string; versionLabel: string; description: string } | null = null
const frozen = ref(false)
async function submit() {
  if (busy.value || done.value || !title.value.trim()) return
  pending ??= { requestId: requestId(), title: title.value.trim(), artist: artist.value.trim(), versionLabel: version.value.trim(), description: description.value.trim() }
  busy.value = true; frozen.value = true; error.value = ''
  try { await props.session.call('missing-song-feedback', 'POST', pending); done.value = true }
  catch (e) { error.value = e instanceof Error ? e.message : '发送失败，内容已保留'; if (e instanceof PartyHttpError && e.status >= 400 && e.status < 500) { pending = null; frozen.value = false } }
  finally { busy.value = false }
}
</script>
<template><div v-if="done" class="empty-state compact" role="status"><h3>缺歌反馈已记录</h3><p>已进入本 NAS 的处理列表，管理员补齐后就能点唱。</p></div><form v-else class="stack" @submit.prevent="submit"><p class="muted">没找到想唱的歌？留下歌名，交给家里的管理员补齐。</p><label class="field"><span class="field-label">歌名<span class="required">必填</span></span><input v-model="title" required maxlength="200" :disabled="frozen" autocomplete="off" placeholder="想唱哪一首？"></label><label class="field"><span class="field-label">歌手<span class="muted">选填</span></span><input v-model="artist" maxlength="200" :disabled="frozen" autocomplete="off" placeholder="例如：周杰伦"></label><label class="field"><span class="field-label">想要的版本<span class="muted">选填</span></span><input v-model="version" maxlength="100" :disabled="frozen" placeholder="例如：MV、演唱会、伴奏"></label><label class="field"><span class="field-label">补充说明<span class="muted">选填</span></span><textarea v-model="description" maxlength="2000" :disabled="frozen" rows="3" placeholder="也可以留空" /></label><p v-if="error" class="inline-error" role="alert">{{ error }}{{ frozen ? '，可重试同一条反馈，不会重复登记。' : '' }}</p><button class="primary full" :disabled="busy || !title.trim()">{{ busy ? '正在提交…' : frozen ? '重试这条反馈' : '提交缺歌反馈' }}</button></form></template>
