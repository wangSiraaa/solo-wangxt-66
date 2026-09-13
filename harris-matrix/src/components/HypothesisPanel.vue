<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import {
  addHypothesisLink,
  createHypothesis,
  deleteHypothesis,
  linksOfHypothesis,
  locusName,
  removeHypothesisLink,
  state,
} from '../store'
import {
  evaluateChronology,
  fmtInterval,
  type Contradiction,
  type EvidenceItem,
} from '../graph/dating'

const highlight = inject<(ids: string[]) => void>('highlightCycle', () => {})

const newName = ref('')
const newNote = ref('')
const selectedId = ref<string>('')
const linkMembers = ref<string[]>([])
const linkNote = ref('')
const error = ref('')

const selected = computed(() =>
  state.hypotheses.find((h) => h.id === selectedId.value),
)
const selectedLinks = computed(() => linksOfHypothesis(selectedId.value))

/** 评估是纯函数：只读底稿与假设，不写回共同底稿。 */
const evaluation = computed(() =>
  selectedId.value
    ? evaluateChronology({
        relations: state.relations,
        loci: state.loci,
        dating: state.dating,
        links: selectedLinks.value,
      })
    : null,
)

const summaries = computed(() => {
  const m = new Map<string, { n: number; ok: boolean }>()
  for (const h of state.hypotheses) {
    const res = evaluateChronology({
      relations: state.relations,
      loci: state.loci,
      dating: state.dating,
      links: linksOfHypothesis(h.id),
    })
    m.set(h.id, { n: res.contradictions.length, ok: res.ok })
  }
  return m
})

const locusOptions = computed(() =>
  [...state.loci].sort((a, b) => a.id.localeCompare(b.id)),
)

const datedLoci = computed(() => {
  if (!evaluation.value) return []
  return state.loci
    .map((l) => ({ locus: l, iv: evaluation.value!.intervals.get(l.id)! }))
    .filter((x) => x.iv && (x.iv.lo !== null || x.iv.hi !== null))
    .sort((a, b) => a.locus.id.localeCompare(b.locus.id))
})

async function addHypothesis() {
  if (!newName.value.trim()) return
  const h = await createHypothesis(newName.value.trim(), newNote.value.trim() || undefined)
  newName.value = ''
  newNote.value = ''
  selectedId.value = h.id
}

