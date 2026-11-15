import type { RouteRecordRaw } from 'vue-router'

export const overviewRoutes: RouteRecordRaw[] = [
  { path: '/overview', component: () => import('./views/OverviewView.vue'), meta: { title: '概览' } },
]
