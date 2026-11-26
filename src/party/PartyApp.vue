<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue'
import { type Credential, type Item, type QueueCommand, type Song } from './api'
import { playbackActions, usePartySession } from './usePartySession'
import { dimensions, finders, usePartyLibrary, type Finder } from './usePartyLibrary'
import AudioRolesEditor from './AudioRolesEditor.vue'
import MissingSongForm from './MissingSongForm.vue'
import PartyDialog from './PartyDialog.vue'
import PartyIcon from './PartyIcon.vue'
import PartyPhonePreview from './PartyPhonePreview.vue'
import PartyQueue from './PartyQueue.vue'
import PartyRemote from './PartyRemote.vue'
import PartyTelevisionPicker from './PartyTelevisionPicker.vue'
import SongArtwork from './SongArtwork.vue'
import SongRow from './SongRow.vue'
const serverHost = location.host
const session = usePartySession(), { state } = session
const nav = ref('songs'), sheet = ref(''), detail = ref<Song>(), dimension = ref('LANGUAGE'), filtersOpen = ref(false)
const onStage = computed(() => nav.value === 'stage')
const navigation = [
  { id: 'songs', label: '点歌', icon: 'grid' },
  { id: 'queue', label: '已点', icon: 'queue' },
  { id: 'stage', label: '现场', icon: 'tv' },
]
const searchInput = ref<HTMLInputElement>()
const resultsHeading = ref<HTMLHeadingElement>()
const confirmation = ref<{ action: string; itemId?: string; attemptId?: string }>(), scrolls = new Map<string, number>()
const snapshot = computed(() => state.snapshot), current = session.current
const initialized = ref(false), narrowViewport = ref(window.innerWidth <= 800)
const joinPage = ref<HTMLElement>(), controlPage = ref<HTMLElement>()
const scrollPane = ref<HTMLElement>()
const selectedTelevision = computed(() => state.credential?.deviceName)
const previewEnabled = computed(() => !!selectedTelevision.value && !!snapshot.value && !narrowViewport.value)
const pageScroll = {
  position: () => previewEnabled.value && scrollPane.value ? scrollPane.value.scrollTop : window.scrollY,
  move(top: number) {
    if (previewEnabled.value && scrollPane.value) scrollPane.value.scrollTop = top
    else window.scrollTo(0, top)
  },
}
const library = usePartyLibrary(session, pageScroll), catalog = library.state
const roomName = computed(() => selectedTelevision.value || '本场电视')
const roomStatus = computed(() => {
  if (onStage.value || (state.online && snapshot.value?.tvOnline)) return roomName.value
  return state.online ? '电视离线' : '正在重连'
})
function updateViewport() {
  const narrow = window.innerWidth <= 800
  if (narrow === narrowViewport.value) return
  const position = pageScroll.position()
  narrowViewport.value = narrow
  void nextTick(() => pageScroll.move(position))
}
watchEffect(() => {
  document.body.classList.toggle('party-compact', narrowViewport.value || !!selectedTelevision.value)
})
const activeCurrent = computed(() => current.value && !['ENDED', 'IDLE', 'ERROR'].includes(snapshot.value?.playback?.state ?? 'IDLE'))
const nowCredits = computed(() => {
  const item = current.value
  if (!item) return '打开遥控'
  return [item.song.artists?.join(' / '), item.ownerName && `${item.ownerName}点的`].filter(Boolean).join(' · ')
})
const title = computed(() => catalog.artist?.name ?? (catalog.query ? '搜索结果' : ({ category: catalog.selected.length ? '分类歌曲' : '大家一起唱', artists: '按歌手找歌', recent: '最近唱过', popular: '热门歌曲', favorites: '家庭收藏' }[catalog.entry])))
const canAdd = computed(() => state.online && !state.busy && !state.pending && snapshot.value?.status === 'ACTIVE' && snapshot.value.acceptingRequests)
const selectedTags = computed(() => catalog.tags.filter(tag => catalog.selected.includes(tag.id)))
const quickLanguages = computed(() => catalog.tags.filter(tag => tag.dimension === 'LANGUAGE').slice(0, 2))
const retryAvailable = computed(() => !!state.pending && !state.busy)
const feedback = computed(() => {
  if (state.error) return state.error
  const result = session.execution.value
  if (result?.status === 'FAILED') return result.detail || '电视未能执行，请检查播放状态'
  if (onStage.value) return ''
  const command = state.lastCommand
  if (!command) return state.notice
  if (result || command.action === 'ADD' || playbackActions.includes(command.action)) return ''
  return '队列已更新'
})
function clearSearch() {
  catalog.query = ''
  searchInput.value?.focus({ preventScroll: true })
}
function submitSearch() {
  resultsHeading.value?.focus({ preventScroll: true })
  pageScroll.move(0)
  void library.load()
}
async function safely(task: () => Promise<unknown>) { try { await task() } catch (e) { session.failure(e) } }
function command(action: string, fields: Partial<QueueCommand> = {}) { void safely(() => session.command(action, fields)) }
function add(song: Song) { command('ADD', { songId: song.id }) }
function favorite(song: Song) { void session.setFavorite(song.id, !state.favoriteIds.includes(song.id)) }
function openDetail(song: Song) { detail.value = song; sheet.value = 'detail' }
function correct(song = current.value?.song) { if (song) { detail.value = song; sheet.value = 'correction' } }
function confirmAction(action: string, itemId?: string) { confirmation.value = { action, itemId, attemptId: snapshot.value?.playback?.attemptId }; sheet.value = 'confirm' }
function priority(item: Item) { if (snapshot.value?.priorityItemId && !item.priority) confirmAction('TOP', item.id); else command(item.priority ? 'UNTOP' : 'TOP', { itemId: item.id }) }
async function executeConfirmed() {
  const c = confirmation.value; if (!c) return
  const attempt = c.attemptId
  await safely(async () => { await session.command(c.action, { itemId: c.itemId, attemptId: attempt }); sheet.value = '' })
}
const confirmCopy = computed(() => {
  const action = confirmation.value?.action
  if (action === 'TOP') return { title: '替换下一首优先位？', body: '新的歌曲会优先唱，原来插队的歌曲恢复正常轮流。', button: '替换插队位' }
  if (action === 'RESTART') return { title: '从头重唱这首歌？', body: '电视会从 0:00 重新开始。', button: '确认重唱' }
  return { title: '切到下一首？', body: session.waiting.value[0] ? `下一首是《${session.waiting.value[0].song.title}》，由${session.waiting.value[0].ownerName}点唱。` : '当前没有下一首，切歌后会等待大家点歌。', button: '确认切歌' }
})
async function navigate(value: string) { scrolls.set(nav.value, pageScroll.position()); nav.value = value; await nextTick(); pageScroll.move(scrolls.get(value) ?? 0) }
async function entry(value: Finder) { if (catalog.entry === value) return; scrolls.set(catalog.entry, pageScroll.position()); catalog.entry = value; catalog.artist = null; await library.load(); await nextTick(); pageScroll.move(scrolls.get(value) ?? 0) }
function dismissFeedback() { state.error = ''; state.notice = ''; state.lastCommand = null }
async function enterTelevision(credential: Credential) {
  await session.connectTelevision(credential)
  if (snapshot.value) {
    pageScroll.move(0)
    controlPage.value?.focus({ preventScroll: true })
  }
}
async function chooseAnotherTelevision() {
  session.leave()
  await nextTick()
  pageScroll.move(0)
  joinPage.value?.focus({ preventScroll: true })
}
watch(() => state.credential?.token, () => { sheet.value = ''; nav.value = 'songs'; scrolls.clear() })
onMounted(async () => {
  window.addEventListener('resize', updateViewport)
  await session.initialize()
  initialized.value = true
})
onUnmounted(() => {
  window.removeEventListener('resize', updateViewport)
  document.body.classList.remove('party-compact')
  session.close(); library.close()
})
</script>
<template><PartyPhonePreview :enabled="previewEnabled" :dialog-open="!!sheet">
<div class="party-app" :class="{ 'stage-active': onStage }"><div ref="scrollPane" class="party-scroll"><header class="app-header"><div class="header-inner">
  <a class="brand" href="/party/" aria-label="SingVerse 亲友点歌"><img src="/assets/brand/logo-mark.svg" width="36" height="36" alt=""><span>SingVerse</span></a>
  <button v-if="snapshot && selectedTelevision" class="header-room change-television" type="button"
    :aria-label="`切换电视，当前${roomName}`" :disabled="state.busy || !!state.pending" @click="chooseAnotherTelevision">
    <i class="dot" :class="{ offline: !state.online || !snapshot.tvOnline }" /><span :title="roomStatus">{{ roomStatus }}</span><PartyIcon name="chevron" />
  </button>
  <span v-else-if="snapshot" class="header-room"><i class="dot" :class="{ offline: !state.online || !snapshot.tvOnline }" />{{ roomStatus }}</span>
  <nav v-if="snapshot" class="header-nav" aria-label="聚会导航">
    <button v-for="item in navigation" :key="item.id" :class="{ active: nav === item.id }"
      :aria-current="nav === item.id ? 'page' : undefined" @click="navigate(item.id)">
      <PartyIcon :name="item.icon" />{{ item.label }}<span v-if="item.id === 'queue'" class="count">{{ session.waiting.value.length }}</span>
    </button>
  </nav>
  <button v-if="snapshot" class="icon-btn menu-button" aria-label="本场信息" @click="sheet = 'info'"><PartyIcon name="more" /></button>
