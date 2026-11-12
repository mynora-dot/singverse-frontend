import { createApp } from 'vue'
import 'element-plus/dist/index.css'
import '../admin/app/styles.css'
import { initTheme } from '../admin/app/composables/use-theme'
import DownloadsApp from './DownloadsApp.vue'
initTheme()
createApp(DownloadsApp).mount('#app')
