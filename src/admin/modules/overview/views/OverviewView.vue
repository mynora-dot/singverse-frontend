<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElAlert, ElButton, ElIcon } from 'element-plus'
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
  if (!d || data.state === 'loading') return false
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
const featuredSongs = computed(() => shelfSongs.value.slice(0, 3))
// The overview only contains recent songs, not playlist membership. Keep their
// identity honest rather than presenting these covers as a saved playlist.
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
  <!-- A「家庭唱片室」：找歌、收歌、一起唱。封面与统计均来自当前 NAS。 -->
  <section class="overview-page">
    <h1 class="sr-only">曲库概览</h1>
    <ElAlert v-if="data.state === 'error'" class="overview-error" type="warning" :closable="false" show-icon :title="data.value ? '曲库概览更新失败，正在显示上次读取的结果' : '曲库概览暂时无法读取'">
      <span>{{ data.error }}</span><ElButton link type="primary" @click="refreshOverview">重新读取</ElButton>
    </ElAlert>

    <div class="home-feature">
      <section class="feature-copy" aria-labelledby="home-question">
        <p class="room-label"><span aria-hidden="true" />我的唱片室</p>
        <h2 id="home-question">下一首，<br>想唱什么？</h2>
        <p class="library-summary">
          <template v-if="library"><strong>{{ fmt(library.formalSongs) }} 首歌曲</strong>，好歌收在家里。</template>
          <span v-else-if="todoLoading" role="status">正在打开你的家庭曲库…</span>
          <span v-else>歌曲数量读取失败，请稍后重试。</span>
        </p>
        <form class="home-search" role="search" aria-label="搜索家庭曲库" @submit.prevent="submitSearch">
          <ElIcon aria-hidden="true"><Search /></ElIcon>
          <input v-model="searchTerm" type="search" name="search" placeholder="搜索歌名、歌手" aria-label="搜索家庭曲库中的歌曲或歌手" maxlength="500">
          <button class="search-submit" type="submit" aria-label="搜索曲库"><ElIcon><ArrowRight /></ElIcon></button>
        </form>
        <div class="feature-actions">
          <RouterLink class="solid-link" to="/library/media?add=LOCAL"><ElIcon><Plus /></ElIcon>添加歌曲</RouterLink>
          <RouterLink class="text-link" to="/library/media"><ElIcon><FolderOpened /></ElIcon>扫描来源</RouterLink>
        </div>
      </section>

      <section class="record-display" aria-labelledby="record-display-title">
        <div class="display-heading"><h2 id="record-display-title">从这一首开始</h2><RouterLink class="text-link" to="/library/songs?lens=songs">打开曲库</RouterLink></div>
        <div v-if="featuredSongs.length" class="record-stack" :class="{ 'single-record': featuredSongs.length === 1 }">
          <RouterLink v-for="(song, index) in featuredSongs" :key="song.id" :to="songLink(song.id)" class="featured-song" :class="{ 'main-record': index === 0 }" :aria-label="`查看歌曲：${songTitle(song)}`">
            <SongCover :song="song" />
            <div class="record-caption"><strong :title="songTitle(song)">{{ songTitle(song) }}</strong><span>{{ songArtists(song).join('、') || '歌手待补充' }}</span></div>
          </RouterLink>
        </div>
        <div v-else class="record-waiting" :aria-busy="todoLoading">
          <div class="waiting-record" aria-hidden="true"><ElIcon><Headset /></ElIcon></div>
          <template v-if="todoLoading"><h3>好歌，正在打开</h3><p role="status">正在读取你的曲库</p></template>
          <template v-else-if="!ok('recentSongs')"><h3>唱片暂时还没打开</h3><p>最近入库暂时无法读取</p><ElButton text @click="refreshOverview">重新读取</ElButton></template>
          <template v-else><h3>给家里添一点音乐</h3><p>从一首喜欢的歌开始收藏。</p><RouterLink class="text-link" to="/library/media?add=LOCAL">添加第一首歌</RouterLink></template>
        </div>
      </section>

      <section v-if="primaryTodo || todoLoading || todoErrors" class="review-strip" aria-labelledby="review-heading">
        <span class="review-mark" aria-hidden="true"><ElIcon><DocumentChecked /></ElIcon></span>
        <div class="review-copy"><h2 id="review-heading">{{ reviewHeading }}</h2><p>{{ primaryTodo?.key === 'review' ? '补全歌曲信息，让它在曲库里更好找。' : primaryTodo?.detail ?? (todoLoading ? '正在检查需要你确认的事情。' : '部分状态读取失败，可以重新读取后再查看。') }}</p></div>
        <RouterLink v-if="primaryTodo" class="outline-link todo-action" :to="primaryTodo.to">{{ primaryTodo.action }}</RouterLink>
        <ElButton v-else-if="!todoLoading" class="outline-link" @click="refresh">重新读取</ElButton>
      </section>
    </div>

    <section class="home-library" aria-labelledby="recent-title">
      <div class="home-section-heading"><div><h2 id="recent-title">翻翻曲库</h2><span>最近入库</span></div><RouterLink class="text-link" to="/library/songs?lens=songs">打开曲库</RouterLink></div>
      <p v-if="todoLoading" class="content-empty" role="status">正在读取最近入库…</p>
      <div v-else-if="!ok('recentSongs')" class="content-empty"><p>最近入库暂时无法读取</p><ElButton text @click="refreshOverview">重新读取</ElButton></div>
      <div v-else-if="shelfSongs.length" class="recent-shelf">
        <RouterLink v-for="song in shelfSongs" :key="song.id" :to="songLink(song.id)" class="shelf-song">
          <SongCover :song="song" /><strong :title="songTitle(song)">{{ songTitle(song) }}</strong><span>{{ songArtists(song).join('、') || '歌手待补充' }}</span>
        </RouterLink>
      </div>
      <EmptyState v-else title="从第一首喜欢的歌开始" description="连接本地文件夹或 WebDAV，扫描后歌曲就会出现在这里。" :icon="Headset"><template #action><RouterLink class="solid-link" to="/library/media?add=LOCAL">连接歌曲来源</RouterLink></template></EmptyState>
    </section>

    <section v-if="homePlaylists?.length" class="playlist-section" aria-labelledby="collection-title">
      <div class="home-section-heading"><div><h2 id="collection-title">留给下一次合唱</h2><span>共享歌单</span></div><RouterLink class="text-link" to="/library/playlists">全部歌单</RouterLink></div>
      <div class="home-playlists"><RouterLink v-for="playlist in homePlaylists" :key="playlist.id" to="/library/playlists"><span class="playlist-mark" aria-hidden="true"><ElIcon><Collection /></ElIcon></span><div><strong>{{ playlist.name }}</strong><span>{{ fmt(playlist.count) }} 首歌曲</span></div><ElIcon><ArrowRight /></ElIcon></RouterLink></div>
    </section>

    <section v-if="secondaryTodos.length || (todoErrors && !todoLoading)" class="home-todos" aria-labelledby="overview-todo-title">
      <div class="home-section-heading"><h2 id="overview-todo-title">顺手整理一下</h2></div>
      <ul v-if="secondaryTodos.length" class="todo-list"><li v-for="todo in secondaryTodos" :key="todo.key" class="todo-item"><span class="sv-status-dot" :class="todo.level" aria-hidden="true" /><div class="todo-copy"><strong>{{ todo.title }}</strong><p>{{ todo.detail }}</p><RouterLink :to="todo.to" class="todo-action">{{ todo.action }}</RouterLink></div></li></ul>
      <p v-if="todoErrors && !todoLoading" class="todo-note" role="alert">有 {{ todoErrors }} 项状态读取失败，待办可能不完整。<ElButton link type="primary" @click="refresh">重新读取</ElButton></p>
    </section>

    <div class="home-support">
      <section class="family-invitation" aria-labelledby="family-title">
        <ElIcon class="family-icon" aria-hidden="true"><Cellphone /></ElIcon>
        <div><h2 id="family-title">把选歌，交给亲友。</h2><p>手机选喜欢的歌，留给客厅里的下一次合唱。</p><div class="family-actions"><a class="text-link" href="/party/" target="_blank" rel="noopener">打开亲友点歌</a><RouterLink class="text-link" to="/system/tv-settings">进入客厅</RouterLink></div></div>
      </section>
      <div class="home-tools">
        <nav class="tool-links" aria-label="曲库管理工具"><RouterLink to="/library/media"><ElIcon><FolderOpened /></ElIcon><span><strong>媒体来源</strong><small>添加与扫描歌曲</small></span></RouterLink><RouterLink to="/system/tasks"><ElIcon><Clock /></ElIcon><span><strong>后台任务</strong><small>{{ tasks.value?.length ? `${tasks.value.length} 项任务正在处理` : '查看处理进度' }}</small></span></RouterLink></nav>
        <section class="home-tasks" aria-label="进行中的后台任务">
          <p v-if="tasks.state === 'loading' && !tasks.value" class="support-note" role="status">正在读取任务…</p>
          <p v-else-if="tasks.state === 'error'" class="support-note">暂时无法读取任务 <ElButton link @click="refreshTasks">重试</ElButton></p>
          <RouterLink v-for="task in tasks.value" :key="task.id" :to="'/system/tasks/' + encodeURIComponent(task.id)" class="home-task"><span class="sv-status-dot busy" /><div><strong>{{ task.name }}</strong><small>{{ statusNames[task.status] || task.status }}，{{ progressText(task) }}</small></div><ElIcon><ArrowRight /></ElIcon></RouterLink>
        </section>
      </div>
    </div>

    <div class="home-status">
      <div class="readiness-row" aria-label="计算与 AI 就绪状态"><template v-if="readiness"><RouterLink v-if="!readiness.compute.configured" class="readiness-chip warn" to="/system/compute"><ElIcon><Cpu /></ElIcon>计算节点未配置，去设置</RouterLink><RouterLink v-else class="readiness-chip" to="/system/compute"><ElIcon><Cpu /></ElIcon>计算节点 {{ readiness.compute.mode || '已配置' }}</RouterLink><RouterLink v-if="!readiness.ai.configured" class="readiness-chip warn" to="/system/ai"><ElIcon><ChatDotRound /></ElIcon>AI 未配置，去设置</RouterLink><RouterLink v-else class="readiness-chip" to="/system/ai"><ElIcon><ChatDotRound /></ElIcon>AI 已启用 {{ readiness.ai.enabledFeatures.length }} 项能力</RouterLink></template><span v-else-if="!todoLoading" class="readiness-chip">节点与 AI 状态读取失败</span></div>
      <div class="status-actions"><RouterLink class="text-link" to="/system">服务状态</RouterLink><ElButton class="overview-refresh" text :icon="RefreshRight" :loading="todoLoading" aria-label="刷新曲库概览" @click="refresh">刷新</ElButton></div>
      <p v-if="library" class="library-details">{{ fmt(library.totalSongs) }} 个文件，{{ fmt(library.formalVariants) }} 个媒体版本</p>
      <RouterLink v-if="playback" class="playback-link" to="/library/playback-history">近 30 天 {{ fmt(playback.totalPlays) }} 次播放</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.overview-page { min-width: 0; color: var(--sv-text-primary); font-size: 14px; }
