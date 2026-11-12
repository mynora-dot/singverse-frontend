<script setup lang="ts">
import PageHeader from '../../shared/ui/PageHeader.vue'
import ClientDownloads from '../../../downloads/ClientDownloads.vue'
</script>
<template>
  <section class="client-download-view">
    <PageHeader title="客户端下载" description="下载当前 NAS 内置的手机和电视安装包，或让亲友扫码安装。"><template #actions><a class="el-button" href="/downloads/" target="_blank" rel="noopener">打开免登录下载页</a></template></PageHeader>
    <ClientDownloads />
  </section>
</template>
<style scoped>.client-download-view { display: grid; gap: 20px; } .client-download-view > .page-heading { margin: 0; } a { text-decoration: none; }</style>
