# 05｜原件、切片和索引各存哪里，什么时候算入库成功？

**企业级知识库设计与检索质量工程 · 第一阶段**  
阅读约 25–35 分钟 · 可选练习约 10 分钟 · 案例与代码输入均为合成示例

Atlas 入场规定已上传，第 4 页的门禁条件也复核完了。证据片段正常写入词法索引，向量任务却超时。与此同时，一条重试中的旧任务晚到一步，还想把前一个版本设为可查询。运营同事看到后台写着「处理中」，员工则问「现在搜得到吗？」

本期把入库拆成**持久化、处理、审核、索引和服务发布**。读完可以设计三个独立的状态面，说明一个分阶段任务从哪里重跑，并用代码判断什么时候开放词法或混合检索。

## 一、先回答每份数据由谁负责

入库的每一步都有产物。有些产物承担解释、审计和处理恢复；有些产物面向查询，可以从权威数据重新生成。先把这些职责分开，发生故障时才知道从哪里检查。

| 对象 | 起步存储 | 存在这里的理由 |
| --- | --- | --- |
| 原件与页面产物 | 私有对象存储 | 保留不可变字节、文件校验和、页图及 OCR 结果。复核时可以直接打开原页。 |
| 文档、版本、权限与业务日期 | PostgreSQL | 管理版本与来源、审核、访问和适用规则，便于约束更新与审计。 |
| 规范化证据、处理明细与任务 | 对象存储保存证据产物；数据库保存引用、状态和任务记录 | 体积较大的中间结果可以单独保存，处理配置、异常原因及下一阶段依据在数据库里可查。 |
| 词法与向量索引 | 查询引擎，例如 OpenSearch | 保存检索文本、向量和过滤字段；由确定的证据版本及配置重建。 |

需要在数据库里记录「哪个版本、哪一份已复核证据、哪一套索引代次」之间的绑定。只有这些值匹配，服务才知道两个索引指向同一份内容。所谓**索引代次**，可以理解为一套按指定证据和构建配置生成的读写目标。一个版本可以有多个代次，用于重新切片、重新构建或对照验证。

## 二、让运营能区分三个状态

| 状态面 | 关键字段示例 | 要回答的问题 |
| --- | --- | --- |
| 任务处理 | `stage`、`attempt`、`status`、`lastError` | 原件有没有保存？第 4 页是否待复核？哪个阶段可以重试？ |
| 权威版本 | `documentVersionId`、`approval`、`validFrom`、`validUntil` | 哪一版已审核？哪一天对当前业务对象生效？撤回了吗？ |
| 查询可见性 | `artifactId`、`indexGeneration`、`lexicalReady`、`vectorReady`、`servingMode` | 这版证据是否已进入可查询代次？现在开放哪种检索？ |

例如 V3 已审核，业务生效日是 12 月 1 日，11 月 28 日已经完成两路索引。运营页面可以显示「已通过审核，索引就绪，计划 12 月 1 日生效」。当前查询仍由业务日判定，历史查询也按各版本的日期规则取证。若旧版本已经失效、下一版却还未达到发布门槛，应如实交付证据缺口或等待上线。

允许词法先服务时，需要满足两个条件。第一，关键证据已复核并完整；第二，同一版本的词法索引经过可查询性校验。此时向量失败可独立补跑。某一类知识如果必须采用两路才能满足上线要求，可以为它明确配置混合检索门槛。

## 三、把阶段幂等性和重试边界画清楚

一个小规模的实现可以从持久化任务表开始。上传服务在数据库事务中记录待处理版本及任务，worker 领取任务并保存产物。阶段身份由**版本、阶段和影响输出的配置或输入**共同确定，便于在进程重启后找到已有产物。

| 阶段 | 幂等键示例 | 核对后可以复用的结果 |
| --- | --- | --- |
| 识别第 4 页 | 原件版本、页号、解析配置版本 | 已完成且在当前原件上校验过的页面产物 |
| 生成证据 | 规范化产物 ID、切片策略版本 | 原文证据引用与片段集合 |
| 构建向量投影 | 证据产物 ID、目标代次、模型与配置版本 | 已验证的向量索引投影项 |
| 发布 | 文档、预期版本、目标代次、目录修订号 | 已完成的服务指针变更与记录 |

worker 领取任务后应有租约或超时处理，重复领取时仍要用相同的键对账。一个阶段处理完成，再记录输出引用和状态；后续步骤从已确认的产物开始。对象存储与数据库通常是两个写入边界。若原件已写而目录登记失败，隔离区可先保留对象。恢复程序检查会话和对象引用，再决定继续登记或在保留期后清理。

