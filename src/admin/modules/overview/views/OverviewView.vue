<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert, ElButton, ElIcon, ElSkeleton, ElSkeletonItem } from 'element-plus'
import { ArrowRight, ChatDotRound, Clock, Collection, Cpu, Download, DocumentChecked, FolderOpened, Headset, Plus, RefreshRight, Search, MagicStick, Microphone, TopRight } from '@element-plus/icons-vue'
import SongCover from '../../song-management/components/SongCover.vue'
import EmptyState from '../../../shared/ui/EmptyState.vue'
import { songTitle, songArtists } from '../../metadata/utils'
import { backgroundTasks, type BackgroundTask } from '../../background-tasks/api'
import { statusNames, progressText } from '../../background-tasks/presentation'
import { auth } from '../../../core/auth/api'
import { loadOverview, type AdminOverview } from '../api/overview'

const shortcuts = [
  { title: '添加来源', detail: '连接新的歌曲目录', to: '/library/media?add=LOCAL', icon: Plus },
  { title: '扫描来源', detail: '选择要扫描的目录', to: '/library/media', icon: FolderOpened },
  { title: '下载歌曲', detail: '搜索平台曲目', to: '/library/downloads', icon: Download },
  { title: '创建歌单', detail: '选歌并编排顺序', to: '/library/playlists?create=1', icon: Collection },
  { title: '整理歌曲信息', detail: '匹配歌手与封面', to: '/library/songs/metadata', icon: MagicStick },
  { title: '原唱与伴奏', detail: '分离和处理音轨', to: '/library/audio-processing', icon: Headset },
]

type Load<T> = { state: 'loading' | 'ready' | 'error'; value?: T; error?: string }
let active = true
const turns = new WeakMap<object, number>()
const data = reactive<Load<AdminOverview>>({ state: 'loading' })
const tasks = reactive<Load<BackgroundTask[]>>({ state: 'loading' })

async function fill<T>(target: Load<T>, task: () => Promise<T>) {
  const turn = (turns.get(target) ?? 0) + 1
  turns.set(target, turn)
  target.state = 'loading'
  target.error = undefined
  try { const value = await task(); if (active && turns.get(target) === turn) { target.value = value; target.state = 'ready' } }
  catch (error) { if (active && turns.get(target) === turn) { target.state = 'error'; target.error = error instanceof Error ? error.message : '读取失败' } }
}
function refreshOverview() { return fill(data, loadOverview) }
function refreshTasks() { return fill(tasks, async () => (await backgroundTasks.list({ view: 'ACTIVE', type: '', status: '', q: '', page: 0, size: 3 })).items.slice(0, 3)) }
function refresh() { void refreshOverview(); void refreshTasks() }
function pageVisible() { return document.visibilityState !== 'hidden' }
let timer: ReturnType<typeof setTimeout> | undefined
async function poll() { clearTimeout(timer); if (!active || !pageVisible()) return; await refreshTasks(); if (active && pageVisible()) timer = setTimeout(() => void poll(), 10000) }
function visibility() { clearTimeout(timer); if (pageVisible()) void poll() }
onMounted(() => { refresh(); document.addEventListener('visibilitychange', visibility); timer = setTimeout(() => void poll(), 10000) })
onBeforeUnmount(() => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility) })

const ov = computed(() => data.value)
function ok(key: keyof AdminOverview) {
  const d = ov.value
  if (!d) return false
  if (key in d.errors) return false
  return d[key] !== null && d[key] !== undefined
}
const fmt = (n: number) => n.toLocaleString('zh-CN')

