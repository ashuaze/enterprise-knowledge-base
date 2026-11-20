import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { styleText } from 'node:util';
import { buildApp } from '../app/api.ts';
import { loadCorpus, type Subject } from '../app/corpus.ts';
import {
  appliesTo, canRead, evidenceRef, FIXTURE_TODAY, isPolicyDate, isPrincipalFixture, scopeFor,
  search, versionAvailability, type Hit, type PrincipalFixture, type Scope,
} from '../app/search.ts';

interface Case {
  case_id: string;
  query: string;
  principal_fixture: PrincipalFixture;
  as_of?: string;
  subject?: Subject;
  evidence_refs: string[];
  acceptable_outcome: 'evidence' | 'empty';
  tags: string[];
}

const K = 10;
const corpus = loadCorpus();
const cases: Case[] = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const refs = new Set(corpus.flatMap((version) => version.evidence.map((p) => evidenceRef(version, p))));
assert.equal(cases.length, new Set(cases.map((item) => item.case_id)).size, 'Duplicate case ID');
assert.equal(corpus.length, new Set(corpus.map((version) => version.version_id)).size, 'Duplicate version ID');

function measure(hits: Hit[], item: Case, scope: Scope) {
  const page = hits.slice(0, K);
  const matches = page.map((hit, index) => item.evidence_refs.includes(hit.ref) ? index + 1 : 0)
    .filter((rank) => rank > 0);
  const firstRank = matches[0] ?? null;
  return {
    firstRank,
    recall: item.evidence_refs.length ? matches.length / item.evidence_refs.length : null,
    empty: page.length === 0,
    invalid: page.filter(({ version }) => versionAvailability(version, scope) !== 'valid').length,
    unauthorized: page.filter(({ version }) => !canRead(version, scope)).length,
    inapplicable: page.filter(({ version }) => !appliesTo(version, scope)).length,
  };
}

function run(item: Case) {
  assert(isPrincipalFixture(item.principal_fixture), item.case_id);
  assert(item.as_of === undefined || isPolicyDate(item.as_of), item.case_id);
  assert(item.evidence_refs.every((ref) => refs.has(ref)), `Unknown evidence in ${item.case_id}`);
  assert.equal(item.acceptable_outcome === 'empty', item.evidence_refs.length === 0, item.case_id);
  const scope = scopeFor(item.principal_fixture, item.as_of, item.subject);
  const original = search(corpus, item.query, scope, { omitExpiryForReplay: true });
  const corrected = search(corpus, item.query, scope);
  return {
    item, scope, original, corrected,
    a: measure(original.hits, item, scope),
    b: measure(corrected.hits, item, scope),
  };
}

const runs = cases.map(run);
const main = runs.find(({ item }) => item.case_id === 'it-01')!;
assert.equal(main.original.hits[0]?.ref, 'mfa-rebind-v1#steps');
assert.equal(main.corrected.hits[0]?.ref, 'mfa-rebind-v2#steps');
assert(main.corrected.rejectedExpired.includes('mfa-rebind-v1'));
assert(main.original.hits.some((hit) => hit.ref === 'mfa-rebind-v2#steps'));
assert(runs.every(({ b }) => b.invalid === 0 && b.unauthorized === 0 && b.inapplicable === 0));

function detail(result: ReturnType<typeof run>) {
  const { item, scope, original, corrected } = result;
  const displayHits = (hits: Hit[]) => hits.slice(0, K).map((hit) => ({
    ref: hit.ref, score: hit.score, validity: versionAvailability(hit.version, scope),
  }));
  return {
    case_id: item.case_id, query: item.query, principal_fixture: item.principal_fixture,
    subject: scope.subject, as_of: scope.asOf, query_terms: original.queryTerms,
    expected: item.evidence_refs,
    A: displayHits(original.hits),
    B: displayHits(corrected.hits),
    expired_versions_excluded_in_B: corrected.rejectedExpired,
  };
}