</div></header>
<main v-if="!snapshot" ref="joinPage" class="join-layout" tabindex="-1"><section class="join-panel stack">
  <template v-if="state.preview">
    <h1>加入点歌台</h1>
    <form class="stack" @submit.prevent="session.join(state.nickname)">
      <div class="join-room"><PartyIcon name="tv" /><div><strong>{{ state.preview.deviceName }}</strong><p class="muted">{{ serverHost }}</p></div></div>
      <label class="field">昵称<input v-model="state.nickname" required maxlength="30" autocomplete="nickname"></label>
      <button class="primary full" :disabled="state.loading || !state.nickname.trim()">{{ state.loading ? '正在加入…' : '加入点歌' }}</button>
    </form>
  </template>
  <p v-else-if="!initialized || state.loading" class="join-empty" role="status">正在连接…</p>
  <template v-else-if="state.credential || session.hasInvitation.value">
    <h1>亲友点歌</h1>
    <button v-if="state.credential" class="outline full" @click="safely(session.refresh)">重新连接</button>
    <div v-else class="join-room"><PartyIcon name="tv" /><p>扫描电视上的二维码加入点歌。</p></div>
    <button v-if="selectedTelevision" class="text-button" @click="chooseAnotherTelevision">切换电视</button>
  </template>
  <PartyTelevisionPicker v-else :nickname="state.nickname" :busy="state.loading" @joined="enterTelevision" />
