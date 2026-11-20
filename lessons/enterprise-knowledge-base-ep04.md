# 04｜内容已经读出来，怎样切成能搜索和引用的证据？

**企业级知识库设计与检索质量工程 · 第一阶段**  
阅读约 25–30 分钟 · 可选练习约 10 分钟 · Atlas 资料均为合成示例

第 03 期补回了第 4 页的门禁表格。解析结果里有「临时访客区」「项目负责人」和「仅限外包工程师入场首日」。如果直接把长文本按长度切开，候选片段可能只剩「临时访客区｜项目负责人」，把适用条件留给下一段。用户看着这条结果，容易把首日流程用到后续通行上。

本期设计从**原文结构到证据单元，再到检索片段**的转换。读完可以决定表格、步骤和说明各自怎么切，给出稳定的原文引用，并用同一批标注比较两套切片策略。

## 一、先确定哪些信息必须一起出现

切片会决定一次召回能拿到多少上下文。设计起点是「用户拿到这一条结果时，能否正确行动」。

| 原文结构 | 证据单元 | 随片段携带的上下文 |
| --- | --- | --- |
| 办事表格 | 一行或一条业务记录 | 表名、有效表头、行标识、适用条件、单位及相关脚注 |
| 带前置条件的步骤 | 一组有共同前置条件的步骤；必要时为单步建立检索片段 | 步骤所在流程、前置条件、顺序和前后依赖 |
| 代码片段和错误码 | 代码块、错误条目或独立例子 | 版本、语言、发生场景、错误码及适用说明 |
| 政策条款 | 条款和直接约束它的例外 | 文档标题、条款编号、适用人群、业务日期和可读取范围 |

例如，第 3 页的表头「区域／办理人／适用条件」续到第 4 页。解析器应先确认续表关系，切片器再将这些列名带进第 4 页每一行的检索文本。若脚注限制了整个表格，同一个限制应随着对应行一起交付，并保留脚注的来源位置。

业务条件和权限也需要各自保留。索引片段可以继承文档的适用与访问属性；如果一个文档内有不同访问范围的段落，应按可授权的边界切分，并在交付时对扩展内容逐一复核。项目手册中受限的联调操作，应保持独立的证据引用和权限约束。

## 二、把可追溯证据和可替换片段画清楚

第 01 期用 `mfa-rebind-v2#steps` 标注原文步骤。切片调整以后，评测仍然要找到这一版的原文位置。Atlas 表格可以用同一个思路。

| 层次 | 建议关键字段 | 哪种改动会让它变化 |
| --- | --- | --- |
| 原件版本 | `documentVersionId`、原件引用和来源类型 | 源文件修订、审核发布新版本 |
| 原文证据 `EvidenceSpan` | `evidenceId`、来源位置列表、完整业务语义 | 发布新的原文证据或重新解释位置时，需保留映射及审计 |
| 检索片段 `IndexedChunk` | `chunkId`、`evidenceIds`、策略版本、索引代次、检索文本和过滤字段 | 切片策略、Embedding 或索引构建升级时可重建 |

证据位置随来源形态表达。PDF 可用原件版本、页码和块锚点，表格文件可用工作表和单元格范围。第 3 页表头、第 4 页的行以及单独一页的脚注可以拥有多个来源位置。渲染引用时，优先把用户定位到支撑操作的那一行，保留其他位置供展开核对。

新的解析批次可能生成不同的内部块 ID。原已发布引用应固定到可访问的历史证据；如果要求跨解析比较同一证据，使用原件位置或由人工验证的证据映射。这样词法、向量和混合检索仍可以共用一套标注。

## 三、核心代码走读 · 用表头和行共同构造证据

输入是已经通过第 03 期质量检查的结构化表格。`columns` 告诉函数列名及原始位置，`cells` 把该行的值和位置映射到列。必需字段缺失时返回待确认。数值 `0` 和布尔 `false` 可以是有效字段值；可选项来源缺失时标明「原表未提供」。

