import type { RouteRecordRaw } from 'vue-router'

export const systemStatusRoutes: RouteRecordRaw[] = [
  { path: '/system', component: () => import('./views/SystemView.vue'), meta: { title: '服务状态' } },
]
