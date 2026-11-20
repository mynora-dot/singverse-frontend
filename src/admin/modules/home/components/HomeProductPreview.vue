<script setup lang="ts">
import { ArrowRight, Clock, FolderOpened, Plus, Warning } from '@element-plus/icons-vue'

const emit = defineEmits<{ login: [destination: string] }>()
const metrics = [
  { label: '已入库歌曲', value: 17 },
  { label: '歌曲版本', value: 17 },
  { label: '媒体文件', value: 17 },
  { label: '歌名和歌手齐全', value: 16 },
]
</script>

<template>
  <div class="sv-home-preview">
    <div class="sv-home-preview-masthead">
      <div class="sv-home-preview-brand"><img src="/assets/brand/logo-mark.svg" width="28" height="28" alt=""><strong>SingVerse<span>.</span></strong></div>
      <nav aria-label="预览中的管理导航">
        <button type="button" @click="emit('login', '/overview')">首页</button>
        <button type="button" @click="emit('login', '/library/songs')">曲库</button>
        <button class="is-current" type="button" @click="emit('login', '/library/media')">加歌</button>
        <button type="button" @click="emit('login', '/library/songs/metadata')">整理</button>
        <button type="button" @click="emit('login', '/system/tv-settings')">客厅</button>
      </nav>
    </div>
    <div class="sv-home-preview-tabs"><span>歌曲来源</span><button type="button" @click="emit('login', '/library/downloads')">下载歌曲</button><button type="button" @click="emit('login', '/library/media/recognition')">文件名识别</button></div>
    <div class="sv-home-preview-body">
      <div class="sv-home-preview-heading"><div><h3>歌曲来源</h3><span>1 个来源</span></div><button type="button" aria-label="登录后添加歌曲来源" @click="emit('login', '/library/media')"><Plus aria-hidden="true" /><span>添加来源</span></button></div>
      <article class="sv-home-preview-source" aria-label="WebDAV 歌曲来源示例">
        <div class="sv-home-preview-source-header">
          <div class="sv-home-preview-folder"><FolderOpened aria-hidden="true" /></div>
          <div class="sv-home-preview-source-info">
            <div class="sv-home-preview-source-title"><h4>WebDAV 歌曲</h4><span class="sv-home-preview-type">WebDAV</span></div>
            <p>https://nas.example.invalid/music/</p>
            <button class="sv-home-preview-link" type="button" @click="emit('login', '/library/media/recognition')">文件名识别：默认解析方案<ArrowRight aria-hidden="true" /></button>
          </div>
          <span class="sv-home-preview-status">扫描完成</span>
        </div>
        <dl class="sv-home-preview-metrics"><div v-for="metric in metrics" :key="metric.label"><dt>{{ metric.label }}</dt><dd>{{ metric.value }}</dd></div></dl>
        <div class="sv-home-preview-attention"><Warning aria-hidden="true" /><p><strong>1</strong> 首歌曲信息不足</p><button type="button" @click="emit('login', '/library/media')">去完善<ArrowRight aria-hidden="true" /></button></div>
        <details class="sv-home-preview-scan"><summary>扫描详情<span>1 个目录 · 17 个条目</span></summary><p>新增 17 · 复用 0 · 1 首歌曲需复核</p></details>
        <div class="sv-home-preview-source-footer">
          <p><Clock aria-hidden="true" />自动扫描未开启</p>
          <div><button class="is-primary" type="button" @click="emit('login', '/library/songs')">查看歌曲</button><button type="button" @click="emit('login', '/library/media')">分享资料</button></div>
        </div>
      </article>
    </div>
  </div>
</template>
