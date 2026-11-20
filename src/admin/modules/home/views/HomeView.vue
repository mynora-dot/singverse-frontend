<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElDialog } from 'element-plus'
import { ArrowRight, Close, Collection, FolderOpened, Headset, MagicStick, Monitor, Setting } from '@element-plus/icons-vue'
import LoginView from '../../auth/views/LoginView.vue'
import ThemeSwitcher from '../../../shared/ui/ThemeSwitcher.vue'
import '../home.css'

const route = useRoute(), router = useRouter()
const loginOpen = ref(false)
const loginTarget = ref<string>()
const loginForm = ref<InstanceType<typeof LoginView>>()
const mainContent = ref<HTMLElement>()
const entries = [
  { title: '歌曲', path: '/library/songs', icon: Headset },
  { title: '歌曲来源', path: '/library/media', icon: FolderOpened },
  { title: '歌单', path: '/library/playlists', icon: Collection },
  { title: '歌曲信息', path: '/library/songs/metadata', icon: MagicStick },
  { title: '电视首页', path: '/system/tv-settings', icon: Monitor },
  { title: '设置', path: '/system/music-platforms', icon: Setting },
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
    <header class="sv-home-header sv-home-wrap">
      <a class="sv-home-brand" href="#/" aria-label="SingVerse 首页" @click.prevent="jumpTo(mainContent)">
        <img src="/assets/brand/logo-mark.svg" width="36" height="36" alt="">
        <span class="sv-home-wordmark">SingVerse<span>.</span></span>
      </a>
      <nav class="sv-home-nav" aria-label="公共入口">
        <a href="/party/">亲友点歌</a>
        <a href="/downloads/">下载客户端</a>
        <ThemeSwitcher />
      </nav>
    </header>
    <main id="home-main" ref="mainContent" class="sv-home-main sv-home-wrap" tabindex="-1">
      <div class="sv-home-heading">
        <h1>管理中心</h1>
        <button class="sv-home-primary" type="button" @click="openLogin()">登录</button>
      </div>
      <nav class="sv-home-entries" aria-label="管理功能">
        <button v-for="entry in entries" :key="entry.path" type="button" :aria-label="`登录后打开${entry.title}`" @click="openLogin(entry.path)">
          <component :is="entry.icon" class="sv-home-entry-icon" aria-hidden="true" />
          <span>{{ entry.title }}</span>
          <ArrowRight class="sv-home-entry-arrow" aria-hidden="true" />
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
