import type { RouteRecordRaw } from 'vue-router'
export const computeSettingsRoutes: RouteRecordRaw[] = [
  { path: '/system/compute', component: () => import('./views/ComputeSettingsView.vue'), meta: { title: '计算服务', activeMenu: '/system/compute' } },
]
