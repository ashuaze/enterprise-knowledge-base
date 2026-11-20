# 企业级知识库设计与检索质量工程

## EP01 · 企业知识库如何判定一条搜索结果可以交付？

[正文](../../lessons/enterprise-knowledge-base-ep01.md) · [实测报告](eval/baseline-report.md) · [20 条评测标注](eval/cases.json)

正文可以独立阅读。这份实操包用于复现过期 MFA 指引和 20 条样例查询。TypeScript 和 Fastify 提供搜索与来源页，Markdown 与版本元数据在启动时读入内存。使用 Node.js 22.18 或更新版本。快照在 Linux x64、Node.js 24.22.3 上完成验证。

## 可选实验 · 回放一个坏例

```bash
npm ci
npm run --silent replay -- --case it-01
```

观察同一篇现行指南如何由第 2 位升到第 1 位，以及两组的日期资格。需要查看 API 与来源页时，再启动服务。

## 启动搜索和来源服务

```bash
npm ci
npm start
```

服务监听 `127.0.0.1:3000`。另开终端查询。

```bash
curl -sS -G http://127.0.0.1:3000/search \
  -H 'Authorization: Bearer demo-employee' \
  --data-urlencode 'q=更换手机后怎么重新绑定登录验证（MFA）？' \
  --data-urlencode 'limit=1'
```

默认业务日期为 `2026-11-18`，首条是 `mfa-rebind-v2#steps`。指定 `as_of=2026-09-30` 时，首条是 `mfa-rebind-v1#steps`。切换日 `2026-10-01` 已适用 V2。

来源 URL 使用同一把示例令牌读取，浏览器收到页面后按 `#steps` 定位。

```bash
curl -fsS -H 'Authorization: Bearer demo-employee' \
  'http://127.0.0.1:3000/sources/mfa-rebind-v2?as_of=2026-11-18&subject=employee#steps'
```

### 请求参数

| 参数 | 含义 |
| --- | --- |
| `q` | 必填，搜索词，最大 200 字符 |
| `as_of` | 可选，明确指定查询所指的上海自然日，`YYYY-MM-DD`，上界为固定查询日 |
| `subject` | 可选，问题所指业务对象，`employee` 或 `contractor`，默认取提问者的业务身份 |
| `limit` | 可选，返回段落数，范围 1–10，默认 10 |

示例令牌为 `demo-employee`、`demo-contractor` 和 `demo-it-admin`，用于本地回放合成语料。服务端以请求令牌解析读取身份，`subject` 只改变文档适用范围。有效期上下界都适用于历史搜索。无可见或适用的来源页返回 404。

## 运行回放

无需在另一终端启动服务。回放在内存中对比同一个搜索函数的两种配置，并用 Fastify 的本地请求注入验证正常路由。

```bash
npm run check
npm run --silent replay
npm run --silent replay -- --case it-01
```

将第一条回放命令的输出重定向到文件即可重新生成对照报告。A 为漏检失效日的对照组，B 为带完整有效期判断的服务实现。报告展示失效日期过滤如何改变当前及切换日的首条结果，口语查不到和背景说明排在操作步骤之前都保留为后续坏例。

## 文件

| 路径 | 内容 |
| --- | --- |
| `app/corpus.ts` | 读取受控 Markdown 节点与显式原文锚点 |
| `app/search.ts` | 访问权限、适用范围、版本有效期与最小词法打分 |
| `app/api.ts`、`app/server.ts` | Fastify 路由和本地启动入口 |
| `fixtures/versions.json` | 19 个文档实体和 22 个版本的发布、来源与权限信息 |
| `fixtures/markdown/` | 合成原始文档，使用每节一个段落和显式锚点的格式 |
| `eval/replay.ts` | 分组评测、坏例追踪及 HTTP 契约核验 |
