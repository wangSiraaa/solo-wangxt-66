import {
  compareHypotheses,
  evaluateChronology,
  fmtInterval,
  type EvalInput,
} from '../src/graph/dating'
import type {
  DatingEvidence,
  HypothesisLink,
  Locus,
  Relation,
} from '../src/types'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    failures++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

// ---- 双探方测试底稿（与示例工程同构） ----
const L = (trench: string, code: string): Locus => ({
  id: `${trench}:${code}`,
  trench,
  code,
  label: code,
  kind: 'layer',
})
const loci: Locus[] = [
  ...['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'].map(
    (c) => L('TG1', c),
  ),
  ...['101', '102', '103', '104', '105', '106'].map((c) => L('TG2', c)),
]
const rel = (from: string, to: string): Relation => ({
  id: `r:${from}->${to}`,
  kind: 'stratigraphic',
  from,
  to,
  layer: 'observation',
  status: 'active',
  createdAt: 0,
})
const relations: Relation[] = [
  rel('TG1:101', 'TG1:102'), rel('TG1:102', 'TG1:103'), rel('TG1:103', 'TG1:104'),
  rel('TG1:104', 'TG1:105'), rel('TG1:105', 'TG1:106'), rel('TG1:106', 'TG1:109'),
  rel('TG1:107', 'TG1:108'), rel('TG1:108', 'TG1:106'),
  rel('TG2:101', 'TG2:102'), rel('TG2:102', 'TG2:103'), rel('TG2:103', 'TG2:104'),
  rel('TG2:104', 'TG2:105'), rel('TG2:105', 'TG2:106'),
]
const dat = (
  id: string,
  locusId: string,
  bpEarly: number | null,
  bpLate: number | null,
): DatingEvidence => ({
  id, locusId, bpEarly, bpLate, source: id, createdAt: 0,
})
const dating: DatingEvidence[] = [
  dat('d1', 'TG1:105', 3300, 3100),
  dat('d2', 'TG2:103', 3280, 3050),
  dat('d3', 'TG2:105', 3600, 3400),
  dat('d4', 'TG1:109', 12000, 6000),
]
const link = (id: string, hid: string, members: string[]): HypothesisLink => ({
  id, hypothesisId: hid, members: [...members].sort(), createdAt: 0,
})
const H1 = [link('l1', 'h1', ['TG1:105', 'TG2:103']), link('l2', 'h1', ['TG1:106', 'TG2:104'])]
const H2 = [link('l3', 'h2', ['TG1:105', 'TG2:105']), link('l4', 'h2', ['TG1:108', 'TG1:106'])]

const ev = (links: HypothesisLink[], d = dating): EvalInput => ({
  relations, loci, dating: d, links,
})

console.log('1. 同号不同层位')
const base = evaluateChronology(ev([]))
check('TG1:105 与 TG2:105 是独立节点',
  base.intervals.has('TG1:105') && base.intervals.has('TG2:105'))
check('同号层位各有独立区间',
  base.intervals.get('TG1:105')!.lo === -3300 &&
  base.intervals.get('TG2:105')!.lo === -3600)

console.log('2. 底稿年代传播（TPQ 上行 / TAQ 下行）')
check('TG1:103 继承 TG1:105 的 TPQ', base.intervals.get('TG1:103')!.lo === -3300)
check('TG1:106 继承 TG1:105 的 TAQ', base.intervals.get('TG1:106')!.hi === -3100)
check('TG1:101 沿链继承 TPQ', base.intervals.get('TG1:101')!.lo === -3300)
check('TG1:109 自身证据不被覆盖', base.intervals.get('TG1:109')!.lo === -12000)
check('未知端点保持 null，不为 0',
  base.intervals.get('TG1:103')!.hi === null &&
  base.intervals.get('TG1:101')!.hi === null &&
  base.intervals.get('TG1:101')!.hi !== 0 as unknown as boolean)
check('孤立层位无区间、阶段为 —',
  base.intervals.get('TG1:110')!.lo === null && base.phases.get('TG1:110') === '—')
check('fmtInterval 不输出 0', fmtInterval({ lo: null, hi: null }) === '未知')