</section></main>
<main v-else ref="controlPage" class="layout" tabindex="-1"><div class="main-content"><div v-if="snapshot.status === 'ENDED'" class="banner">{{ selectedTelevision ? '本场聚会已结束，请重新选择电视。' : '本场聚会已结束。重新扫描电视二维码，加入下一场。' }}</div><div v-else-if="!snapshot.acceptingRequests" class="banner">电视暂时关闭了点歌，已有歌曲仍可继续演唱。</div><div v-if="snapshot.queuePolicy !== 'FAIR' && !onStage" class="banner">更新 TV 版本后，启用按人轮流、自动开唱和全员遥控。</div>
<section v-show="nav === 'songs'" class="library">
  <div class="search-sticky">
    <form class="search-box" role="search" @submit.prevent="submitSearch">
      <PartyIcon name="search" />
      <input ref="searchInput" v-model="catalog.query" type="search" enterkeyhint="search" maxlength="200" placeholder="搜索歌曲或歌手" aria-label="搜索歌曲或歌手">
      <button v-if="catalog.query" type="button" class="clear-search icon-btn" aria-label="清空搜索" @click="clearSearch"><PartyIcon name="close" /></button>
      <button type="button" class="missing-link" @click="sheet = 'missing'">缺歌反馈</button>
    </form>
  </div>
  <div class="finder" role="group" aria-label="找歌方式">
    <button v-for="finder in finders" :key="finder.id" :class="{ active: catalog.entry === finder.id }"
      :aria-pressed="catalog.entry === finder.id" @click="entry(finder.id)">
      <PartyIcon :name="finder.icon" />{{ finder.label }}
    </button>
  </div>
  <div v-if="catalog.entry === 'popular'" class="period-tabs segmented">
    <button v-for="p in [['30d','近 30 天'],['7d','近 7 天'],['all','全部']]" :key="p[0]"
      :class="{ active: catalog.period === p[0] }" @click="catalog.period = p[0]!">{{ p[1] }}</button>
  </div>
  <button v-if="catalog.artist" class="artist-back text-button" @click="library.closeArtist()"><PartyIcon name="back" />返回歌手</button>
  <div class="section-head">
    <h1 ref="resultsHeading" tabindex="-1">{{ title }}</h1>
    <span class="helper result-count">{{ catalog.total }} {{ catalog.entry === 'artists' && !catalog.artist ? '位' : '首' }}</span>
    <button v-if="catalog.entry === 'category' && catalog.tags.length" class="chip filter-button"
      :class="{ active: filtersOpen || catalog.selected.length }" :aria-expanded="filtersOpen"
      :aria-controls="filtersOpen ? 'song-filters' : undefined" @click="filtersOpen = !filtersOpen">
      <PartyIcon name="filter" />筛选<span v-if="catalog.selected.length">{{ catalog.selected.length }}</span>
    </button>
  </div>
  <template v-if="catalog.entry === 'category' && catalog.tags.length">
    <div v-if="!catalog.query && !filtersOpen && quickLanguages.length" class="filter-line">
      <button class="chip" :class="{ active: !catalog.selected.length }" :aria-pressed="!catalog.selected.length" @click="catalog.selected = []">全部</button>
      <button v-for="tag in quickLanguages" :key="tag.id" class="chip" :class="{ active: catalog.selected.includes(tag.id) }"
        :aria-pressed="catalog.selected.includes(tag.id)" @click="library.toggleTag(tag.id)">{{ tag.name }}</button>
    </div>
    <div v-if="filtersOpen" id="song-filters" class="filter-panel">
      <div class="filter-tabs">
        <button v-for="d in dimensions" :key="d.id" :class="{ active: dimension === d.id }" :aria-pressed="dimension === d.id"
          @click="dimension = d.id">{{ d.label }}</button>
      </div>
      <div class="filter-options">
        <button v-for="tag in catalog.tags.filter(t => t.dimension === dimension)" :key="tag.id" class="chip"
          :class="{ active: catalog.selected.includes(tag.id) }" :aria-pressed="catalog.selected.includes(tag.id)"
          @click="library.toggleTag(tag.id)">{{ tag.name }} <small>{{ tag.count }}</small></button>
        <p v-if="!catalog.tags.some(t => t.dimension === dimension)" class="helper">这个分类还没有标签。</p>
      </div>
      <div v-if="catalog.tags.some(t => t.dimension === 'CUSTOM')" class="filter-options">
        <span class="helper">自定义</span>
        <button v-for="tag in catalog.tags.filter(t => t.dimension === 'CUSTOM')" :key="tag.id" class="chip"
          :class="{ active: catalog.selected.includes(tag.id) }" :aria-pressed="catalog.selected.includes(tag.id)"
          @click="library.toggleTag(tag.id)">{{ tag.name }}</button>
      </div>
      <p class="helper">同一维度任选，跨维度同时满足；数量为全库数量。</p>
    </div>
    <div v-if="selectedTags.length" class="selected-tags">
      <span v-for="tag in selectedTags" :key="tag.id" class="pill">{{ tag.name }}</span>
      <button class="text-button" @click="catalog.selected = []">清除</button>
    </div>
  </template>
  <p v-if="catalog.entry === 'recent' || catalog.entry === 'popular' || catalog.entry === 'favorites'" class="list-context">
    {{ catalog.entry === 'recent' ? '本 NAS 实际唱过的歌曲，按歌曲去重' : catalog.entry === 'popular' ? '按本 NAS 的实际播放记录排行' : '本 NAS 全家共享，大家都能收藏和移除' }}
  </p>
  <div v-if="catalog.error" class="read-error" role="alert"><p>{{ catalog.error }}</p><button class="outline" @click="library.load()">重新读取</button></div>
  <div v-else-if="catalog.loading && !catalog.songs.length && !catalog.artists.length" class="empty-state" role="status">正在找歌…</div>
  <div v-else-if="!catalog.total" class="empty-state">
    <PartyIcon :name="catalog.entry === 'favorites' ? 'heart' : 'search'" />
    <h3>{{ catalog.query ? '暂时没找到这首歌' : catalog.entry === 'favorites' ? '把全家爱唱的歌放在这里' : '这里还没有歌曲' }}</h3>
    <p>{{ catalog.query ? '试试歌手或更短的关键词，也可以反馈缺歌。' : catalog.entry === 'recent' || catalog.entry === 'popular' ? '唱过之后，这里会逐渐留下大家的好歌。' : '先去分类里挑一首喜欢的歌。' }}</p>
    <button v-if="catalog.query" class="subtle" @click="sheet = 'missing'">反馈缺歌</button>
  </div>
  <div v-else-if="catalog.entry === 'artists' && !catalog.artist" class="artist-grid">
    <button v-for="artist in catalog.artists" :key="artist.id" class="artist-item" @click="library.openArtist(artist)">
      <SongArtwork :path="artist.portraitPath" :token="state.credential?.token" :alt="`${artist.name}照片`" :fallback="artist.name" />
      <span class="song-meta"><strong class="song-title">{{ artist.name }}</strong><span class="song-artist">{{ artist.count }} 首歌曲</span></span>
      <PartyIcon name="chevron" />
    </button>
  </div>
  <div v-else class="song-list">
    <SongRow v-for="song in catalog.songs" :key="song.id" :song="song" :token="state.credential?.token"
      :favorite="state.favoriteIds.includes(song.id)" :favorite-disabled="!state.favoritesReady || state.favoriteBusy.includes(song.id) || !state.online"
      :add-disabled="!canAdd" @detail="openDetail" @favorite="favorite" @add="add" />
  </div>
  <button v-if="(catalog.page + 1) * 30 < catalog.total" class="outline full load-more" :disabled="catalog.loading" @click="library.load(true)">
    {{ catalog.loading ? '正在读取…' : '再看一些' }}
  </button>
