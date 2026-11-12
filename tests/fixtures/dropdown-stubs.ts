// 容器测试验证业务事件；真实浮层、关闭和禁用行为由 media-source-card.test.ts 覆盖。
// Teleport stub 会与 Element Plus 的触发器引用产生循环更新，因此这里同时替换菜单。
export const dropdownStubs = {
  ElDropdown: { template: '<div class="el-dropdown"><slot /><slot name="dropdown" /></div>' },
  ElDropdownMenu: { template: '<ul role="menu"><slot /></ul>' },
  ElDropdownItem: {
    props: { disabled: Boolean },
    emits: ['click'],
    template: '<li role="menuitem" :aria-disabled="disabled" @click="!disabled && $emit(\'click\', $event)"><slot /></li>',
  },
}
