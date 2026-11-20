# 企业级知识库设计与检索质量工程

以 Atlas 项目入场为贯穿案例，学习如何把扫描制度、办理表格、Wiki 和受限项目文档变成可检索、可追溯的知识。课程覆盖资料接入、识别与清洗、证据切片、入库发布、检索与问答，以及权限、版本和运营。

正文从业务约束推导设计方案，给出短代码和验收案例。配套项目使用合成资料，便于单独运行。

[先读课程导读](course-introduction.md)，了解案例背景、适合的读者和每阶段的学习成果。

## 已收录课程

| 期数 | 主题 | 配套材料 |
| --- | --- | --- |
| 01 | [企业知识库如何判定一条搜索结果可以交付？](lessons/enterprise-knowledge-base-ep01.md) | [源码、合成语料与回放](projects/week-01/README.md) |
| 02 | [企业资料散在各处，怎样收集并接入知识库？](lessons/enterprise-knowledge-base-ep02.md) | 正文含核心 TypeScript 示例 |
| 03 | [从 PDF、图片、表格和办公文档中得到可信内容](lessons/enterprise-knowledge-base-ep03.md) | 正文含核心 TypeScript 示例 |
| 04 | [内容已经读出来，怎样切成能搜索和引用的证据？](lessons/enterprise-knowledge-base-ep04.md) | 正文含核心 TypeScript 示例 |
| 05 | [原件、切片和索引各存哪里，什么时候算入库成功？](lessons/enterprise-knowledge-base-ep05.md) | 正文含核心 TypeScript 示例 |

## 首季路线

完整的 16 期目录、业务流程与验收标准见[课程大纲](enterprise-knowledge-base-series-outline.md)。

| 阶段 | 期数 | 学习重点 |
| --- | --- | --- |
| 资料与版本 | 01–05 | 检索契约、资料接入、OCR 与清洗、证据切片、入库发布 |
| 索引与检索 | 06–09 | BM25、向量索引、混合召回、重排 |
| 权限与治理 | 10–12 | 身份与资源权限、更新与删除、制度冲突 |
| 交付与迭代 | 13–16 | 引用问答、质量回归、索引切换、运营 |

## 仓库目录

- [系列大纲](enterprise-knowledge-base-series-outline.md)记录课程路线与技术选型。
- [课程正文](lessons/)保留设计依据、核心代码和边界推演。
- [配套项目](projects/)包含可运行源码、合成资料及回放脚本。

课程结构参考 [Agent 工程深度学习](https://github.com/ashuaze/agent-engineering)。