</section>
<PartyQueue v-if="nav === 'queue'" :session="session" @priority="priority" @remove="item => command('REMOVE', { itemId: item.id })" @shuffle="command('SHUFFLE')" @detail="item => openDetail(item.song)" />
<section v-if="onStage" class="stage" aria-labelledby="stage-title">
  <h1 id="stage-title">现场遥控</h1>
  <PartyRemote :session="session" @command="command" @confirm="confirmAction" @correct="correct()" @reaction="kind => safely(() => session.react(kind))" />
</section>
</div>
<aside class="sidebar">
  <div v-if="!onStage" class="side-section">
    <div class="side-heading"><h2>电视播放</h2><button class="text-button" @click="sheet = 'remote'">完整遥控</button></div>
    <PartyRemote :session="session" compact @command="command" @confirm="confirmAction" @correct="correct()" @reaction="kind => safely(() => session.react(kind))" />
  </div>
  <section class="side-next" aria-label="接下来的歌曲">
    <div class="side-heading">
      <h2>接下来</h2>
      <button v-if="!onStage || session.waiting.value.length" class="text-button" @click="navigate('queue')">
        全部 {{ session.waiting.value.length }} 首<PartyIcon v-if="onStage" name="chevron" />
      </button>
      <button v-else-if="state.online && snapshot.status === 'ACTIVE' && snapshot.acceptingRequests" class="text-button" @click="navigate('songs')">
        去点歌<PartyIcon name="chevron" />
      </button>
    </div>
    <ol v-if="session.waiting.value.length" class="upcoming-list">
      <li v-for="(item, index) in session.waiting.value.slice(0, 3)" :key="item.id" class="next-row">
        <span class="queue-number" aria-hidden="true">{{ index + 1 }}</span>
        <SongArtwork :path="item.song.coverPath" :token="state.credential?.token" alt="" />
        <div class="song-meta">
          <strong class="song-title">{{ item.song.title }}</strong>
          <span class="song-artist"><template v-if="onStage && item.song.artists?.length">{{ item.song.artists.join(' / ') }} · </template>{{ item.ownerName }}点的{{ item.priority ? ' · 下一首优先' : '' }}</span>
        </div>
      </li>
    </ol>
    <p v-else-if="onStage" class="empty-queue">还没有待唱歌曲。</p>
    <p v-if="!onStage" class="helper side-footnote">好歌轮流唱，每人一首。<br>临时插队唱完后，继续正常轮流。</p>
  </section>