type Todo = { key: string; level: 'danger' | 'warn' | 'info'; title: string; detail?: string; action: string; to: string }
const todos = computed<Todo[]>(() => {
  const list: Todo[] = []
  const d = ov.value
  if (auth.account?.defaultPassword) list.push({ key: 'password', level: 'danger', title: '仍在使用默认密码', action: '修改密码', to: '/system/parameters' })
  const src = ok('sources') ? d!.sources! : null
  if (src && src.total === 0) list.push({ key: 'no-source', level: 'info', title: '还没有添加来源', action: '添加来源', to: '/library/media?add=LOCAL' })
  if (src && src.failed.length > 0) list.push({ key: 'scan', level: 'warn', title: `${src.failed.length} 个媒体库最近扫描失败`, detail: src.failed.map(item => item.name).join('、'), action: '查看媒体库', to: '/library/media' })
  const lib = ok('library') ? d!.library! : null
  if (lib && lib.reviewSongs > 0) list.push({ key: 'review', level: 'info', title: `${fmt(lib.reviewSongs)} 首文件名识别不完整`, action: '查看识别结果', to: '/library/songs?status=REVIEW' })
  const rev = ok('review') ? d!.review! : null
  if (rev?.metadataBatch && rev.metadataBatch.review > 0) list.push({ key: 'metadata', level: 'info', title: `${fmt(rev.metadataBatch.review)} 首平台匹配待审核`, action: '去审核', to: `/library/songs/metadata?batch=${encodeURIComponent(rev.metadataBatch.id)}&status=REVIEW` })
  if (rev && rev.classification.reviewItems > 0) list.push({ key: 'classification', level: 'info', title: `${fmt(rev.classification.reviewItems)} 首分类建议待确认`, action: '去确认', to: rev.classification.latestTaskId ? `/library/classification?task=${rev.classification.latestTaskId}` : '/library/classification' })
  if (rev && rev.missingFeedbackPending > 0) list.push({ key: 'missing', level: 'info', title: `${fmt(rev.missingFeedbackPending)} 条缺歌心愿待处理`, action: '查看心愿', to: '/library/missing-feedback' })
  if (auth.account && !auth.account.mfaEnabled) list.push({ key: 'mfa', level: 'info', title: '未开启二次验证', action: '去开启', to: '/system/parameters' })
  return list
})
const todoLoading = computed(() => data.state === 'loading')
const todoSections = ['library', 'sources', 'review'] as const
const todoErrors = computed(() => data.state === 'loading' ? 0 : todoSections.filter(key => !ok(key)).length)

const recentSongs = computed(() => ok('recentSongs') ? (ov.value!.recentSongs ?? []) : null)
const homePlaylists = computed(() => ok('playlists') ? (ov.value!.playlists ?? []) : null)
const readiness = computed(() => ok('readiness') ? ov.value!.readiness! : null)
const playback = computed(() => ok('playback30d') ? ov.value!.playback30d! : null)

const router = useRouter()
const searchTerm = ref('')
const library = computed(() => ok('library') ? ov.value!.library! : null)
const shelfSongs = computed(() => recentSongs.value?.slice(0, 6) ?? [])
const primaryTodo = computed(() => {
  const priorities = ['review', 'scan', 'metadata', 'classification', 'missing', 'no-source']
  return priorities.map(key => todos.value.find(todo => todo.key === key)).find(Boolean)
})
const secondaryTodos = computed(() => todos.value.filter(todo => todo.key !== primaryTodo.value?.key))
const reviewHeading = computed(() => primaryTodo.value?.key === 'review'
  ? `${fmt(library.value!.reviewSongs)} 首文件名识别不完整`
  : primaryTodo.value?.title ?? (todoLoading.value ? '正在读取曲库待办…' : '待办状态暂时无法读取'))
function submitSearch() {
  const search = searchTerm.value.trim()
  void router.push({ path: '/library/songs', query: { lens: 'songs', ...(search ? { search } : {}) } })
}
function songLink(id: string) {
  return { path: '/library/songs', query: { lens: 'songs', detailSongId: id } }
}

</script>