.overview-page :deep(.el-button) { min-height: 44px; }
.overview-page h2, .overview-page h3 { font-family: 'PingFang SC', 'Microsoft YaHei', var(--sv-font-sans); }
.overview-error { margin-bottom: 28px; }
.overview-error :deep(.el-alert__description) { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.home-feature { display: grid; grid-template-columns: minmax(0, 480px) minmax(0, 1fr); gap: 36px clamp(48px, 7.2vw, 104px); align-items: start; }
.feature-copy { padding-top: 22px; min-width: 0; }
.room-label { display: flex; align-items: center; gap: 10px; color: var(--sv-text-secondary); font-size: 14px; }
.room-label>span { width: 6px; height: 6px; border-radius: 50%; background: var(--sv-accent-primary); }
.feature-copy h2 { margin: 18px 0 22px; font-size: 48px; line-height: 1.2; font-weight: 600; letter-spacing: -1px; }
.library-summary { color: var(--sv-text-secondary); font-size: 16px; min-height: 27px; }
.library-summary strong { color: var(--sv-text-primary); font-weight: 600; }
.home-search { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 0 5px 0 18px; margin-top: 30px; border: 1px solid var(--sv-border-default); border-radius: 10px; background: var(--sv-surface-2); }
.home-search:focus-within { border-color: var(--sv-accent-primary); outline: 2px solid var(--sv-accent-primary); outline-offset: 3px; }
.home-search>.el-icon { color: var(--sv-text-secondary); font-size: 20px; flex: none; }
.home-search input { width: 100%; min-width: 0; height: 54px; border: 0; outline: 0; border-radius: 0; background: transparent; color: var(--sv-text-primary); font-size: 16px; }
.home-search input::placeholder { color: var(--sv-text-tertiary); }
.search-submit { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border: 0; border-radius: 6px; background: transparent; color: var(--sv-text-secondary); cursor: pointer; }
.search-submit:hover { background: var(--sv-accent-soft); color: var(--sv-accent-primary); }
.feature-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 18px; }
.solid-link, .outline-link, .text-link, .todo-action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-width: 44px; min-height: 44px; font-size: 14px; font-weight: 500; }
.solid-link { min-height: 46px; padding: 10px 24px; background: var(--sv-accent-primary); color: var(--sv-on-accent); border-radius: 9px; border: 1px solid transparent; }
.solid-link:hover { background: var(--sv-accent-muted); color: var(--sv-on-accent); }
.feature-actions .text-link { padding: 0 8px; }
.feature-actions .el-icon { font-size: 19px; }
.outline-link { padding: 9px 20px; flex: none; border: 1px solid color-mix(in srgb, var(--sv-accent-primary), var(--sv-surface-2) 75%); border-radius: 8px; color: var(--sv-accent-primary); background: var(--sv-surface-2); }
.outline-link:hover { background: var(--sv-accent-soft); }
.record-display { width: 100%; max-width: 474px; min-width: 0; }
.display-heading, .home-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.display-heading { margin-bottom: 14px; }
.display-heading h2 { font-size: 20px; font-weight: 600; }
.record-stack { display: grid; grid-template-columns: minmax(0, 2.32fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.record-stack.single-record { grid-template-columns: minmax(0, 320px); }
.featured-song { min-width: 0; color: var(--sv-text-primary); }
.featured-song.main-record { grid-row: span 2; }
.featured-song :deep(.song-cover) { width: 100%; height: auto; aspect-ratio: 1; border-radius: 7px; transition: transform .2s ease; }
.featured-song:hover :deep(.song-cover) { transform: translateY(-3px); }
.record-caption { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; padding-top: 7px; line-height: 1.5; }
.record-caption strong { font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.main-record .record-caption strong { font-size: 18px; font-weight: 600; }
.record-caption>span { color: var(--sv-text-secondary); font-size: 12px; overflow-wrap: anywhere; }
.record-waiting { min-height: 350px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 24px; border-radius: 12px; background: var(--sv-surface-1); text-align: center; }
.record-waiting h3 { font-size: 20px; font-weight: 500; }
.record-waiting>p { color: var(--sv-text-secondary); font-size: 14px; }
.waiting-record { display: grid; place-items: center; width: 140px; height: 140px; margin-bottom: 12px; border: 1px solid var(--sv-border-subtle); border-radius: 50%; background: var(--sv-record-groove), var(--sv-surface-2); color: var(--sv-accent-primary); }
.waiting-record .el-icon { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 50%; background: var(--sv-surface-2); font-size: 26px; }
.review-strip { grid-column: 1 / -1; display: flex; align-items: center; gap: 18px; min-height: 96px; padding: 20px 24px; background: color-mix(in srgb, var(--sv-accent-soft), var(--sv-surface-2) 45%); border: 1px solid color-mix(in srgb, var(--sv-accent-primary), var(--sv-surface-2) 84%); border-radius: 12px; }
.review-mark { display: grid; place-items: center; flex: none; width: 48px; height: 48px; color: var(--sv-accent-primary); background: var(--sv-surface-2); border: 1px solid color-mix(in srgb, var(--sv-accent-primary), var(--sv-surface-2) 80%); border-radius: 50%; font-size: 22px; }
.review-copy { min-width: 0; flex: 1; }
.review-copy h2 { font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
.review-copy p { color: var(--sv-text-secondary); font-size: 14px; margin-top: 3px; }
.home-library { margin-top: 40px; }
.home-section-heading { margin-bottom: 18px; }
.home-section-heading>div { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; min-width: 0; }
.home-section-heading h2 { font-size: 24px; font-weight: 600; }
.home-section-heading>div>span { color: var(--sv-text-secondary); font-size: 14px; }
.recent-shelf { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 20px; }
.shelf-song { display: flex; flex-direction: column; align-items: stretch; gap: 4px; min-width: 0; color: var(--sv-text-primary); }
.shelf-song :deep(.song-cover) { width: 100%; height: auto; aspect-ratio: 1; margin-bottom: 6px; border-radius: 9px; transition: transform .2s ease; }
.shelf-song:hover :deep(.song-cover) { transform: translateY(-3px); }
.shelf-song>strong, .shelf-song>span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shelf-song>strong { font-size: 16px; font-weight: 600; }
.shelf-song>span { font-size: 14px; color: var(--sv-text-secondary); }
.content-empty { padding: 36px 20px; color: var(--sv-text-secondary); text-align: center; font-size: 14px; }
.home-library :deep(.empty-description) { font-size: 14px; }
.playlist-section { margin-top: 36px; padding-top: 28px; border-top: 1px solid var(--sv-border-subtle); }
.playlist-section .home-section-heading h2, .home-todos .home-section-heading h2 { font-size: 20px; }
.home-playlists { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.home-playlists>a { display: flex; align-items: center; gap: 14px; min-width: 0; padding: 14px 16px; color: var(--sv-text-primary); border: 1px solid var(--sv-border-subtle); border-radius: 10px; }
.home-playlists>a:hover { background: var(--sv-surface-1); }
.playlist-mark { display: grid; place-items: center; flex: none; width: 48px; height: 48px; color: var(--sv-accent-primary); background: var(--sv-accent-soft); border-radius: 8px; font-size: 24px; }
.home-playlists>a>div { min-width: 0; flex: 1; }
.home-playlists strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 500; }
.home-playlists>a>div>span { display: block; margin-top: 3px; font-size: 14px; color: var(--sv-text-secondary); }
.home-playlists>a>.el-icon { color: var(--sv-text-tertiary); }
.home-todos { padding-top: 26px; margin-top: 28px; border-top: 1px solid var(--sv-border-subtle); }
.todo-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 40px; padding: 0; margin: 0; list-style: none; }
.todo-item { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
.todo-item>.sv-status-dot { margin-top: 9px; }
.todo-copy { flex: 1; min-width: 0; }
.todo-copy>strong { font-size: 15px; font-weight: 500; }
.todo-copy>p { font-size: 14px; color: var(--sv-text-secondary); margin-top: 4px; overflow-wrap: anywhere; }
.todo-note { margin-top: 14px; color: var(--sv-semantic-warn); font-size: 14px; }
.home-support { display: grid; grid-template-columns: 1.1fr 1fr; gap: 56px; margin-top: 38px; padding: 30px 0; border-top: 1px solid var(--sv-border-subtle); }
.family-invitation { display: flex; align-items: flex-start; gap: 22px; min-width: 0; }
.family-icon { color: var(--sv-accent-primary); font-size: 32px; margin-top: 6px; }
.family-invitation>div { min-width: 0; }
.family-invitation h2 { font-size: 22px; font-weight: 600; }
.family-invitation p { color: var(--sv-text-secondary); font-size: 14px; margin-top: 7px; }
.family-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 12px; }
.tool-links { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
.tool-links>a { display: flex; align-items: flex-start; gap: 12px; min-width: 0; min-height: 60px; padding: 8px 0; color: var(--sv-text-primary); }
.tool-links>a>.el-icon { font-size: 22px; color: var(--sv-text-secondary); margin-top: 3px; }
.tool-links strong { display: block; font-size: 16px; font-weight: 500; }
.tool-links small { display: block; font-size: 14px; color: var(--sv-text-secondary); margin-top: 4px; }
.home-tasks { min-width: 0; }
.support-note { font-size: 14px; color: var(--sv-text-secondary); }
.home-task { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 12px 0; border-top: 1px solid var(--sv-border-subtle); color: var(--sv-text-primary); }
.home-task>div { flex: 1; min-width: 0; }
.home-task strong { display: block; font-size: 14px; font-weight: 500; overflow-wrap: anywhere; }
.home-task small { display: block; margin-top: 2px; color: var(--sv-text-secondary); font-size: 12px; }
.home-status { display: flex; flex-wrap: wrap; align-items: center; gap: 0 24px; padding-top: 16px; border-top: 1px solid var(--sv-border-subtle); color: var(--sv-text-secondary); }
.readiness-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0 20px; flex: 1 1 auto; }
.readiness-chip { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; color: var(--sv-text-secondary); }
.readiness-chip.warn { color: var(--sv-semantic-warn); }
.readiness-chip>.el-icon { font-size: 18px; }
.status-actions { display: flex; align-items: center; gap: 18px; }
.overview-refresh { min-height: 44px; margin: 0; font-size: 14px; }
.library-details { font-size: 12px; flex: 1 1 auto; }
.playback-link { display: inline-flex; align-items: center; min-height: 44px; font-size: 12px; color: var(--sv-text-secondary); }
@media(max-width:1100px) {
  .home-feature { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 48px; }
  .feature-copy h2 { font-size: 44px; }
  .recent-shelf { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 26px 20px; }
  .home-support { gap: 32px; }
  .home-playlists { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media(max-width:760px) {
  .home-feature { display: flex; flex-direction: column; gap: 30px; }
  .feature-copy { padding-top: 0; width: 100%; }
  .feature-copy h2 { font-size: 42px; margin: 18px 0 20px; }
  .record-display { order: 2; max-width: 100%; }
  .record-stack { gap: 12px; }
  .record-stack.single-record { max-width: 320px; }
  .record-waiting { min-height: 280px; }
  .review-strip { order: 1; width: 100%; min-height: 64px; padding: 12px 14px; gap: 10px; }
  .review-mark { width: 26px; height: 32px; border: 0; background: none; font-size: 21px; }
  .review-copy h2 { font-size: 16px; line-height: 1.5; }
  .review-copy p { display: none; }
  .review-strip .outline-link { padding: 6px 8px; min-width: 64px; border: 0; background: transparent; font-size: 16px; }
  .home-section-heading h2 { font-size: 22px; }
  .home-support { grid-template-columns: 1fr; gap: 28px; }
  .home-tools { padding-top: 24px; border-top: 1px solid var(--sv-border-subtle); }
  .todo-list { grid-template-columns: 1fr; gap: 16px; }
}
@media(max-width:600px) {
  .overview-page { font-size: 16px; }
  .feature-copy h2 { font-size: 40px; letter-spacing: -.5px; }
  .home-search { margin-top: 24px; }
  .feature-actions { margin-top: 16px; gap: 16px; }
  .solid-link, .text-link, .todo-action { font-size: 16px; }
  .feature-actions .solid-link { padding: 10px 16px; }
  .display-heading h2 { font-size: 20px; }
  .record-caption strong, .main-record .record-caption strong { font-size: 16px; }
  .record-caption>span { font-size: 14px; }
  .home-library { margin-top: 34px; }
  .home-section-heading { gap: 12px; margin-bottom: 18px; }
  .home-section-heading>div { gap: 6px; flex-direction: column; }
  .home-section-heading>div>span { font-size: 14px; }
  .recent-shelf { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 26px 16px; }
  .shelf-song>span { font-size: 16px; }
  .content-empty, .record-waiting>p { font-size: 16px; }
  .home-library :deep(.empty-description) { font-size: 16px; }
  .home-playlists { grid-template-columns: 1fr; }
  .home-playlists>a>div>span { font-size: 16px; }
  .todo-copy>strong { font-size: 16px; }
  .todo-copy>p, .todo-note { font-size: 16px; }
  .family-invitation { gap: 16px; }
  .family-invitation h2 { font-size: 21px; }
  .family-invitation p, .support-note, .tool-links small { font-size: 16px; }
  .home-task strong { font-size: 16px; }
  .home-task small { font-size: 14px; }
  .home-status { gap: 0 14px; }
  .readiness-row { width: 100%; gap: 0 16px; }
  .readiness-chip { font-size: 14px; }
  .status-actions { width: 100%; justify-content: space-between; }
}
@media(max-width:360px) {
  .review-mark { display: none; }
  .review-strip { gap: 8px; }
}
</style>
