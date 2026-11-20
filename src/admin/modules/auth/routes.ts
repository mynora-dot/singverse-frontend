import type { RouteRecordRaw } from 'vue-router'

const HomeView = () => import('../home/views/HomeView.vue')

export const authRoutes: RouteRecordRaw[] = [
  { path: '/', component: HomeView, meta: { title: '管理中心', public: true } },
  { path: '/login', component: HomeView, meta: { title: '登录', public: true } },
]
