<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { SourceType } from '../types'

const props = defineProps<{ step: 1 | 2 | 3; editing: boolean; sourceType: SourceType; importing: boolean }>()
const heading = ref<HTMLHeadingElement>()
const steps = ['连接歌曲来源', '添加方式', '确认添加']
const description = computed(() => props.step === 1
  ? '选择歌曲文件所在位置并填写访问方式。资料包是可选项。'
  : props.step === 2
    ? props.sourceType === 'LOCAL' ? '扫描本地目录，整理歌曲资料。按需调整识别与扫描设置。' : '默认直接扫描目录，也可以选用已有资料包。'
    : props.importing ? '核对以下设置。保存来源后上传资料包，接着预览路径并确认导入。' : '核对以下设置。确认后开始处理，也可以先仅保存来源。')
const guidance = computed(() => props.importing ? [
  { title: '先核对资料', detail: '来源保存后上传资料包，预览路径并确认导入。' },
  { title: '再核验媒体位置', detail: '资料分批保存，后台检查对应文件的路径和可用大小。' },
  { title: '复用已有结论', detail: '完整音轨映射核验后复用，只补充缺失的信息。' },
] : [
  { title: '连接媒体位置', detail: props.sourceType === 'LOCAL' ? '选择媒体服务所在设备可以访问的目录。' : '使用自己的 WebDAV 地址与访问凭据。无需资料包。' },
  { title: '扫描并整理歌曲', detail: props.sourceType === 'LOCAL' ? '优先读取文件内的歌曲信息，缺失时从文件名补充。' : '先从目录与文件名整理资料，可按需开启文件内信息读取。' },
  { title: '只补充缺失信息', detail: '单轨歌曲作为原唱；KTV 音轨缺少资料时才做必要识别。' },
])
watch(() => props.step, async () => {
  if (props.editing) return
  await nextTick()
  heading.value?.focus({ preventScroll: true })
  const body = heading.value?.closest('.el-dialog__body')
  if (body) body.scrollTop = 0
})
</script>

<template>
  <div :class="editing ? 'source-editor' : 'source-wizard-layout'">
    <div :class="{ 'source-wizard-main': !editing }">
      <ol v-if="!editing" class="source-wizard-steps" aria-label="添加歌曲来源进度">
        <li v-for="(label, index) in steps" :key="label" :class="{ current: step === index + 1, complete: step > index + 1 }" :aria-current="step === index + 1 ? 'step' : undefined">
          <span class="step-marker" aria-hidden="true">{{ step > index + 1 ? '✓' : index + 1 }}</span>
          <span>{{ label }}</span>
        </li>
      </ol>
      <div :class="{ 'source-wizard-fields': !editing }">
        <header v-if="!editing" class="source-step-header">
          <h2 ref="heading" tabindex="-1">{{ steps[step - 1] }}</h2>
          <p>{{ description }}</p>
        </header>
        <slot />
      </div>
      <footer :class="editing ? 'source-editor-actions' : 'source-wizard-actions'">
        <slot name="actions" />
      </footer>
    </div>
    <aside v-if="!editing" class="source-wizard-guide" aria-label="添加说明">
      <h3>这次添加会做什么</h3>
      <div v-for="item in guidance" :key="item.title" class="source-guidance-item">
        <strong>{{ item.title }}</strong>
        <p>{{ item.detail }}</p>
      </div>
      <p class="source-background-note">{{ importing ? '开始导入后' : '选择保存并扫描后' }}，任务会在后台继续。可以稍后回到来源查看进度，个别文件失败不影响已完成的资料。</p>
    </aside>
  </div>
</template>

<style scoped>
.source-wizard-layout { display: grid; grid-template-columns: minmax(0, 1fr) 238px; gap: 24px; align-items: start; }
.source-wizard-main { min-width: 0; border: 1px solid var(--sv-border-subtle); border-radius: 10px; background: var(--sv-surface-2); }
.source-wizard-steps { display: flex; list-style: none; margin: 0; padding: 22px 26px; gap: 16px; border-bottom: 1px solid var(--sv-border-subtle); }
.source-wizard-steps li { flex: 1; display: flex; align-items: center; gap: 8px; color: var(--sv-text-tertiary); font-size: 13px; white-space: nowrap; }
.step-marker { display: grid; place-items: center; flex: 0 0 26px; height: 26px; border: 1px solid var(--sv-border-default); border-radius: 50%; font-size: 12px; }
.source-wizard-steps .current { color: var(--sv-text-primary); font-weight: 600; }
.current .step-marker { color: var(--sv-on-accent); background: var(--sv-accent-primary); border-color: var(--sv-accent-primary); }
.source-wizard-steps .complete { color: var(--sv-semantic-ok); }
.complete .step-marker { border-color: var(--sv-semantic-ok); }
.source-wizard-fields { padding: 26px 28px; min-height: 290px; }
.source-step-header { margin-bottom: 24px; }
.source-step-header h2 { display: inline-block; margin: 0; color: var(--sv-text-primary); font-size: 20px; line-height: 1.5; font-weight: 600; }
.source-step-header h2:focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 4px; border-radius: 2px; }
.source-step-header p { margin: 7px 0 0; color: var(--sv-text-secondary); font-size: 14px; line-height: 1.75; }
.source-wizard-actions { position: sticky; bottom: -24px; z-index: 2; padding: 18px 24px; border-top: 1px solid var(--sv-border-subtle); border-radius: 0 0 10px 10px; background: var(--sv-surface-2); box-shadow: var(--sv-shadow-sm); }
.source-editor-actions { margin-top: 24px; }
.source-wizard-guide { padding: 23px 20px; border: 1px solid var(--sv-border-subtle); border-radius: 10px; background: var(--sv-surface-2); }
.source-wizard-guide h3 { margin: 0 0 8px; color: var(--sv-text-primary); font-size: 15px; line-height: 1.7; }
.source-guidance-item { padding: 19px 0; border-bottom: 1px solid var(--sv-border-subtle); }
.source-guidance-item strong { color: var(--sv-text-primary); font-size: 14px; font-weight: 600; }
.source-guidance-item p, .source-background-note { margin: 7px 0 0; color: var(--sv-text-secondary); font-size: 13px; line-height: 1.85; }
.source-background-note { margin-top: 18px; font-size: 12px; }
@media(max-width: 900px) {
  .source-wizard-layout { grid-template-columns: minmax(0, 1fr); }
  .source-wizard-guide { display: none; }
}
@media(max-width: 600px) {
  .source-wizard-steps { padding: 18px 16px; gap: 8px; }
  .source-wizard-steps li { gap: 6px; font-size: 12px; }
  .step-marker { flex-basis: 22px; height: 22px; font-size: 12px; }
  .source-wizard-fields { padding: 24px 20px; min-height: 0; }
  .source-step-header { margin-bottom: 22px; }
  .source-step-header p { font-size: 16px; }
  .source-wizard-actions { bottom: -10px; padding: 16px; }
}
</style>
