<script setup lang="ts">
import { computed, ref } from 'vue'
import { linksOfHypothesis, locusName, state } from '../store'
import { compareHypotheses, evaluateChronology } from '../graph/dating'
import type { HypothesisLink } from '../types'

const idA = ref('')
const idB = ref('')

const hypName = (id: string) =>
  state.hypotheses.find((h) => h.id === id)?.name ?? '（未选择）'

const evalOf = (id: string) =>
  evaluateChronology({
    relations: state.relations,
    loci: state.loci,
    dating: state.dating,
    links: linksOfHypothesis(id),
  })

/** 逐项比较：关联项差异 + 每个层位的阶段归属差异 + 各自矛盾。 */
const diff = computed(() => {
  if (!idA.value || !idB.value || idA.value === idB.value) return null
  return compareHypotheses(
    linksOfHypothesis(idA.value),
    linksOfHypothesis(idB.value),
    evalOf(idA.value),
    evalOf(idB.value),
    state.loci,
  )
})

const changedRows = computed(
  () => diff.value?.phaseRows.filter((r) => r.changed) ?? [],
)

const linkText = (l: HypothesisLink) => l.members.map(locusName).join(' ≈ ')
</script>

<template>
  <section class="panel">
    <h3>假设对比</h3>
    <p class="tip">
      逐项比较两个假设对阶段划分的影响；比较结果仅供研判，不写回共同底稿。
    </p>
    <div class="row">
      <select v-model="idA">
        <option value="" disabled>假设 A</option>
        <option v-for="h in state.hypotheses" :key="h.id" :value="h.id">
          {{ h.name }}
        </option>
      </select>
      <select v-model="idB">
        <option value="" disabled>假设 B</option>
        <option v-for="h in state.hypotheses" :key="h.id" :value="h.id">
          {{ h.name }}
        </option>
      </select>
    </div>

    <template v-if="diff">
      <h4>关联项差异</h4>
      <table>
        <tbody>
          <tr v-for="l in diff.onlyA" :key="'a' + l.id">
            <td class="only">仅 A</td>
            <td>{{ linkText(l) }}</td>
          </tr>
          <tr v-for="l in diff.both" :key="'b' + l.id">
            <td class="both">共有</td>
            <td>{{ linkText(l) }}</td>
          </tr>
          <tr v-for="l in diff.onlyB" :key="'c' + l.id">
            <td class="only">仅 B</td>
            <td>{{ linkText(l) }}</td>
          </tr>
          <tr v-if="!diff.onlyA.length && !diff.both.length && !diff.onlyB.length">
            <td colspan="2" class="empty">两假设均无关联项</td>
          </tr>
        </tbody>
      </table>

      <h4>矛盾对比</h4>
      <table>
        <tbody>
          <tr>
            <td>{{ hypName(idA) }}</td>
            <td :class="{ bad: diff.contradictionsA.length }">
              {{ diff.contradictionsA.length ? `${diff.contradictionsA.length} 处矛盾` : '自洽' }}
            </td>
          </tr>
          <tr>
            <td>{{ hypName(idB) }}</td>
            <td :class="{ bad: diff.contradictionsB.length }">
              {{ diff.contradictionsB.length ? `${diff.contradictionsB.length} 处矛盾` : '自洽' }}
            </td>
          </tr>
        </tbody>
      </table>

      <h4>阶段划分差异（{{ changedRows.length }} 个层位受影响）</h4>
      <table>
        <thead>
          <tr>
            <th>层位</th>
            <th>{{ hypName(idA) }}</th>
            <th>{{ hypName(idB) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in changedRows" :key="r.locusId" class="changed">
            <td>{{ locusName(r.locusId) }}</td>
            <td>{{ r.phaseA }}</td>
            <td>{{ r.phaseB }}</td>
          </tr>
          <tr v-if="!changedRows.length">
            <td colspan="3" class="empty">两假设的阶段划分一致</td>
          </tr>
        </tbody>
      </table>
    </template>
    <div v-else class="empty">请选择两个不同的假设</div>
  </section>
</template>

<style scoped>
.panel { background: #fffdf6; border: 1px solid #e2d8bd; border-radius: 8px; padding: 10px 12px; }
h3 { margin: 0 0 6px; font-size: 14px; color: #5a4f38; }
h4 { margin: 12px 0 4px; font-size: 12px; color: #6a5f48; }
.tip { font-size: 11px; color: #8a7a55; margin: 0 0 8px; }
.row { display: flex; gap: 6px; }
select { font-size: 13px; padding: 4px 6px; border: 1px solid #d5c9a8; border-radius: 4px; background: #fff; flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
td, th { text-align: left; padding: 2px 4px; border-bottom: 1px dashed #e8dfc8; }
th { color: #8a7a55; font-weight: normal; }
.only { color: #a06020; white-space: nowrap; }
.both { color: #3f6a34; white-space: nowrap; }
.bad { color: #a03024; }
.changed td { background: #fdf3e0; }
.empty { color: #a89f88; }
</style>
