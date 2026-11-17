<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert, ElButton, ElIcon, ElSkeleton, ElSkeletonItem } from 'element-plus'
import { ArrowRight, ChatDotRound, Clock, Collection, Cpu, DocumentChecked, FolderOpened, Headset, Plus, RefreshRight, Search, Cellphone } from '@element-plus/icons-vue'
import SongCover from '../../song-management/components/SongCover.vue'
import EmptyState from '../../../shared/ui/EmptyState.vue'
import { songTitle, songArtists } from '../../metadata/utils'
import { backgroundTasks, type BackgroundTask } from '../../background-tasks/api'
import { statusNames, progressText } from '../../background-tasks/presentation'
import { auth } from '../../../core/auth/api'
import { loadOverview, type AdminOverview } from '../api/overview'

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

type Todo = { key: string; level: 'danger' | 'warn' | 'info'; title: string; detail: string; action: string; to: string }
const todos = computed<Todo[]>(() => {
  const list: Todo[] = []
  const d = ov.value
  if (auth.account?.defaultPassword) list.push({ key: 'password', level: 'danger', title: '仍在使用默认密码', detail: '任何知道默认密码的人都能登录管理中心。', action: '修改密码', to: '/system/parameters' })
  const src = ok('sources') ? d!.sources! : null
  if (src && src.total === 0) list.push({ key: 'no-source', level: 'info', title: '还没有添加媒体库', detail: '添加本地目录或 WebDAV 并扫描后，歌曲才会出现在曲库中。', action: '添加媒体库', to: '/library/media?add=LOCAL' })
  if (src && src.failed.length > 0) list.push({ key: 'scan', level: 'warn', title: `${src.failed.length} 个媒体库最近扫描失败`, detail: src.failed.map(item => item.name).join('、'), action: '查看媒体库', to: '/library/media' })
  const lib = ok('library') ? d!.library! : null
  if (lib && lib.reviewSongs > 0) list.push({ key: 'review', level: 'info', title: `${fmt(lib.reviewSongs)} 首歌曲待复核`, detail: '文件名未能完整识别歌名或歌手，复核后才能被准确搜索。', action: '去复核', to: '/library/songs?status=REVIEW' })
  const rev = ok('review') ? d!.review! : null
  if (rev?.metadataBatch && rev.metadataBatch.review > 0) list.push({ key: 'metadata', level: 'info', title: `${fmt(rev.metadataBatch.review)} 首平台匹配待审核`, detail: '核对歌名、歌手与封面后确认应用，未确认前不会改动曲库。', action: '去审核', to: `/library/songs/metadata?batch=${encodeURIComponent(rev.metadataBatch.id)}&status=REVIEW` })
  if (rev && rev.classification.reviewItems > 0) list.push({ key: 'classification', level: 'info', title: `${fmt(rev.classification.reviewItems)} 首分类建议待确认`, detail: '查看 AI 给出的分类与标签，确认后才会写入歌曲。', action: '去确认', to: rev.classification.latestTaskId ? `/library/classification?task=${rev.classification.latestTaskId}` : '/library/classification' })
  if (rev && rev.missingFeedbackPending > 0) list.push({ key: 'missing', level: 'info', title: `${fmt(rev.missingFeedbackPending)} 条缺歌心愿待处理`, detail: '亲友在点歌页留下的缺歌反馈，可据此补充曲库。', action: '查看心愿', to: '/library/missing-feedback' })
  if (auth.account && !auth.account.mfaEnabled) list.push({ key: 'mfa', level: 'info', title: '未开启二次验证', detail: '开启后登录需额外输入验证器中的动态码。', action: '去开启', to: '/system/parameters' })
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
  ? `还有 ${fmt(library.value!.reviewSongs)} 首歌，等你确认`
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
    <header class="overview-heading">
      <div><h1>曲库概览</h1><p>歌曲、待办与客厅，一处打理。</p></div>
      <ElButton class="overview-refresh" text :icon="RefreshRight" :loading="todoLoading" aria-label="刷新曲库概览" @click="refresh">刷新</ElButton>
    </header>
    <ElAlert v-if="data.state === 'error'" class="overview-error" type="warning" :closable="false" show-icon :title="data.value ? '曲库概览更新失败，正在显示上次读取的结果' : '曲库概览暂时无法读取'">
      <span>{{ data.error }}</span><ElButton link type="primary" @click="refreshOverview">重新读取</ElButton>
    </ElAlert>

    <section class="home-feature sv-glass" aria-label="曲库搜索与概况" :aria-busy="todoLoading">
      <div class="feature-copy">
        <form class="home-search" role="search" aria-label="搜索家庭曲库" @submit.prevent="submitSearch">
          <ElIcon aria-hidden="true"><Search /></ElIcon>
          <input v-model="searchTerm" type="search" name="search" placeholder="搜索歌名、歌手" aria-label="搜索家庭曲库中的歌曲或歌手" maxlength="500">
          <button class="search-submit" type="submit" aria-label="搜索曲库"><ElIcon aria-hidden="true"><ArrowRight /></ElIcon></button>
        </form>
        <div class="feature-actions">
          <RouterLink class="solid-link" to="/library/media?add=LOCAL"><ElIcon aria-hidden="true"><Plus /></ElIcon>添加歌曲</RouterLink>
          <RouterLink class="outline-link" to="/library/media"><ElIcon aria-hidden="true"><FolderOpened /></ElIcon>扫描来源</RouterLink>
        </div>
      </div>
      <div class="overview-summary">
        <p class="library-summary">
          <strong v-if="library">{{ fmt(library.formalSongs) }} 首歌曲</strong>
          <span v-else-if="todoLoading" role="status">正在打开你的家庭曲库…</span>
          <span v-else>歌曲数量读取失败，请稍后重试。</span>
        </p>
        <p v-if="library" class="library-details">{{ fmt(library.totalSongs) }} 个文件，{{ fmt(library.formalVariants) }} 个媒体版本</p>
        <RouterLink v-if="ok('sources')" class="source-summary" to="/library/media">{{ fmt(ov!.sources!.total) }} 个媒体来源<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink>
      </div>
    </section>

    <div class="overview-grid">
      <div class="overview-main">
        <section v-if="primaryTodo || todoLoading || todoErrors" class="review-strip sv-glass" aria-labelledby="review-heading">
          <span class="review-mark" aria-hidden="true"><ElIcon><DocumentChecked /></ElIcon></span>
          <div class="review-copy"><h2 id="review-heading">{{ reviewHeading }}</h2><p>{{ primaryTodo?.key === 'review' ? '补全歌曲信息，让它在曲库里更好找。' : primaryTodo?.detail ?? (todoLoading ? '正在检查需要你确认的事情。' : '部分状态读取失败，可以重新读取后再查看。') }}</p></div>
          <RouterLink v-if="primaryTodo" class="outline-link todo-action" :to="primaryTodo.to">{{ primaryTodo.action }}</RouterLink>
          <ElButton v-else-if="!todoLoading" @click="refresh">重新读取</ElButton>
        </section>

        <section v-if="secondaryTodos.length || (todoErrors && !todoLoading)" class="home-todos sv-glass" aria-labelledby="overview-todo-title">
          <div class="home-section-heading"><h2 id="overview-todo-title">待办事项</h2><span class="sv-count-pill">{{ secondaryTodos.length }}</span></div>
          <ul v-if="secondaryTodos.length" class="todo-list"><li v-for="todo in secondaryTodos" :key="todo.key" class="todo-item"><span class="sv-status-dot" :class="todo.level" aria-hidden="true" /><div class="todo-copy"><strong>{{ todo.title }}</strong><p>{{ todo.detail }}</p></div><RouterLink :to="todo.to" class="todo-action">{{ todo.action }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></li></ul>
          <p v-if="todoErrors && !todoLoading" class="todo-note" role="alert">有 {{ todoErrors }} 项状态读取失败，待办可能不完整。<ElButton link type="primary" @click="refresh">重新读取</ElButton></p>
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
          <EmptyState v-else title="从第一首喜欢的歌开始" description="连接本地文件夹或 WebDAV，扫描后歌曲就会出现在这里。" :icon="Headset"><template #action><RouterLink class="solid-link" to="/library/media?add=LOCAL">连接歌曲来源</RouterLink></template></EmptyState>
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
            <p v-else-if="tasks.value?.length === 0" class="support-note">当前没有进行中的任务。</p>
            <RouterLink v-for="task in tasks.value" :key="task.id" :to="'/system/tasks/' + encodeURIComponent(task.id)" class="home-task"><span class="sv-status-dot busy" aria-hidden="true" /><div><strong>{{ task.name }}</strong><small>{{ statusNames[task.status] || task.status }}，{{ progressText(task) }}</small></div><ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink>
          </div>
        </section>

        <section class="home-status sv-glass" aria-label="计算与 AI 就绪状态">
          <div class="home-section-heading"><h2>服务状态</h2><RouterLink class="text-link" to="/system">查看<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></div>
          <div class="readiness-row"><template v-if="readiness"><RouterLink class="readiness-chip" :class="{ warn: !readiness.compute.configured }" to="/system/compute"><ElIcon aria-hidden="true"><Cpu /></ElIcon>{{ readiness.compute.configured ? `计算节点 ${readiness.compute.mode || '已配置'}` : '计算节点未配置，去设置' }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink><RouterLink class="readiness-chip" :class="{ warn: !readiness.ai.configured }" to="/system/ai"><ElIcon aria-hidden="true"><ChatDotRound /></ElIcon>{{ readiness.ai.configured ? `AI 已启用 ${readiness.ai.enabledFeatures.length} 项能力` : 'AI 未配置，去设置' }}<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></RouterLink></template><span v-else class="support-note" :role="todoLoading ? 'status' : undefined">{{ todoLoading ? '正在读取服务状态…' : '节点与 AI 状态读取失败' }}</span></div>
          <RouterLink v-if="playback" class="playback-link" to="/library/playback-history"><ElIcon aria-hidden="true"><Clock /></ElIcon>近 30 天 {{ fmt(playback.totalPlays) }} 次播放</RouterLink>
        </section>

        <section class="family-invitation sv-glass" aria-labelledby="family-title">
          <ElIcon class="family-icon" aria-hidden="true"><Cellphone /></ElIcon>
          <h2 id="family-title">准备好，客厅开唱。</h2><p>整理好的歌曲，和亲友一起分享。</p>
          <div class="family-actions"><a class="text-link" href="/party/" target="_blank" rel="noopener">打开亲友点歌<ElIcon aria-hidden="true"><ArrowRight /></ElIcon></a><RouterLink class="text-link" to="/system/tv-settings">客厅设置</RouterLink></div>
        </section>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.overview-page { min-width: 0; }
.overview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.overview-heading h1 { font-size: 28px; font-weight: 600; }
.overview-heading p { margin-top: 4px; color: var(--sv-text-secondary); font-size: 14px; }
.overview-error { margin-bottom: 20px; }
.overview-error :deep(.el-alert__description) { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.home-feature { padding: 24px; margin-bottom: 24px; }
.feature-copy { display: flex; align-items: center; gap: 24px; }
.home-search { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 48px; padding: 0 4px 0 16px; border: 1px solid var(--sv-border-default); border-radius: var(--sv-radius-md); background: var(--sv-surface-2); }
.home-search:focus-within { outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.home-search > .el-icon { flex: none; color: var(--sv-text-secondary); font-size: 20px; }
.home-search input { width: 100%; min-width: 0; min-height: 48px; border: 0; outline: 0; background: transparent; color: var(--sv-text-primary); font-size: 16px; }
.home-search input::placeholder { color: var(--sv-text-tertiary); }
.search-submit { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; background: var(--sv-accent-soft); color: var(--sv-accent-primary); cursor: pointer; }
.feature-actions, .family-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.feature-actions { flex: none; }
.solid-link, .outline-link, .text-link, .todo-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; font-size: 14px; font-weight: 500; }
.solid-link, .outline-link { padding: 10px 18px; border: 1px solid var(--sv-border-default); border-radius: var(--sv-radius-md); }
.solid-link { border-color: var(--sv-accent-primary); background: var(--sv-accent-primary); color: var(--sv-on-accent); }
.solid-link:hover { background: var(--sv-accent-muted); color: var(--sv-on-accent); }
.outline-link { background: var(--sv-surface-2); color: var(--sv-text-primary); }
.outline-link:hover { background: var(--sv-accent-soft); border-color: var(--sv-accent-primary); color: var(--sv-accent-primary); }
.overview-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 20px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--sv-border-subtle); font-size: 13px; }
.library-summary { color: var(--sv-text-secondary); }
.library-summary strong { color: var(--sv-text-primary); font-size: 16px; font-weight: 600; }
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
.family-icon { font-size: 24px; color: var(--sv-accent-primary); margin-bottom: 12px; }
.family-invitation h2 { font-size: 17px; }
.family-invitation > p { color: var(--sv-text-secondary); font-size: 13px; margin-top: 6px; }
.family-actions { gap: 4px 12px; margin-top: 12px; }
.family-actions .text-link { font-size: 13px; }
@media (max-width: 1200px) { .overview-grid { grid-template-columns: minmax(0, 1fr) 290px; gap: 20px; }.recent-shelf { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 900px) { .overview-grid { grid-template-columns: minmax(0, 1fr); }.overview-side { grid-template-columns: repeat(2, minmax(0, 1fr)); }.family-invitation { grid-column: 1 / -1; }.recent-shelf { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (max-width: 650px) {
  .overview-heading { margin-bottom: 20px; }.overview-heading h1 { font-size: 24px; }
  .home-feature, .overview-main > section, .overview-side > section { padding: 20px; }
  .feature-copy { flex-wrap: wrap; gap: 16px; }.home-search { flex-basis: 100%; }.feature-actions { width: 100%; }.feature-actions > a { flex: 1; }
  .overview-summary { gap: 8px; }.library-details { width: 100%; }.source-summary { margin-left: 0; min-height: 44px; }
  .overview-side { grid-template-columns: minmax(0, 1fr); }.recent-shelf { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .overview-main > .review-strip { flex-wrap: wrap; gap: 12px; }.review-mark { display: none; }.review-copy { flex-basis: 100%; }.review-strip > .todo-action { min-height: 44px; }
  .home-playlists { grid-template-columns: minmax(0, 1fr); }.todo-item { flex-wrap: wrap; }.todo-copy { flex-basis: calc(100% - 20px); }.todo-item > .todo-action { margin-left: 20px; }
  .home-section-heading .text-link { min-height: 44px; }.home-section-heading { gap: 8px; }.home-section-heading h2 { font-size: 16px; }
}
</style>