console.log('3. 甲方案（年代兼容）自洽')
const r1 = evaluateChronology(ev(H1))
check('无矛盾', r1.ok, JSON.stringify(r1.contradictions.map((c) => c.summary)))
check('跨探方传播：TG2:104 继承 TAQ', r1.intervals.get('TG2:104')!.hi === -3100)
check('关联组取交集：TG1:105 lo = max(3300,3280)',
  r1.intervals.get('TG1:105')!.lo === -3280)
check('同组层位同阶段',
  r1.phases.get('TG1:105') === r1.phases.get('TG2:103') &&
  r1.phases.get('TG1:105') !== '—')
check('生土最早为 Ph1', r1.phases.get('TG1:109') === 'Ph1')

console.log('4. 乙方案：成环 + 年代无交集，依据可复现')
const r2 = evaluateChronology(ev(H2))
const cyc = r2.contradictions.find((c) => c.type === 'cycle')
const inv = r2.contradictions.find((c) => c.type === 'interval')
check('检出成环矛盾', !!cyc)
check('环路径定位到 108→106',
  !!cyc && cyc.items.some((i) => i.kind === 'path' &&
    JSON.stringify(i.path) === JSON.stringify(['TG1:108', 'TG1:106'])))
check('环依据引用关联项与关系 id',
  !!cyc && cyc.items.some((i) => i.kind === 'link' && i.linkId === 'l4') &&
  cyc.items.some((i) => i.kind === 'path' && i.relationIds.length > 0))
check('检出区间无交集矛盾', !!inv)
check('区间矛盾引用两条测年证据 id',
  !!inv && inv.items.some((i) => i.kind === 'dating' && i.datingId === 'd1') &&
  inv.items.some((i) => i.kind === 'dating' && i.datingId === 'd3'))
check('矛盾 id 可复现（同数据同 id）',
  JSON.stringify(evaluateChronology(ev(H2)).contradictions.map((c) => c.id)) ===
  JSON.stringify(r2.contradictions.map((c) => c.id)))

console.log('5. 后来补入的新测年证据自动生效')
const before = evaluateChronology(ev(H1))
const d5 = dat('d5', 'TG1:106', 2900, null) // 新证据：TG1:106 不早于 2900 BP
const after = evaluateChronology(ev(H1, [...dating, d5]))
check('补入前甲方案自洽', before.ok)
check('补入后出现区间矛盾（2900 晚于继承的 3100 TAQ）',
  after.contradictions.some((c) => c.type === 'interval' &&
    c.items.some((i) => i.kind === 'dating' && i.datingId === 'd5')))

console.log('6. 证据只被引用：改证据即改结论，无漂移副本')
const modified = dating.map((d) => (d.id === 'd1' ? { ...d, bpEarly: 3350 } : d))
const r2mod = evaluateChronology(ev(H2, modified))
const invMod = r2mod.contradictions.find((c) => c.type === 'interval')
check('修改 d1 后矛盾中的下界同步变为 3350',
  !!invMod && invMod.items.some((i) => i.kind === 'dating' && i.datingId === 'd1' && i.bp === 3350))

console.log('7. 假设删除：底稿与证据原样保留')
const afterDelete = evaluateChronology(ev([]))
check('撤掉假设后矛盾消失', afterDelete.contradictions.length === 0)
check('测年证据仍在（区间仍在）',
  afterDelete.intervals.get('TG1:105')!.lo === -3300 &&
  afterDelete.intervals.get('TG2:105')!.lo === -3600)

console.log('8. 逐项比较两个假设')
const diff = compareHypotheses(H1, H2, r1, r2, loci)
check('关联项：甲独有 2 项、乙独有 2 项、共有 0 项',
  diff.onlyA.length === 2 && diff.onlyB.length === 2 && diff.both.length === 0)
check('阶段划分逐项列出且有差异行',
  diff.phaseRows.length === loci.length &&
  diff.phaseRows.some((r) => r.locusId === 'TG1:105' && r.changed))
check('双方矛盾分别列出',
  diff.contradictionsA.length === 0 && diff.contradictionsB.length === 2)

console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
process.exit(failures ? 1 : 0)