<template>
  <section class="overview-page">
    <ElAlert v-if="data.state === 'error'" class="overview-error" type="warning" :closable="false" show-icon :title="data.value ? '曲库概览更新失败，正在显示上次读取的结果' : '曲库概览暂时无法读取'">
      <span>{{ data.error }}</span><ElButton link type="primary" @click="refreshOverview">重新读取</ElButton>
    </ElAlert>

    <div class="overview-top">
      <section class="home-feature sv-glass" aria-labelledby="overview-title">
        <header class="overview-heading">
          <h1 id="overview-title">曲库概览</h1>
          <ElButton class="overview-refresh" text :icon="RefreshRight" :loading="todoLoading" aria-label="刷新曲库概览" @click="refresh">刷新</ElButton>
        </header>
        <form class="home-search" role="search" aria-label="搜索家庭曲库" @submit.prevent="submitSearch">
          <ElIcon aria-hidden="true"><Search /></ElIcon>
          <input v-model="searchTerm" type="search" name="search" placeholder="搜索歌名、歌手" aria-label="搜索家庭曲库中的歌曲或歌手" maxlength="500">
          <button class="search-submit" type="submit" aria-label="搜索曲库">搜索</button>
        </form>
        <div class="overview-summary" :aria-busy="todoLoading">
          <p class="library-summary">
            <strong v-if="library">{{ fmt(library.formalSongs) }} 首歌曲</strong>
            <span v-else-if="todoLoading" role="status">正在读取曲库…</span>
            <span v-else>歌曲数量读取失败</span>
          </p>
          <p v-if="library" class="library-details">{{ fmt(library.totalSongs) }} 个文件，{{ fmt(library.formalVariants) }} 个媒体版本</p>
          <RouterLink v-if="ok('sources')" class="source-summary" to="/library/media">{{ fmt(ov!.sources!.total) }} 个媒体来源<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink>
        </div>
      </section>

      <section class="family-invitation" aria-labelledby="family-title">
        <span class="family-record" aria-hidden="true"></span>
        <ElIcon class="family-icon" aria-hidden="true"><Microphone /></ElIcon>
        <h2 id="family-title">客厅点歌</h2>
        <div class="family-actions">
          <a class="party-link" href="/party/" target="_blank" rel="noopener">打开亲友点歌<ElIcon aria-hidden="true"><TopRight /></ElIcon></a>
        </div>
      </section>
    </div>

    <nav class="overview-shortcuts" aria-labelledby="shortcut-title">
      <h2 id="shortcut-title">常用功能</h2>
      <div class="shortcut-grid">
        <RouterLink v-for="item in shortcuts" :key="item.to" :to="item.to" class="shortcut-link">
          <span class="shortcut-icon"><ElIcon aria-hidden="true"><component :is="item.icon" /></ElIcon></span>
          <span class="shortcut-copy"><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
        </RouterLink>
      </div>
    </nav>

    <div class="overview-grid">
      <div class="overview-main">
        <section v-if="primaryTodo || todoLoading || todoErrors" class="review-strip sv-glass" aria-labelledby="review-heading">
          <span class="review-mark" aria-hidden="true"><ElIcon><DocumentChecked /></ElIcon></span>
          <div class="review-copy"><h2 id="review-heading">{{ reviewHeading }}</h2><p v-if="primaryTodo?.detail">{{ primaryTodo.detail }}</p></div>
          <RouterLink v-if="primaryTodo" class="outline-link todo-action" :to="primaryTodo.to">{{ primaryTodo.action }}</RouterLink>
          <ElButton v-else-if="!todoLoading" @click="refresh">重新读取</ElButton>
        </section>

        <section class="home-library sv-glass" aria-labelledby="recent-title" :aria-busy="todoLoading">
          <div class="home-section-heading"><h2 id="recent-title">最近入库</h2><RouterLink class="text-link" to="/library/songs?lens=songs">打开曲库<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></div>
          <div v-if="todoLoading && !data.value" class="recent-shelf" role="status" aria-label="正在读取最近入库"><ElSkeleton v-for="index in 6" :key="index" animated><template #template><ElSkeletonItem variant="image" style="width:100%;height:auto;aspect-ratio:1" /><ElSkeletonItem variant="h3" style="width:65%;margin-top:16px" /><ElSkeletonItem variant="text" style="width:45%;margin-top:10px" /></template></ElSkeleton></div>
          <div v-else-if="!ok('recentSongs')" class="content-empty"><p>最近入库暂时无法读取</p><ElButton text @click="refreshOverview">重新读取</ElButton></div>
          <div v-else-if="shelfSongs.length" class="recent-shelf">
            <RouterLink v-for="song in shelfSongs" :key="song.id" :to="songLink(song.id)" class="shelf-song" :aria-label="`查看歌曲：${songTitle(song)}`">
              <SongCover :song="song" /><strong :title="songTitle(song)">{{ songTitle(song) }}</strong><span>{{ songArtists(song).join('、') || '歌手待补充' }}</span>
            </RouterLink>
          </div>
          <EmptyState v-else title="暂无歌曲" :icon="Headset"><template #action><RouterLink class="solid-link" to="/library/media?add=LOCAL">连接歌曲来源</RouterLink></template></EmptyState>
        </section>

        <section v-if="secondaryTodos.length || (todoErrors && !todoLoading)" class="home-todos sv-glass" aria-labelledby="overview-todo-title">
          <div class="home-section-heading"><h2 id="overview-todo-title">待办事项</h2><span class="sv-count-pill">{{ secondaryTodos.length }}</span></div>
          <ul v-if="secondaryTodos.length" class="todo-list"><li v-for="todo in secondaryTodos" :key="todo.key" class="todo-item"><span class="sv-status-dot" :class="todo.level" aria-hidden="true" /><div class="todo-copy"><strong>{{ todo.title }}</strong><p v-if="todo.detail">{{ todo.detail }}</p></div><RouterLink :to="todo.to" class="todo-action">{{ todo.action }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></li></ul>
          <p v-if="todoErrors && !todoLoading" class="todo-note" role="alert">有 {{ todoErrors }} 项状态读取失败，待办可能不完整。<ElButton link type="primary" @click="refresh">重新读取</ElButton></p>
        </section>

        <section v-if="homePlaylists?.length" class="playlist-section sv-glass" aria-labelledby="collection-title">
          <div class="home-section-heading"><h2 id="collection-title">共享歌单</h2><RouterLink class="text-link" to="/library/playlists">全部歌单<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></div>
          <div class="home-playlists"><RouterLink v-for="playlist in homePlaylists" :key="playlist.id" to="/library/playlists"><span class="playlist-mark" aria-hidden="true"><ElIcon><Collection /></ElIcon></span><div><strong>{{ playlist.name }}</strong><span>{{ fmt(playlist.count) }} 首歌曲</span></div><ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></div>
        </section>
      </div>

      <aside class="overview-side" aria-label="任务与服务状态">
        <section class="home-tools sv-glass">
          <div class="home-section-heading"><h2>运行任务</h2><RouterLink class="text-link" to="/system/tasks">全部任务<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></div>
          <div class="home-tasks" aria-label="进行中的后台任务" :aria-busy="tasks.state === 'loading'">
            <p v-if="tasks.state === 'loading' && !tasks.value" class="support-note" role="status">正在读取任务…</p>
            <p v-else-if="tasks.state === 'error'" class="support-note">暂时无法读取任务 <ElButton link @click="refreshTasks">重试</ElButton></p>
            <p v-else-if="tasks.value?.length === 0" class="support-note">暂无运行任务</p>
            <RouterLink v-for="task in tasks.value" :key="task.id" :to="'/system/tasks/' + encodeURIComponent(task.id)" class="home-task"><span class="sv-status-dot busy" aria-hidden="true" /><div><strong>{{ task.name }}</strong><small>{{ statusNames[task.status] || task.status }}，{{ progressText(task) }}</small></div><ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink>
          </div>
        </section>

        <section class="home-status sv-glass" aria-label="计算与 AI 就绪状态">
          <div class="home-section-heading"><h2>服务状态</h2></div>
          <div class="readiness-row"><template v-if="readiness"><RouterLink class="readiness-chip" :class="{ warn: !readiness.compute.configured }" to="/system/compute"><ElIcon aria-hidden="true"><Cpu /></ElIcon>{{ readiness.compute.configured ? `计算节点 ${readiness.compute.mode || '已配置'}` : '计算节点未配置，去设置' }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink><RouterLink class="readiness-chip" :class="{ warn: !readiness.ai.configured }" to="/system/ai"><ElIcon aria-hidden="true"><ChatDotRound /></ElIcon>{{ readiness.ai.configured ? `AI 已启用 ${readiness.ai.enabledFeatures.length} 项能力` : 'AI 未配置，去设置' }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></template><span v-else class="support-note" :role="todoLoading ? 'status' : undefined">{{ todoLoading ? '正在读取服务状态…' : '节点与 AI 状态读取失败' }}</span></div>
          <RouterLink v-if="playback" class="playback-link" to="/library/playback-history"><ElIcon aria-hidden="true"><Clock /></ElIcon>近 30 天 {{ fmt(playback.totalPlays) }} 次播放</RouterLink>
        </section>

      </aside>
    </div>
  </section>
</template>

<style scoped>
.overview-page { min-width: 0; }
.overview-top { display: grid; grid-template-columns: minmax(0, 2fr) minmax(310px, 1fr); gap: 20px; }
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.overview-heading h1 { font-size: 28px; font-weight: 600; }
.overview-error { margin-bottom: 20px; }
.overview-error :deep(.el-alert__description) { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.home-feature { min-width: 0; padding: 20px 24px 16px; }
.home-search { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 48px; padding: 0 4px 0 16px; border: 1px solid var(--sv-border-default); border-radius: var(--sv-radius-md); background: var(--sv-surface-2); }
.home-search:focus-within { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.home-search > .el-icon { flex: none; color: var(--sv-text-secondary); font-size: 20px; }
.home-search input { width: 100%; min-width: 0; min-height: 48px; border: 0; outline: 0; background: transparent; color: var(--sv-text-primary); font-size: 16px; }
.home-search input::placeholder { color: var(--sv-text-tertiary); }
.search-submit { align-self: center; flex: none; min-width: 64px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 7px; background: var(--sv-accent-primary); color: var(--sv-on-accent); font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.search-submit:hover { background: var(--sv-accent-muted); }
.solid-link, .outline-link, .text-link, .todo-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; font-size: 14px; font-weight: 500; }
.solid-link, .outline-link { padding: 10px 18px; border: 1px solid var(--sv-border-default); border-radius: var(--sv-radius-md); }
.solid-link { border-color: var(--sv-accent-primary); background: var(--sv-accent-primary); color: var(--sv-on-accent); }
.solid-link:hover { background: var(--sv-accent-muted); color: var(--sv-on-accent); }
.outline-link { background: var(--sv-surface-2); color: var(--sv-text-primary); }
.outline-link:hover { background: var(--sv-accent-soft); border-color: var(--sv-accent-primary); color: var(--sv-accent-primary); }
.overview-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px; margin-top: 12px; font-size: 13px; }
.library-summary { color: var(--sv-text-secondary); }
.library-summary strong { color: var(--sv-text-primary); font-size: 14px; font-weight: 600; }
.library-details { color: var(--sv-text-secondary); }
.source-summary { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; margin-left: auto; }
.overview-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; align-items: start; gap: 24px; }
.overview-main, .overview-side { display: grid; align-content: start; gap: 20px; min-width: 0; }
.overview-main > section, .overview-side > section { padding: 24px; min-width: 0; }
.home-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.home-section-heading h2 { font-size: 17px; font-weight: 600; }
.home-section-heading .text-link { flex: none; min-height: 32px; font-size: 13px; }
.review-strip { display: flex; align-items: center; gap: 16px; border-left: 3px solid var(--sv-accent-primary); }
.review-mark { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 12px; color: var(--sv-accent-primary); background: var(--sv-accent-soft); font-size: 21px; }
.review-copy { flex: 1; min-width: 0; }
.review-copy h2 { font-size: 16px; overflow-wrap: anywhere; }
.review-copy p { margin-top: 4px; font-size: 13px; color: var(--sv-text-secondary); overflow-wrap: anywhere; }
.review-strip > .todo-action { flex: none; }
.todo-list { display: grid; padding: 0; margin: 0; list-style: none; }
.todo-item { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 14px 0; border-top: 1px solid var(--sv-border-subtle); }
.todo-item:first-child { border: 0; padding-top: 0; }
.todo-item:last-child { padding-bottom: 0; }
.todo-item > .sv-status-dot { margin-top: 10px; }
.todo-copy { flex: 1; min-width: 0; }
.todo-copy strong { font-size: 14px; font-weight: 600; }
.todo-copy p, .todo-note { color: var(--sv-text-secondary); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.todo-copy p { margin-top: 4px; }
.todo-note { margin-top: 12px; color: var(--sv-semantic-warn); }
.todo-action { flex: none; }
.recent-shelf { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; }
.shelf-song { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--sv-text-primary); }
.shelf-song :deep(.song-cover) { width: 100%; height: auto; aspect-ratio: 1; margin-bottom: 6px; border-radius: 10px; transition: transform var(--sv-motion-enter) var(--sv-ease-enter); }
@media (hover: hover) { .shelf-song:hover :deep(.song-cover) { transform: translateY(-3px); } }
.shelf-song strong, .shelf-song > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shelf-song strong { font-size: 14px; font-weight: 600; }
.shelf-song > span { font-size: 12px; color: var(--sv-text-secondary); }
.content-empty { min-height: 180px; color: var(--sv-text-secondary); font-size: 14px; text-align: center; align-content: center; }
.content-empty .el-skeleton { min-height: 140px; padding: 8px; background: none; }
.home-playlists { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.home-playlists > a { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 72px; padding: 12px; border: 1px solid var(--sv-border-subtle); border-radius: 12px; color: var(--sv-text-primary); background: var(--sv-surface-1); }
.home-playlists > a:hover { border-color: var(--sv-accent-primary); }
.playlist-mark { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 10px; color: var(--sv-accent-primary); background: var(--sv-accent-soft); font-size: 20px; }
.home-playlists > a > div { flex: 1; min-width: 0; }
.home-playlists strong { display: block; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.home-playlists > a > div > span { display: block; margin-top: 2px; font-size: 12px; color: var(--sv-text-secondary); }
.support-note { font-size: 14px; color: var(--sv-text-secondary); padding-block: 8px; }
.home-task { display: flex; align-items: flex-start; gap: 10px; min-height: 64px; padding-block: 14px; color: var(--sv-text-primary); border-top: 1px solid var(--sv-border-subtle); }
.home-task:first-child { padding-top: 0; border: 0; }
.home-task:last-child { padding-bottom: 0; }
.home-task > .sv-status-dot { margin-top: 7px; }
.home-task > div { flex: 1; min-width: 0; }
.home-task strong { display: block; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.home-task small { display: block; margin-top: 4px; font-size: 12px; color: var(--sv-text-secondary); }
.home-task > .el-icon { margin-top: 4px; }
.readiness-row { display: grid; gap: 8px; }
.readiness-chip { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--sv-text-secondary); font-size: 13px; }
.readiness-chip > .el-icon { flex: none; font-size: 18px; }
.readiness-chip > .el-icon:last-child { margin-left: auto; font-size: 14px; }
.readiness-chip.warn { color: var(--sv-semantic-warn); }
.playback-link { display: flex; align-items: center; gap: 10px; min-height: 44px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--sv-border-subtle); color: var(--sv-text-secondary); font-size: 13px; }
.family-invitation {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 20px 24px;
  border-radius: var(--sv-radius-lg);
  background: linear-gradient(115deg, #142958 8%, #23478d 82%, #355ba2);
  color: white;
}
.family-record {
  position: absolute;
  z-index: -1;
  top: 50%;
  right: -96px;
  width: 260px;
  aspect-ratio: 1;
  transform: translateY(-43%);
  border: 1px solid rgb(171 202 255 / 35%);
  border-radius: 50%;
  background:
    radial-gradient(circle, #142958 0 3%, #89abec 3.5% 17%, transparent 17.5%),
    repeating-radial-gradient(circle, transparent 0 4px, rgb(196 220 255 / 18%) 4.5px 5.5px),
    conic-gradient(from 25deg, #284984, #5382cc 12%, #193469 33%, #284984 54%, #4877be 64%, #203d76 88%, #284984);
}
.family-icon { font-size: 22px; }
.family-invitation h2 { font-size: 24px; line-height: 1.3; font-weight: 650; }
.family-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin-top: 4px; }
.family-actions a { display: inline-flex; align-items: center; min-height: 44px; gap: 8px; font-size: 14px; }
.party-link { padding: 0 14px; border-radius: var(--sv-radius-md); background: white; color: #142958; font-weight: 600; }
.party-link:hover { background: #e4eeff; color: #142958; }

.overview-shortcuts { margin: 24px 0; }
.overview-shortcuts h2 { margin-bottom: 12px; font-size: 18px; font-weight: 600; }
.shortcut-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.shortcut-link { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 16px; border: 1px solid var(--sv-glass-border); border-radius: var(--sv-radius-lg); background: var(--sv-surface-2); color: var(--sv-text-primary); box-shadow: var(--sv-shadow-sm); }
.shortcut-icon { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--sv-accent-soft); color: var(--sv-accent-primary); font-size: 19px; }
.shortcut-copy { display: grid; gap: 2px; }
.shortcut-copy strong { font-size: 15px; font-weight: 600; }
.shortcut-copy small { color: var(--sv-text-secondary); font-size: 12px; }
.shortcut-link:is(:hover, :focus-visible) { border-color: var(--sv-accent-primary); color: var(--sv-accent-primary); }
.shortcut-link:active { background: var(--sv-accent-soft); }
.overview-page :is(a, button):focus-visible { outline: 2px solid var(--sv-accent-primary); outline-offset: 2px; }
.family-invitation a:focus-visible { outline-color: white; }
@media (max-width: 1200px) {
  .overview-grid { grid-template-columns: minmax(0, 1fr) 290px; gap: 20px; }
  .recent-shelf { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 1050px) {
  .shortcut-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .shortcut-link { flex-direction: row; align-items: center; }
  .shortcut-icon { flex: none; }
}
@media (max-width: 900px) {
  .overview-grid { grid-template-columns: minmax(0, 1fr); }
  .overview-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .recent-shelf { grid-template-columns: repeat(6, minmax(0, 1fr)); }
}
@media (max-width: 740px) {
  .overview-top { grid-template-columns: 1fr; gap: 12px; }
  .family-invitation { flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: flex-start; padding: 12px 16px; }
  .family-invitation h2 { font-size: 18px; }
  .family-actions { margin: 0 0 0 auto; gap: 10px; }
  .family-record { opacity: .35; }
}
@media (max-width: 650px) {
  .overview-heading h1 { font-size: 24px; }
  .home-feature, .overview-main > section, .overview-side > section { padding: 16px; }
  .overview-shortcuts { margin: 20px 0; }
  .shortcut-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .shortcut-link { padding: 12px; gap: 8px; }
  .overview-summary { gap: 2px 12px; }.source-summary { min-height: 44px; margin-left: 0; }
  .overview-side { grid-template-columns: minmax(0, 1fr); }.recent-shelf { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .overview-main > .review-strip { flex-wrap: wrap; gap: 12px; }.review-mark { display: none; }.review-copy { flex-basis: 100%; }.review-strip > .todo-action { min-height: 44px; }
  .home-playlists { grid-template-columns: minmax(0, 1fr); }.todo-item { flex-wrap: wrap; }.todo-copy { flex-basis: calc(100% - 20px); }.todo-item > .todo-action { margin-left: 20px; }
  .home-section-heading .text-link { min-height: 44px; }.home-section-heading { gap: 8px; }.home-section-heading h2 { font-size: 16px; }
}
</style>