async function addLink() {
  error.value = ''
  try {
    await addHypothesisLink(
      selectedId.value,
      linkMembers.value,
      linkNote.value.trim() || undefined,
    )
    linkMembers.value = []
    linkNote.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}

const itemText = (it: EvidenceItem): string => {
  switch (it.kind) {
    case 'link':
      return `关联项：${it.members.map(locusName).join(' ≈ ')}`
    case 'path':
      return `先后关系链：${it.path.map(locusName).join(' → ')}`
    case 'relation':
      return `先后关系：${locusName(it.from)} → ${locusName(it.to)}`
    case 'dating':
      return `测年证据 ${it.datingId.slice(0, 12)}…：${locusName(it.locusId)} ${
        it.bound === 'lo' ? '不早于' : '不晚于'
      } ${it.bp} BP（经 ${it.route.map(locusName).join(' → ')}）`
  }
}

const locate = (c: Contradiction) => {
  const pathItem = c.items.find((i) => i.kind === 'path')
  if (pathItem && pathItem.kind === 'path') highlight(pathItem.path)
}
</script>

<template>
  <section class="panel">
    <h3>关联假设</h3>
    <p class="tip">
      假设彼此隔离、只读试算：未确认的关联不会写回共同底稿。矛盾只展示依据，不自动修正原始记录。
    </p>
    <div class="row">
      <input v-model="newName" placeholder="假设名称" />
      <input v-model="newNote" placeholder="说明（可空）" />
    </div>
    <button @click="addHypothesis">新建假设</button>

    <div class="hyp-list">
      <div
        v-for="h in state.hypotheses"
        :key="h.id"
        class="hyp"
        :class="{ on: h.id === selectedId }"
        @click="selectedId = h.id"
      >
        <span class="hyp-name">{{ h.name }}</span>
        <span
          v-if="summaries.get(h.id)"
          class="badge"
          :class="summaries.get(h.id)!.ok ? 'ok' : 'bad'"
        >
          {{ summaries.get(h.id)!.ok ? '自洽' : `${summaries.get(h.id)!.n} 处矛盾` }}
        </span>
      </div>
      <div v-if="!state.hypotheses.length" class="empty">尚无假设</div>
    </div>

    <template v-if="selected && evaluation">
      <div class="detail">
        <div class="detail-head">
          <strong>{{ selected.name }}</strong>
          <button class="mini danger" @click="deleteHypothesis(selected.id); selectedId = ''">
            删除假设
          </button>
        </div>
        <div v-if="selected.note" class="note">{{ selected.note }}</div>

        <h4>关联项（视为同时期）</h4>
        <div v-for="l in selectedLinks" :key="l.id" class="link">
          <span>{{ l.members.map(locusName).join(' ≈ ') }}</span>
          <span v-if="l.note" class="note">{{ l.note }}</span>
          <button class="mini" @click="removeHypothesisLink(l.id)">移除</button>
        </div>
        <div v-if="!selectedLinks.length" class="empty">尚无关联项</div>
        <select v-model="linkMembers" multiple size="4">
          <option v-for="l in locusOptions" :key="l.id" :value="l.id">
            {{ l.trench }}·{{ l.code }} {{ l.label }}
          </option>
        </select>
        <input v-model="linkNote" placeholder="关联依据（可空）" />
        <button :disabled="linkMembers.length < 2" @click="addLink">
          添加关联项（{{ linkMembers.length }} 个层位）
        </button>
        <div v-if="error" class="error">{{ error }}</div>

        <h4>矛盾依据（{{ evaluation.contradictions.length }}）</h4>
        <div
          v-for="c in evaluation.contradictions"
          :key="c.id"
          class="contradiction"
        >
          <div class="c-head">
            <span class="c-type">{{ c.type === 'cycle' ? '先后成环' : '年代无交集' }}</span>
            <button
              v-if="c.items.some((i) => i.kind === 'path')"
              class="mini"
              @click="locate(c)"
            >
              画布定位
            </button>
          </div>
          <div class="c-summary">{{ c.summary }}</div>
          <div v-for="(it, i) in c.items" :key="i" class="c-item">
            · {{ itemText(it) }}
          </div>
        </div>
        <div v-if="!evaluation.contradictions.length" class="ok">
          该假设下未发现矛盾
        </div>

        <h4>传播后的年代区间</h4>
        <table>
          <thead>
            <tr><th>层位</th><th>区间</th><th>阶段</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in datedLoci" :key="row.locus.id">
              <td>{{ locusName(row.locus.id) }}</td>
              <td>{{ fmtInterval(row.iv) }}</td>
              <td>{{ evaluation.phases.get(row.locus.id) ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.panel { background: #fffdf6; border: 1px solid #e2d8bd; border-radius: 8px; padding: 10px 12px; }
h3 { margin: 0 0 6px; font-size: 14px; color: #5a4f38; }
h4 { margin: 12px 0 4px; font-size: 12px; color: #6a5f48; }
.tip { font-size: 11px; color: #8a7a55; margin: 0 0 8px; }
.row { display: flex; gap: 6px; }
input, select { font-size: 13px; padding: 4px 6px; border: 1px solid #d5c9a8; border-radius: 4px; background: #fff; margin-bottom: 6px; width: 100%; box-sizing: border-box; }
select[multiple] { min-height: 70px; }
button { font-size: 13px; padding: 5px 12px; border-radius: 5px; cursor: pointer; border: 1px solid #8a7a55; background: #efe6cc; color: #4a4030; }
button:disabled { opacity: 0.5; cursor: default; }
button.mini { font-size: 11px; padding: 1px 8px; border-radius: 4px; border: 1px solid #b0a480; background: #f4ecd6; }
button.mini.danger { border-color: #b0483a; color: #8a2a20; background: #f6e0dc; }
.hyp-list { margin-top: 8px; }
.hyp { display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 4px 8px; border-radius: 5px; cursor: pointer; }
.hyp:hover { background: #f4ecd6; }
.hyp.on { background: #ece0c0; outline: 1px solid #c9b98a; }
.badge { font-size: 11px; border-radius: 3px; padding: 1px 6px; }
.badge.ok { background: #dce8d2; color: #3f6a34; }
.badge.bad { background: #f6dcd6; color: #a03024; }
.detail { margin-top: 10px; border-top: 1px dashed #e0d5b5; padding-top: 8px; }
.detail-head { display: flex; justify-content: space-between; align-items: center; }
.note { font-size: 11px; color: #8a8578; }
.link { display: flex; gap: 6px; align-items: baseline; font-size: 12px; padding: 2px 0; }
.link span:first-child { flex: 1; }
.contradiction { border: 1px solid #e0b0a0; background: #fdf3ef; border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; }
.c-head { display: flex; justify-content: space-between; align-items: center; }
.c-type { font-size: 11px; font-weight: bold; color: #a03024; }
.c-summary { font-size: 12px; margin: 3px 0; }
.c-item { font-size: 11px; color: #6a5a4a; font-family: ui-monospace, monospace; }
.ok { font-size: 12px; color: #3f6a34; }
.error { color: #a03024; font-size: 12px; margin-top: 6px; }
.empty { font-size: 12px; color: #a89f88; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 2px 4px; border-bottom: 1px dashed #e8dfc8; }
th { color: #8a7a55; font-weight: normal; }
</style>
