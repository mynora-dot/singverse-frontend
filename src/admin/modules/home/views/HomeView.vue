<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElDialog } from 'element-plus'
import { ArrowRight, Close, Collection, Download, FolderOpened, Headset, MagicStick, Microphone, Monitor, Right, Setting } from '@element-plus/icons-vue'
import LoginView from '../../auth/views/LoginView.vue'
import ThemeSwitcher from '../../../shared/ui/ThemeSwitcher.vue'
import '../home.css'

const route = useRoute(), router = useRouter()
const loginOpen = ref(false)
const loginTarget = ref<string>()
const loginForm = ref<InstanceType<typeof LoginView>>()
const mainContent = ref<HTMLElement>()
const entries = [
  { title: '歌曲', description: '搜索曲目，管理歌曲文件', path: '/library/songs', icon: Headset, tone: 'blue' },
  { title: '歌曲来源', description: '连接本地目录和 WebDAV 曲库', path: '/library/media', icon: FolderOpened, tone: 'amber' },
  { title: '歌单', description: '创建歌单，编排歌曲顺序', path: '/library/playlists', icon: Collection, tone: 'green' },
  { title: '歌曲信息', description: '整理歌名、歌手与专辑封面', path: '/library/songs/metadata', icon: MagicStick, tone: 'purple' },
  { title: '电视首页', description: '更换客厅电视的首页轮播图', path: '/system/tv-settings', icon: Monitor, tone: 'teal' },
  { title: '设置', description: '配置音乐平台和歌曲信息来源', path: '/system/music-platforms', icon: Setting, tone: 'slate' },
]

watch(() => route.path, path => {
  loginTarget.value = undefined
  loginOpen.value = path === '/login'
}, { immediate: true })

function openLogin(destination?: string) {
  loginTarget.value = destination
  loginOpen.value = true
}
function closeLogin() {
  loginOpen.value = false
  if (route.path === '/login') void router.replace('/')
}
async function focusLogin() {
  await nextTick()
  if (loginOpen.value) void loginForm.value?.focusInitial()
}
function jumpTo(section?: HTMLElement) {
  if (!section) return
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  section.scrollIntoView({ behavior, block: 'start' })
  section.focus({ preventScroll: true })
}
</script>

<template>
  <div class="sv-home">
    <a class="sv-home-skip" href="#home-main" @click.prevent="jumpTo(mainContent)">跳到主要内容</a>
    <header class="sv-home-header">
      <div class="sv-home-bar sv-home-wrap">
        <a class="sv-home-brand" href="#/" aria-label="SingVerse 首页" @click.prevent="jumpTo(mainContent)">
          <img src="/assets/brand/logo-mark.svg" width="36" height="36" alt="">
          <span class="sv-home-wordmark">SingVerse<span>.</span></span>
        </a>
        <nav class="sv-home-nav" aria-label="公共入口">
          <a href="/party/"><Microphone aria-hidden="true" />亲友点歌</a>
          <a href="/downloads/"><Download aria-hidden="true" />下载客户端</a>
          <ThemeSwitcher />
        </nav>
      </div>
    </header>
    <main id="home-main" ref="mainContent" class="sv-home-main sv-home-wrap" tabindex="-1">
      <div class="sv-home-hero">
        <div class="sv-home-heading">
          <h1>管理中心</h1>
          <p>整理家庭曲库，设置客厅电视。</p>
          <button class="sv-home-primary" type="button" @click="openLogin()">管理员登录 <Right aria-hidden="true" /></button>
        </div>
      </div>
      <h2 id="home-shortcuts" class="sv-home-section-title">快捷入口</h2>
      <nav class="sv-home-entries" aria-labelledby="home-shortcuts">
        <button v-for="entry in entries" :key="entry.path" :data-tone="entry.tone" type="button" :aria-label="`登录后打开${entry.title}`" :aria-description="entry.description" @click="openLogin(entry.path)">
          <span class="sv-home-entry-icon"><component :is="entry.icon" aria-hidden="true" /></span>
          <ArrowRight class="sv-home-entry-arrow" aria-hidden="true" />
          <span class="sv-home-entry-copy"><strong>{{ entry.title }}</strong><span>{{ entry.description }}</span></span>
        </button>
      </nav>
    </main>
    <ElDialog v-model="loginOpen" class="home-login-dialog" modal-class="home-login-overlay" title="登录管理中心" align-center append-to-body destroy-on-close :show-close="false" @open-auto-focus="focusLogin" @opened="focusLogin" @close="closeLogin">
      <template #header="{ titleId }">
        <div class="home-login-header">
          <span :id="titleId" class="sr-only">登录管理中心</span>
          <div class="home-login-brand"><img src="/assets/brand/logo-mark.svg" width="33" height="33" alt=""><strong>SingVerse<span>.</span></strong></div>
          <button class="home-login-close" type="button" aria-label="关闭登录窗口" @click="closeLogin"><Close aria-hidden="true" /></button>
        </div>
      </template>
      <LoginView v-if="loginOpen" ref="loginForm" :redirect="loginTarget" @dismiss="closeLogin" />
    </ElDialog>
  </div>
</template>
