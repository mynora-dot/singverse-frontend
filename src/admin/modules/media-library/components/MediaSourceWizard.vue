<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{ step: 1 | 2 | 3; editing: boolean }>()
const heading = ref<HTMLHeadingElement>()
const steps = ['连接歌曲来源', '添加方式', '确认添加']
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
        </header>
        <slot />
      </div>
      <footer :class="editing ? 'source-editor-actions' : 'source-wizard-actions'">
        <slot name="actions" />
      </footer>
    </div>

  </div>
</template>

<style scoped>
.source-wizard-layout { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; }
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
.source-wizard-actions { position: sticky; bottom: -24px; z-index: 2; padding: 18px 24px; border-top: 1px solid var(--sv-border-subtle); border-radius: 0 0 10px 10px; background: var(--sv-surface-2); box-shadow: var(--sv-shadow-sm); }
.source-editor-actions { margin-top: 24px; }
@media(max-width: 600px) {
  .source-wizard-steps { padding: 18px 16px; gap: 8px; }
  .source-wizard-steps li { gap: 6px; font-size: 12px; }
  .step-marker { flex-basis: 22px; height: 22px; font-size: 12px; }
  .source-wizard-fields { padding: 24px 20px; min-height: 0; }
  .source-step-header { margin-bottom: 22px; }
  .source-wizard-actions { bottom: -10px; padding: 16px; }
}
</style>