</aside>
</main></div>
<div v-if="snapshot" class="mobile-dock">
  <div v-if="!onStage" class="mobile-tvbar">
    <button class="now-open" :aria-label="`打开${roomName}遥控，${session.playbackStatus.value}${current ? '，' + current.song.title : ''}`" @click="sheet = 'remote'">
      <SongArtwork :path="current?.song.coverPath" :token="state.credential?.token" />
      <span class="song-meta">
        <strong class="song-title">{{ current?.song.title || roomName }}</strong>
        <span class="bar-byline">
          <span class="bar-status">{{ session.playbackStatus.value }}</span>
          <span v-if="nowCredits" class="bar-owner">{{ nowCredits }}</span>
        </span>
      </span>
    </button>
    <button class="icon-btn" :aria-label="snapshot.playback?.state === 'PAUSED' ? '继续电视播放' : '暂停电视播放'"
      :disabled="!state.online || !snapshot.tvOnline || !activeCurrent || state.busy || !!state.pending || snapshot.queuePolicy !== 'FAIR'"
      @click="command(snapshot.playback?.state === 'PAUSED' ? 'RESUME' : 'PAUSE')">
      <PartyIcon :name="snapshot.playback?.state === 'PAUSED' ? 'play' : 'pause'" />
    </button>
  </div>
  <nav class="bottom-nav" aria-label="手机聚会导航">
    <button v-for="item in navigation" :key="item.id" :class="{ active: nav === item.id }"
      :aria-current="nav === item.id ? 'page' : undefined" @click="navigate(item.id)">
      <PartyIcon :name="item.icon" />{{ item.label }}<span v-if="item.id === 'queue'" class="count">{{ session.waiting.value.length }}</span>
    </button>
  </nav>
