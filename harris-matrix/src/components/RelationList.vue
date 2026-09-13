<script setup lang="ts">
import { computed } from 'vue'
import {
  bulkRevoke,
  evidenceOf,
  locusLabel,
  locusName,
  setRelationStatus,
  state,
} from '../store'
import { LAYER_LABEL, STATUS_LABEL, type Relation } from '../types'

const groups = computed(() => {
  const by = (s: Relation['status']) =>
    state.relations.filter((r) => r.status === s)
  return [
    { status: 'active' as const, list: by('active') },
    { status: 'conflicted' as const, list: by('conflicted') },
    { status: 'revoked' as const, list: by('revoked') },
  ]
})

const relText = (r: Relation) =>
  r.kind === 'association'
    ? `${locusName(r.from)} ${locusLabel(r.from)} ≈ ${locusName(r.to)} ${locusLabel(r.to)}`
    : `${locusName(r.from)} ${locusLabel(r.from)} → ${locusName(r.to)} ${locusLabel(r.to)}`

async function revokeConflicted() {
  const ids = state.relations
    .filter((r) => r.status === 'conflicted')
    .map((r) => r.id)
  await bulkRevoke(ids, `批量撤销 ${ids.length} 条矛盾判断`)
}
</script>

<template>
  <section class="panel">
    <h3>
      关系台账
      <button
        v-if="groups[1].list.length"
        class="mini danger"
        @click="revokeConflicted"
      >
        批量撤销全部矛盾判断
      </button>
    </h3>
    <div v-for="g in groups" :key="g.status" class="group">
      <h4 :class="g.status">
        {{ STATUS_LABEL[g.status] }}（{{ g.list.length }}）
      </h4>
      <div v-for="r in g.list" :key="r.id" class="rel" :class="g.status">
        <div class="line">
          <span class="tag">{{ LAYER_LABEL[r.layer] }}</span>
          <span v-if="r.kind === 'association'" class="tag assoc">同期</span>
          <span class="text">{{ relText(r) }}</span>
          <button
            v-if="r.status !== 'revoked'"
            class="mini"
            @click="setRelationStatus(r.id, 'revoked')"
          >
            撤销
          </button>
          <button
            v-else
            class="mini"
            @click="setRelationStatus(r.id, 'active')"
          >
            恢复
          </button>
        </div>
        <div v-if="r.basis" class="basis">依据：{{ r.basis }}</div>
        <div v-for="e in evidenceOf(r.id)" :key="e.id" class="evidence">
          📎 [{{ e.type }}] {{ e.text }}
        </div>
      </div>
      <div v-if="!g.list.length" class="empty">无</div>
    </div>
  </section>
</template>

<style scoped>
.panel { background: #fffdf6; border: 1px solid #e2d8bd; border-radius: 8px; padding: 10px 12px; }
h3 { margin: 0 0 8px; font-size: 14px; color: #5a4f38; display: flex; justify-content: space-between; align-items: center; }
h4 { margin: 10px 0 4px; font-size: 12px; }
h4.active { color: #3f6a34; }
h4.conflicted { color: #a03024; }
h4.revoked { color: #8a8578; }
.rel { border-left: 3px solid #c9bd9a; padding: 3px 8px; margin-bottom: 6px; }
.rel.conflicted { border-left-color: #c0503f; }
.rel.revoked { opacity: 0.65; border-left-color: #b0a890; }
.line { display: flex; gap: 6px; align-items: center; font-size: 13px; }
.text { flex: 1; }
.tag { font-size: 10px; background: #e8dfc4; border-radius: 3px; padding: 1px 5px; color: #6a5f48; }
.tag.assoc { background: #e4d8ea; color: #6a4a7a; }
.basis { font-size: 12px; color: #7a6c50; }
.evidence { font-size: 12px; color: #5a6a7a; }
.empty { font-size: 12px; color: #a89f88; }
button.mini { font-size: 11px; padding: 1px 8px; border-radius: 4px; border: 1px solid #b0a480; background: #f4ecd6; cursor: pointer; }
button.mini.danger { border-color: #b0483a; color: #8a2a20; background: #f6e0dc; }
</style>
