import type { RouteRecordRaw } from 'vue-router'

export const systemParametersRoutes: RouteRecordRaw[] = [
  { path: '/system/parameters', component: () => import('./views/ParametersView.vue'), meta: { title: '账号与安全' } },
  { path: '/system/music-platforms', component: () => import('../metadata/views/MusicPlatformsView.vue'), meta: { title: '音乐平台' } },
]