```ts
type SourceRef = {
  page: number;
  anchor: string;
};

type Column = {
  key: string;
  label: string;
  required: boolean;
  header: SourceRef;
};

type Cell = {
  value: string | number | boolean | null;
  ref: SourceRef;
};

type RowInput = {
  evidenceId: string;
  documentVersionId: string;
  tableTitle: string;
  columns: readonly Column[];
  cells: Readonly<Record<string, Cell | undefined>>;
  notes?: readonly { text: string; ref: SourceRef }[];
};

function describeRow(input: RowInput):
  | { status: "needs_review"; missing: string[] }
  | { status: "ready"; evidenceId: string; documentVersionId: string;
      text: string; refs: SourceRef[] } {
  const values = input.columns.map((column) => {
    const cell = input.cells[column.key];
    const value = cell?.value;
    const present = value !== undefined && value !== null
      && (typeof value !== "string" || value.trim() !== "");
    return { column, cell, present };
  });
  const missing = values
    .filter(({ column, present }) => column.required && !present)
    .map(({ column }) => column.key);
  if (missing.length > 0) return { status: "needs_review", missing };

  const lines = [input.tableTitle];
  const refs: SourceRef[] = [];
  for (const { column, cell, present } of values) {
    lines.push(`${column.label}：${present ? String(cell?.value) : "原表未提供"}`);
    refs.push(column.header);
    if (cell) refs.push(cell.ref);
  }
  for (const note of input.notes ?? []) {
    lines.push(`附注：${note.text}`);
    refs.push(note.ref);
  }
  return {
    status: "ready",
    evidenceId: input.evidenceId,
    documentVersionId: input.documentVersionId,
    text: lines.join("\n"),
    refs,
  };
}
```

给函数一行「临时访客区｜项目负责人｜仅限外包工程师入场首日」。文本会在每个值前写出列名。来源列表同时保留第 3 页表头和第 4 页的值。若去掉必需的适用条件，结果进入待确认，后续处理可以据此阻止该证据片段发布。上游还应确保列键唯一、续表关系正确，以及传入的定位都绑定到同一个原件版本。这段代码展示证据如何组合，切片器可在此基础上按预算组织片段。

多层表头可以提前把「工作日 → 办理人」这样的路径解析成完整列名。附件脚注作为单独的来源引用传入。对于几万行的业务表格，按区域、角色或业务键建立结构化查询，并把每条匹配记录定位回原单元格。文本索引可以负责找到表或表内说明，结构化查询负责精确过滤和聚合。

## 四、比较三种切片方案

| 方案 | 适用情况 | 边界和处理 |
| --- | --- | --- |
| 固定长度 | 起步基线、结构信号弱的长文字 | 在句界附近截断并保留原文位置；跨边界条件和列表需单独验收。 |
| 按结构切片 | 标题、段落、表格和步骤结构可靠 | 标题路径继承到正文，表格按记录组织；超大块再按自然边界分割。 |
| 父子片段 | 短片段利于检索，用户需读完整小节 | 用细粒度子片段召回，按需取父段或邻近证据；扩展后检查预算、适用范围和权限。 |

首版可以按结构切片，再为纯长文本提供长度回退。长度预算应根据回答时所需上下文、索引体积和实际查询验证。重叠适合补正文中的跨句含义，表格的字段关系应在构造证据时明确表达。按结构优先、遇超长元素再分割的思路，也可与文档切片工具的实际实现对照。 [Unstructured Chunking 文档](https://docs.unstructured.io/open-source/core-functionality/chunking)

实际常见的退化是十条结果大多来自同一节的重叠片段。可以在返回结果前按证据 ID 或来源范围去重，并保留每条证据被哪些片段命中的记录。这个信号能帮助第 08 期分析多路召回为什么只有表面上的覆盖提升。

## 五、如何证明改切片有帮助

固定原件、发布版本、身份和查询，分别建立两套片段。对照时把结果归到原文证据，然后统计 Top K 内命中了几个独立证据，并人工复核办理条件、引用定位以及返回内容是否重复。

| 场景 | 要检查的断言 |
| --- | --- |
| 跨页表头和数据行 | 候选能说明项目负责人负责办什么、对谁适用，引用能打开两处来源 |
| 两个标题都叫「办理流程」 | 片段带有各自父标题或业务锚点 |
| 条款和例外在相邻段 | 查询命中操作步骤时能取得对应例外；越过授权范围的段落不可扩展 |
| 相同证据被切成多个片段 | 接收端可以稳定识别原文证据，评测按独立证据去重 |
| 错误码与命令块 | 错误码和经验证的对应操作共同保留，代码换行和缩进得到保留 |

**可选练习。** 把门禁表的表头放到第 3 页、数据行放到第 4 页，运行 `describeRow`。检查输出是否保留两个页的定位，然后挖掉一个必需字段再跑一次。最后手算同一证据有三个重叠片段时，前三条结果的片段数和独立证据数分别是多少。

证据片段现在能独立理解并回到原件。下一期会给它选择存储位置，设计失败重跑和索引可见性，并弄清什么时候能让读者查询它。