async function verifyHttp() {
  const app = buildApp(corpus);
  try {
    function get(path: string, token?: PrincipalFixture) {
      return app.inject({
        method: 'GET', url: path,
        headers: token ? { authorization: `Bearer demo-${token}` } : {},
      });
    }

    let routeChecks = 0;
    for (const result of runs) {
      const { item, scope, corrected } = result;
      const params = new URLSearchParams({ q: item.query });
      if (item.as_of) params.set('as_of', item.as_of);
      if (item.subject) params.set('subject', item.subject);
      const reply = await get(`/search?${params}`, item.principal_fixture);
      assert.equal(reply.statusCode, 200, item.case_id);
      const body = reply.json();
      assert.equal(body.as_of, scope.asOf, item.case_id);
      assert.equal(body.subject, scope.subject, item.case_id);
      assert.deepEqual(body.results.map((hit: { evidence_ref: string }) => hit.evidence_ref),
        corrected.hits.slice(0, K).map((hit) => hit.ref), item.case_id);
      routeChecks += 1;
    }

    const response = await get('/search?' + new URLSearchParams({ q: main.item.query, limit: '1' }), 'employee');
    const [result] = response.json().results;
    assert.equal(response.json().results.length, 1);
    const [sourcePath, anchor] = result.source_url.split('#');
    const source = await get(sourcePath, 'employee');
    assert.equal(source.statusCode, 200);
    assert.equal(source.headers['cache-control'], 'no-store');
    assert(source.body.includes(`id="${anchor}"`));
    assert(source.body.includes(result.snippet));
    routeChecks += 1;

    const historical = await get('/sources/mfa-rebind-v1?as_of=2026-09-30', 'employee');
    assert.equal(historical.statusCode, 200);
    assert(historical.body.includes('MFA 重置'));
    assert.equal((await get('/sources/mfa-rebind-v1?as_of=2026-10-01', 'employee')).statusCode, 404);
    routeChecks += 2;

    const notFound = await get('/sources/unknown', 'employee');
    const denied = await get('/sources/mfa-admin-v1?subject=employee&as_of=2026-09-30', 'employee');
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.body, notFound.body);
    assert.equal((await get('/sources/mfa-admin-v1', 'it-admin')).statusCode, 200);
    routeChecks += 3;

    assert.equal((await get('/search?q=KB-4032')).statusCode, 401);
    assert.equal((await get('/search?q=KB-4032&as_of=2026-02-30', 'employee')).statusCode, 400);
    assert.equal((await get('/search?q=KB-4032&as_of=2026-12-01', 'employee')).statusCode, 400);
    assert.equal((await get('/search?q=KB-4032&principal=it-admin', 'employee')).statusCode, 400);
    return routeChecks + 4;
  } finally {
    await app.close();
  }
}

function aggregate(set: typeof runs, key: 'a' | 'b') {
  const positive = set.filter(({ item }) => item.acceptable_outcome === 'evidence');
  const empty = set.filter(({ item }) => item.acceptable_outcome === 'empty');
  const fraction = (value: number, total: number) => total ? `${value}/${total}` : '—';
  const mean = (sum: number) => positive.length ? (sum / positive.length).toFixed(3) : '—';
  const add = (field: 'invalid' | 'unauthorized' | 'inapplicable') =>
    set.reduce((sum, row) => sum + row[key][field], 0);
  return {
    top1: fraction(positive.filter((row) => row[key].firstRank === 1).length, positive.length),
    recall: mean(positive.reduce((sum, row) => sum + row[key].recall!, 0)),
    mrr: mean(positive.reduce((sum, row) => sum + (row[key].firstRank ? 1 / row[key].firstRank : 0), 0)),
    empty: fraction(empty.filter((row) => row[key].empty).length, empty.length),
    invalid: add('invalid'),
    unauthorized: add('unauthorized'),
    inapplicable: add('inapplicable'),
  };
}

