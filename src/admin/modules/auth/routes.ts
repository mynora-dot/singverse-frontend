import type { RouteRecordRaw } from 'vue-router'

const HomeView = () => import('../home/views/HomeView.vue')

export const authRoutes: RouteRecordRaw[] = [
  { path: '/', component: HomeView, meta: { title: '家庭曲库，自家主场', public: true } },
  { path: '/login', component: HomeView, meta: { title: '登录', public: true } },
]
