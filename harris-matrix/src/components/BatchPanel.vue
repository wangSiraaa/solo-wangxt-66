<script setup lang="ts">
import { computed } from 'vue'
import { state, undoLastBatch } from '../store'

const batches = computed(() => [...state.batches].reverse())

async function undo() {
  await undoLastBatch()
}

const fmt = (t: number) => new Date(t).toLocaleTimeString()
</script>

<template>
  <section class="panel">
    <h3>
      操作批次
      <button
        class="mini"
        :disabled="!batches.some((b) => !b.undone)"
        @click="undo"
      >
        撤销最近批次
      </button>
    </h3>
    <div v-if="!batches.length" class="empty">尚无操作</div>
    <div
      v-for="b in batches"
      :key="b.id"
      class="batch"
      :class="{ undone: b.undone }"
    >
      <span class="time">{{ fmt(b.at) }}</span>
      <span class="label">{{ b.label }}</span>
      <span class="n">{{ b.changes.length }} 项</span>
      <span v-if="b.undone" class="flag">已撤销</span>
    </div>
  </section>
</template>

<style scoped>
.panel { background: #fffdf6; border: 1px solid #e2d8bd; border-radius: 8px; padding: 10px 12px; }
h3 { margin: 0 0 8px; font-size: 14px; color: #5a4f38; display: flex; justify-content: space-between; align-items: center; }
.batch { display: flex; gap: 8px; font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #e8dfc8; align-items: baseline; }
.batch.undone { opacity: 0.55; text-decoration: line-through; }
.time { color: #a89f88; }
.label { flex: 1; }
.n { color: #8a7a55; }
.flag { color: #a03024; text-decoration: none; }
.empty { font-size: 12px; color: #a89f88; }
button.mini { font-size: 11px; padding: 2px 8px; border-radius: 4px; border: 1px solid #b0a480; background: #f4ecd6; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
</style>