function printReport(routeChecks: number) {
  const a = aggregate(runs, 'a');
  const b = aggregate(runs, 'b');
  const entities = new Set(corpus.map((v) => v.document_id)).size;
  const tags = new Set(cases.flatMap((item) => item.tags));
  const formatHit = (hit?: Hit) => hit ? `\`${hit.ref}\` (${hit.score})` : '—';

  console.log(`# EP01 检索对照报告

运行环境 ${process.platform} / ${process.arch}，Node.js ${process.version}。冻结查询日 ${FIXTURE_TODAY}（上海自然日）。语料包含 ${entities} 个文档实体、${corpus.length} 个版本、${refs.size} 个证据段落。评测包含 ${cases.length} 个场景。

A 在当前和历史搜索中都漏掉失效日期上界。B 按有效期上界过滤后使用同一套打分。两组均检查读取权限、适用人群、发布状态和生效日期。实验通过同一个内存检索函数运行。HTTP 用 Fastify inject 验证 B 的正常请求路径和来源页，共 ${routeChecks} 项断言场景通过。

## 总体

| 指标 | A | B |
| --- | ---: | ---: |`);
  for (const [label, key] of [
    ['首条证据命中', 'top1'], [`证据 Recall@${K}`, 'recall'], [`MRR@${K}`, 'mrr'],
    ['预期空页的正确返回', 'empty'], ['日期无效或未发布的返回项', 'invalid'],
    ['越权返回项', 'unauthorized'], ['适用人群不符的返回项', 'inapplicable'],
  ] as const) console.log(`| ${label} | ${a[key]} | ${b[key]} |`);

  console.log(`
Recall 与 MRR 对有标注证据的查询做宏平均。Recall 是返回的已标注证据数除以该查询的标注总数。MRR 取首个正确证据在前 ${K} 条中的倒数排名，未命中计零。预期空页的案例单列。违规项按每个场景的返回项计数。

## 按标签

| 标签 | 场景数 | 首条证据 A → B | MRR@${K} A → B | 正确空页 A → B | 日期无效项 A → B |
| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const tag of tags) {
    const rows = runs.filter(({ item }) => item.tags.includes(tag));
    const x = aggregate(rows, 'a');
    const y = aggregate(rows, 'b');
    console.log(`| ${tag} | ${rows.length} | ${x.top1} → ${y.top1} | ${x.mrr} → ${y.mrr} | ${x.empty} → ${y.empty} | ${x.invalid} → ${y.invalid} |`);
  }
  console.log(`
单个场景可拥有多个标签，标签行不可相加。

## 逐条记录

首条候选括号内是原始打分。排名列记录首条正确证据在 Top ${K} 中的位置。

| 场景 | A 首条候选 | B 首条候选 | 正确证据排名 A → B |
| --- | --- | --- | --- |`);
  for (const { item, original, corrected, a, b } of runs) {
    console.log(`| ${item.case_id} | ${formatHit(original.hits[0])} | ${formatHit(corrected.hits[0])} | ${a.firstRank ?? '—'} → ${b.firstRank ?? '—'} |`);
  }

  console.log(`
## 坏例记录

- \`it-01\`。普通员工在 2026-11-18 查询换机后的 MFA 重新绑定。旧指南得 ${main.original.hits[0]?.score} 分，现行步骤得 ${main.corrected.hits[0]?.score} 分。现行证据在 A 里已召回，A 的失效版进入候选后，正常的词法权重把它放在更前面。B 排除失效版，两份文档的内容和评分函数保持一致。
- \`it-02\`。同一查询指定 2026-09-30，旧版是当日有效流程，B 仍返回旧版。
- \`it-03\`。同一查询指定切换日 2026-10-01，旧版已失效。A 同样排旧版第一，B 返回现行证据。
- \`it-17\` 和 \`it-18\`。原文段落存在，手写词表与这两条口语查询没有词项交集，两组均漏召回。这组样本留给词法分析与语义召回的后续实验。

## 决策与代价

当前搜索采用发布状态与生效区间硬过滤，历史搜索通过显式日期使用同一规则。维护成本主要是给每个文档版本填写并核对业务生效日与失效日，并在切换日回归。样本较小时可在内存中保留旧版并逐版本检查。此实验未量化延迟，也未测量外部索引、缓存或权限变更。20 条场景是开发回归集，独立留出集将在完成更多语料后建立。`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  printReport(await verifyHttp());
} else if (args.length === 2 && args[0] === '--case') {
  const match = runs.find(({ item }) => item.case_id === args[1]);
  if (!match) throw new Error(`Unknown case ID: ${args[1]}`);
  console.log(JSON.stringify(detail(match), null, 2));
} else {
  console.error(styleText('red', 'Usage: npm run replay -- [--case CASE_ID]'));
  process.exitCode = 2;
}
