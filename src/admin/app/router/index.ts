import { createRouter, createWebHashHistory } from 'vue-router'
import { computeSettingsRoutes } from '../../modules/compute-settings/routes'
import { aiSettingsRoutes } from '../../modules/ai-settings/routes'
import { songManagementRoutes } from '../../modules/song-management/routes'
import { mediaLibraryRoutes } from '../../modules/media-library/routes'
import { filenameParserRoutes } from '../../modules/filename-parser/routes'
import { overviewRoutes } from '../../modules/overview/routes'
import NotFoundView from '../views/NotFoundView.vue'
import { authRoutes } from '../../modules/auth/routes'
import { systemParametersRoutes } from '../../modules/system-parameters/routes'
import { refreshAccount } from '../../core/auth/api'
import { readLoginPreferences, safeLoginRedirect } from '../../core/auth/login-preferences'
import { adminBasePath } from '../../core/hosting/mount-path'

export const router = createRouter({
  history: createWebHashHistory(adminBasePath),
  routes: [
    { path: '/system/assistant', component: () => import('../../modules/assistant/AssistantWorkbench.vue'), meta: { title: '管理助手' } },
    { path: '/system/client-downloads', component: () => import('../../modules/client-downloads/ClientDownloadsView.vue'), meta: { title: '客户端下载' } },
    { path: '/library/downloads', component: () => import('../../modules/lx-downloads/DownloadsView.vue'), meta: { title: '歌曲下载' } },
    { path: '/system/tasks', component: () => import('../../modules/background-tasks/BackgroundTasksView.vue'), meta: { title: '后台任务' } },
    { path: '/system/tasks/:id', component: () => import('../../modules/background-tasks/BackgroundTasksView.vue'), meta: { title: '任务详情', activeMenu: '/system/tasks' } },
    { path: '/library/cache', component: () => import('../../modules/song-cache/SongCacheView.vue'), meta: { title: '存储与缓存' } },
    ...mediaLibraryRoutes,
    ...songManagementRoutes,
    ...filenameParserRoutes,
    ...authRoutes,
    ...systemParametersRoutes,
    ...aiSettingsRoutes,
    ...computeSettingsRoutes,
    ...overviewRoutes,
    // 兼容旧书签和管理助手工具目录中的运行概况链接。
    { path: '/system', redirect: '/overview' },
    { path: '/:pathMatch(.*)*', component: NotFoundView, meta: { title: '页面不存在' } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  if (to.meta.public) {
    if (readLoginPreferences().autoLogin) {
      try { if (await refreshAccount()) return safeLoginRedirect(to.query.redirect) }
      catch { /* The public page and manual login remain available offline. */ }
    }
    return true
  }
  try {
    if (await refreshAccount()) return true
  } catch { /* 登录页提供网络错误与重试入口。 */ }
  return { path: '/login', query: { redirect: to.fullPath } }
})

router.afterEach((to) => {
  document.title = `${String(to.meta.title)} · SingVerse 家庭音乐中心`
})
