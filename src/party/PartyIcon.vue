<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 22v-3a8 8 0 0 1 16 0v3',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v6l4 2',
  fire: 'M13 2c1 6-4 7-4 3-5 5-5 11 0 15 7 5 15-4 10-13 0 5-3 4-3 0 0-2-1-4-3-5Z',
  heart: 'm12 21-8-8C-3 6 7-2 12 6c5-8 15 0 8 7Z',
  search: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 m-2 5 6 6',
  plus: 'M12 5v14 M5 12h14',
  queue: 'M3 5h16 M3 11h11 M3 17h8 M18 12l4 4-4 4 M15 16h7',
  tv: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  close: 'm6 6 12 12 M6 18 18 6',
  more: 'M4 12h.01 M12 12h.01 M20 12h.01',
  pause: 'M8 5v14 M16 5v14',
  play: 'm8 4 12 8-12 8Z',
  next: 'm5 4 12 8-12 8Z M20 4v16',
  back: 'm14 5-7 7 7 7',
  chevron: 'm9 5 7 7-7 7',
  shuffle: 'M3 5h3l12 14h3 M17 15l4 4-4 4 M3 19h3L18 5h3 M17 1l4 4-4 4',
  restart: 'M4 10a8 8 0 1 1 1 8 M4 3v7h7',
  filter: 'M3 6h18 M6 12h12 M9 18h6',
  like: 'M7 10 12 3c2 0 3 2 2 4l-1 3h6c2 0 2 1 2 3l-2 7H7z M3 10h4v10H3z',
  clap: 'M7 12 6 6c0-3 3-2 3 0l1 5-1-8c0-2 3-2 3 0l1 7V3c0-2 3-2 3 0v8l1-5c1-2 3-1 2 1l-1 7c3-4 5-1 3 2l-4 5H9l-6-6c-2-3 1-4 4-1Z',
  cheer: 'm4 14 4-4 10-6v16L8 14H4z M8 14l2 7h4l-2-6 M21 8l2-1 M21 16l2 1',
  check: 'm5 12 4 4L20 5',
}
</script>
<template><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="paths[name] ?? paths.grid" /></svg></template>