</div>
<aside v-if="feedback || retryAvailable" class="feedback" :class="{ 'has-pending': retryAvailable }" role="status">
  <div>
    <p v-if="feedback">{{ feedback }}</p>
    <template v-if="retryAvailable">
      <p>结果尚未确认，重试将沿用同一请求。</p>
      <button @click="safely(session.sendPending)">重试原请求</button>
      <button @click="state.pending = null; dismissFeedback()">已核对，关闭请求</button>
    </template>
  </div>
  <button v-if="!state.pending" class="icon-btn" aria-label="关闭提示" @click="dismissFeedback"><PartyIcon name="close" /></button>
</aside>
<PartyDialog v-if="sheet" :scroll-container="previewEnabled ? scrollPane : undefined" :title="sheet === 'detail' ? '歌曲详情' : sheet === 'correction' ? '纠正原唱 / 伴奏' : sheet === 'missing' ? '反馈缺失歌曲' : sheet === 'confirm' ? confirmCopy.title : sheet === 'remote' ? '电视遥控' : '本场信息'" :locked="state.busy" @close="sheet = ''"><template v-if="sheet === 'detail' && detail"><div class="detail-song"><SongArtwork :path="detail.coverPath" :token="state.credential?.token" /><div class="song-meta"><h3>{{ detail.title }}</h3><p class="muted">{{ detail.artists?.join(' / ') || '歌手未知' }}<template v-if="detail.album"> · {{ detail.album }}</template></p></div></div><div class="detail-actions"><button class="primary" :disabled="!canAdd || detail.available === false" @click="add(detail)">点这首歌</button><button class="outline" :disabled="!state.favoritesReady || state.favoriteBusy.includes(detail.id)" @click="favorite(detail)"><PartyIcon name="heart" />{{ state.favoriteIds.includes(detail.id) ? '已收藏' : '家庭收藏' }}</button></div><button class="correction-entry outline full" @click="correct(detail)"><PartyIcon name="shuffle" />原唱和伴奏不对？纠正标记<PartyIcon name="chevron" /></button></template><AudioRolesEditor v-else-if="sheet === 'correction' && detail" :song-id="detail.id" :session="session" /><MissingSongForm v-else-if="sheet === 'missing'" :keyword="catalog.query" :session="session" /><template v-else-if="sheet === 'confirm'"><p class="confirm-copy">{{ confirmCopy.body }}</p><div class="confirm-actions"><button class="outline" @click="sheet = ''">先不操作</button><button class="primary" :disabled="state.busy" @click="executeConfirmed">{{ confirmCopy.button }}</button></div></template><PartyRemote v-else-if="sheet === 'remote'" :session="session" @command="command" @confirm="confirmAction" @correct="correct()" @reaction="kind => safely(() => session.react(kind))" /><div v-else class="stack"><p><strong>{{ state.credential?.name }}</strong>，欢迎来到客厅。</p><p class="muted">{{ snapshot?.host ? '你是本场主持人，可撤回所有待唱歌曲。' : '可撤回自己点的待唱歌曲。' }} 所有在场亲友都可以遥控电视。</p><p class="muted">散场、清空队列与人员授权在电视端管理。离开本页面不会撤回歌曲。</p><button class="outline full" @click="session.leave()">离开本场</button></div></PartyDialog>
</div>
</PartyPhonePreview></template>
