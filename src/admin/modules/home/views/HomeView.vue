<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElDialog } from 'element-plus'
import { Close, Lock } from '@element-plus/icons-vue'
import LoginView from '../../auth/views/LoginView.vue'
import HomeProductPreview from '../components/HomeProductPreview.vue'
import nightRoom from '../assets/night-room.webp'
import '../home.css'

const route = useRoute(), router = useRouter()
const loginOpen = ref(false)
const loginTarget = ref<string>()
const loginForm = ref<InstanceType<typeof LoginView>>()
const mainContent = ref<HTMLElement>(), librarySection = ref<HTMLElement>(), flowSection = ref<HTMLElement>()

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
      <div class="sv-home-header-inner sv-home-wrap">
        <a class="sv-home-brand" href="#/" aria-label="SingVerse 首页" @click.prevent="jumpTo(mainContent)">
          <img src="/assets/brand/logo-mark.svg" width="40" height="40" alt="">
          <span class="sv-home-wordmark">SingVerse<span>.</span></span>
        </a>
        <nav class="sv-home-nav" aria-label="首页导航">
          <a href="#home-library" @click.prevent="jumpTo(librarySection)">界面预览</a>
          <a href="#home-flow" @click.prevent="jumpTo(flowSection)">从曲库到客厅</a>
          <a href="/downloads/">下载客户端</a>
          <button class="sv-home-login-top" type="button" @click="openLogin()">登录</button>
        </nav>
      </div>
    </header>
    <main id="home-main" ref="mainContent" tabindex="-1">
      <section class="sv-home-hero" aria-labelledby="home-hero-title">
        <img class="sv-home-scene" :src="nightRoom" width="1672" height="941" fetchpriority="high" alt="暖灯下的夜间客厅，电视、沙发和吉他；场景概念图">
        <p class="sv-home-scene-caption">客厅场景概念图</p>
        <div class="sv-home-hero-content sv-home-wrap">
          <h1 id="home-hero-title"><span>今晚的主场，</span><span>就在家。</span></h1>
          <div class="sv-home-hero-details">
            <p class="sv-home-description">整理 NAS 里的歌曲和歌单，<br>为今晚的客厅欢唱做好准备。</p>
            <div class="sv-home-actions">
              <button class="sv-home-primary" type="button" @click="openLogin()">登录管理中心</button>
              <a class="sv-home-quiet" href="#home-library" @click.prevent="jumpTo(librarySection)">看看管理界面</a>
            </div>
            <p class="sv-home-privacy"><Lock aria-hidden="true" />歌曲和资料，留在自家 NAS。</p>
          </div>
        </div>
      </section>
      <section id="home-library" ref="librarySection" class="sv-home-product" aria-labelledby="home-library-title" tabindex="-1">
        <div class="sv-home-wrap">
          <div class="sv-home-section-intro">
            <h2 id="home-library-title">从这里，准备今晚的歌。</h2>
            <p>界面预览 · 示例数据</p>
          </div>
          <div class="sv-home-product-layout">
            <figure class="sv-home-product-figure">
              <HomeProductPreview @login="openLogin" />
              <figcaption>歌曲来源预览 · 17 首歌曲为示例数据。</figcaption>
            </figure>
            <div id="home-flow" ref="flowSection" class="sv-home-flow" tabindex="-1">
              <h3>在电脑前整理，<br>到客厅里开唱。</h3>
              <p class="sv-home-flow-lead">管理中心把准备工作放在一起，让家里的歌曲随时有序。</p>
              <ol class="sv-home-steps">
                <li><div><span>连接 NAS 歌曲</span><p>添加歌曲来源，查看扫描与入库情况。</p></div></li>
                <li><div><span>整理曲库和歌单</span><p>补全歌曲信息，把喜欢的歌放在一起。</p></div></li>
                <li><div><span>把今晚留给欢唱</span><p>准备好客厅客户端，<br>和家人唱熟悉的歌。</p></div></li>
              </ol>
            </div>
          </div>
        </div>
      </section>
      <section class="sv-home-hosting" aria-labelledby="home-hosting-title">
        <div class="sv-home-hosting-inner sv-home-wrap">
          <h2 id="home-hosting-title"><span>歌在家里，</span><span>主场也在家里。</span></h2>
          <div>
            <p>歌曲、曲库和歌单数据都留在自家 NAS。<br>由你管理，为每一次客厅欢唱做好准备。</p>
            <div class="sv-home-actions">
              <button class="sv-home-primary" type="button" @click="openLogin()">登录管理中心</button>
              <a class="sv-home-quiet" href="/downloads/">下载客户端</a>
            </div>
          </div>
        </div>
      </section>
    </main>
    <footer class="sv-home-footer">
      <div class="sv-home-footer-inner sv-home-wrap">
        <a class="sv-home-brand" href="#/" aria-label="SingVerse 返回顶部" @click.prevent="jumpTo(mainContent)">
          <img src="/assets/brand/logo-mark.svg" width="30" height="30" alt="">
          <span class="sv-home-wordmark">SingVerse<span>.</span></span>
        </a>
        <p>家庭曲库，自家主场。</p>
        <a href="/downloads/">下载客户端</a>
      </div>
    </footer>
    <ElDialog v-model="loginOpen" class="home-login-dialog" modal-class="home-login-overlay" title="登录管理中心" aria-describedby="login-description" align-center append-to-body destroy-on-close :show-close="false" @open-auto-focus="focusLogin" @opened="focusLogin" @close="closeLogin">
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