接入独立队列时，数据库事务可以同时写入业务记录和 Outbox 事件。另一过程负责将事件投递到队列。消费者按事件或任务键幂等处理，防止重复投递造成重复发布。确认队列消息之前，要先确认任务状态和产物已经持久化。 [AWS 事务 Outbox 设计模式](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

索引阶段也可能只完成一部分。批量接口可能为每一项分别返回结果，处理程序须检查失败项并按稳定片段 ID 重试。准备标记就绪前，根据这一次构建的产物清单核对预期证据，并检查查询路径确实能看到它们。索引就绪判断由这一步产生，发布逻辑使用已确认的结果。 [OpenSearch Bulk API](https://docs.opensearch.org/latest/api-reference/document-apis/bulk/)

## 四、核心代码走读 · 决定哪个版本可以交付

这里只展示发布前的一次选择。输入包含权威目录想发布的目标、刚结束的构建目标、审核与证据状态、两路可查询性验证的结果。`verified` 只有在清单对账与读路径检查之后才成立。

```ts
type Target = {
  versionId: string;
  artifactId: string;
  generation: string;
};

type IndexReadiness = {
  target: Target;
  verified: boolean;
};

type Publication = {
  intended: Target;
  completed: Target;
  approval: "approved" | "pending" | "revoked";
  evidenceComplete: boolean;
  requireHybrid: boolean;
  asOf: string;
  validFrom: string;
  validUntil: string | null;
  lexical?: IndexReadiness;
  vector?: IndexReadiness;
};

const sameTarget = (a: Target, b: Target) =>
  a.versionId === b.versionId && a.artifactId === b.artifactId
  && a.generation === b.generation;

function choosePublication(state: Publication):
  | { action: "skip_stale_task" | "skip_expired" }
  | { action: "wait"; reason: "approval_or_evidence" | "lexical" | "vector" }
  | { action: "stage" | "publish"; mode: "lexical" | "hybrid" } {
  if (!sameTarget(state.intended, state.completed)) return { action: "skip_stale_task" };
  if (state.approval !== "approved" || !state.evidenceComplete) {
    return { action: "wait", reason: "approval_or_evidence" };
  }
  if (state.validUntil !== null && state.asOf >= state.validUntil) {
    return { action: "skip_expired" };
  }

  const ready = (report: IndexReadiness | undefined) =>
    report?.verified === true && sameTarget(state.intended, report.target);
  if (!ready(state.lexical)) return { action: "wait", reason: "lexical" };

  const vectorReady = ready(state.vector);
  if (state.requireHybrid && !vectorReady) return { action: "wait", reason: "vector" };
  return {
    action: state.asOf < state.validFrom ? "stage" : "publish",
    mode: vectorReady ? "hybrid" : "lexical",
  };
}
```

业务日期已到 V3 的生效日，词法已验证，向量还在重试，发布策略允许词法先行，输出是 `publish + lexical`。一条 V2 任务晚到时，目标不再匹配，输出是 `skip_stale_task`。如果向量报告指向上一次切片产物，它也无法使当前版本进入混合模式。本例在受控业务时区使用已校验的 YYYY-MM-DD 日期。若还没到生效日，结果是 `stage`，把已验证的候选记录下来。生效日由调度器触发重新判断，届时审核、证据和索引仍须满足发布条件。

最终写入服务指针时，还要在数据库里检查目录修订号是否仍等于读到的值。审核、撤回、预期发布目标或其他影响发布判断的目录状态都应随事务推进修订号。提交前发现修订号已变，重新读取状态并计算。可以用一个带条件的更新表达这一步，以下 SQL 只在代码返回 `action: "publish"` 时执行，参数依次为文档 ID、预期修订号和通过的版本、产物、代次及模式。

```sql
UPDATE serving_document
SET serving_version_id  = $3,
    serving_artifact_id = $4,
    serving_generation  = $5,
    serving_mode        = $6,
    catalog_revision    = catalog_revision + 1
WHERE document_id = $1 AND catalog_revision = $2
RETURNING catalog_revision;
```

这个指针表示已发布的服务版本与查询模式。业务生效区间和授权仍是查询时的独立检查；历史入口如需查询旧版，应走版本及历史索引方案。复核发现旧权限时，即使索引还留有候选也要在交付前排除。第 10 期讨论授权与缓存，第 11 期继续讨论删除和版本同步。

## 五、挑一组会打破发布流程的用例

| 场景 | 预期状态与处理 |
| --- | --- |
| 原件已写但版本事务失败 | 对账识别孤立对象，允许恢复同一会话；达到保留期限并确认无人引用后再清理。 |
| 第 4 页缺必需字段 | 任务可等待复核或单页重跑，发布条件未满足。 |
| 词法批量提交有部分失败 | 只重试失败项；产物清单及读路径确认通过之前，词法报告未就绪。 |
| 词法就绪，向量延后 | 按发布策略先开词法或等待向量；向量补齐后必须与当前目标一致。 |
| 旧任务完成晚于新版本 | 可以记录旧任务结果，服务指针继续指向经过新决策的版本。 |
| 审核通过后、写指针前发生撤回 | 修订号条件失败，重新读取权威状态，旧决定失效。 |
| 待生效版本提前完成索引 | 记录为待生效候选，到期重新判断；现行查询继续检查已发布版本的业务日期。 |

**可选练习。** 向 `choosePublication` 传入 V3 词法已验证、向量缺失的输入，分别切换 `requireHybrid`，然后把刚完成的版本换成 V2。最后模拟数据库修订号变化，解释为什么即使上一次返回 `publish` 也要重新算。

第一阶段已经从收集原件走到可检索的知识版本。第 06 期会拆开词法索引，看标准的分词字段和精确错误码字段如何一起工作。
