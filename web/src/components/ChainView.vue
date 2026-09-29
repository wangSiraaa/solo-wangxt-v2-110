<script setup>
defineProps({ chain: { type: Array, default: () => [] } });
const statusColor = (s) =>
  s === null ? 'var(--bad)' : s >= 200 && s < 300 ? 'var(--ok)'
  : s >= 300 && s < 400 ? 'var(--warn)' : 'var(--bad)';
</script>
<template>
  <div class="chain">
    <div v-for="(h, i) in chain" :key="i">
      <span :style="{ color: statusColor(h.status), fontWeight: 700 }">
        {{ h.status === null ? '⛔ 已拦截' : h.status }}
      </span>
      <code> {{ h.url }}</code>
      <span v-if="h.location" class="muted"> → <code>{{ h.location }}</code></span>
    </div>
  </div>
</template>
