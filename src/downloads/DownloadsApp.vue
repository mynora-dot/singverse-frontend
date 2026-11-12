<script setup lang="ts">
import ClientDownloads from './ClientDownloads.vue'
</script>
<template>
  <main class="public-downloads">
    <header><a href="/" class="download-brand">SingVerse<span>.</span></a><a href="/">管理中心</a></header>
    <section class="download-intro"><p>家庭自托管 KTV</p><h1>客户端下载</h1><p>将 SingVerse 安装到手机和电视，连接家中的 NAS 开始欢唱。</p></section>
    <ClientDownloads />
  </main>
</template>
<style scoped>
.public-downloads { width: min(1080px, 100%); margin: 0 auto; padding: 32px 24px 48px; box-sizing: border-box; }
header { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
header a { color: var(--sv-text-secondary); text-decoration: none; }
.download-brand { font-size: 25px; font-weight: 700; color: var(--sv-text-primary); }
.download-brand span { color: var(--sv-accent-primary); }
.download-intro { padding: 48px 0 32px; }
.download-intro h1 { font-size: clamp(30px, 5vw, 44px); margin: 12px 0; }
.download-intro p { margin: 0; color: var(--sv-text-secondary); line-height: 1.8; }
</style>
