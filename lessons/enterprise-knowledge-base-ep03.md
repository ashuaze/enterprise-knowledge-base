# 03｜从 PDF、图片、表格和办公文档中得到可信内容

**企业级知识库设计与检索质量工程 · 第一阶段**  
阅读约 25–35 分钟 · 可选练习约 10 分钟 · Atlas 资料与文中识别结果均为合成示例

第 02 期的行政规定已经登记为一个不可变的原件版本。处理程序提取出了第 1–3 页的正文，第 4 页却只提取到页脚的「行政服务」。门禁办理矩阵恰好在这一页。若以「每页有文字」为成功条件，文件可能照常入库，后面的检索也就无从找到办理人。

本期从文件原件得到可审阅的结构化内容。读完可以**按页选择提取策略、保存块级来源定位、写出清洗规则，并定义何时可以交给切片处理**。

## 一、格式决定默认路线，质量决定是否换路线

PDF 文件可以同时包含可选中的文字、整页扫描图和残缺的隐藏文本层。对 Atlas 的入场规定，先抽取原生文字并检查版面，再按页处理缺失部分。把原件保留为只读版本，每次处理记录解析器和规则版本，方便在同一输入上比较结果。

| 资料 | 起步提取方案 | 需要复核的迹象 |
| --- | --- | --- |
| 数字 PDF | 提取文字和位置，检查阅读顺序；单独识别表格和图表区域 | 双栏混排、字形映射异常、文字与页面展示不符 |
| 扫描或混合 PDF | 对无可用文字的页或区域先渲染，再做 OCR 与版面分析 | 旋转、模糊、边缘裁切、只有页脚的隐藏文本 |
| DOCX、PPTX | 优先读标题、列表、表格及幻灯片元素；对内嵌图片按需识别 | 备注与正文权限不同、页脚重复、关键内容嵌在图中 |
| XLSX、CSV | 读取工作表和原始单元格，保留列名、单位、空值和业务键 | 合并表头，显示格式影响日期，公式缓存与表内值不同步 |
| Markdown、Wiki HTML | 解析标题、列表、代码块与表格，按结构剥离导航与模板 | 内容藏在展开块中，模板与正文同名，源站更新后锚点变动 |

这里的 OCR 是把图像上的字转成文本，**版面分析**还要知道哪些文字属于同一段、哪个表头约束哪一列，以及阅读顺序是什么。可用工具的输出形态有差异。例如，文档版面服务可以给出行、表单元格和位置等元素，选型时应拿本组织常见的模糊扫描件、双栏说明和跨页表格试一遍。 [Microsoft Document Intelligence 版面分析](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout)

## 二、保留一层能回到原件的结果

把提取结果全部拼成一个字符串，会丢失定位、表头关系和失败页信息。规范化产物使用块作为基本单位。一页可以有多个有序块，表格还需要行列、跨度和关联表头。

下面是第 4 页中的一个**已复核单元格**示例。为便于不同尺寸下定位，坐标在渲染后校正方向的页面上按宽高归一化，左上角为原点。渲染配置与坐标变换信息随页面产物保存，查看器可据此回到原页。

```json
{
  "documentVersionId": "atlas-ingress-v3",
  "parseRunId": "parse-002",
  "blockId": "p4-table1-r2c2",
  "kind": "table_cell",
  "text": "项目负责人",
  "source": { "page": 4, "bbox": [0.48, 0.34, 0.20, 0.04] },
  "table": { "id": "badge-routing", "row": 2, "column": 2, "header": "办理人" },
  "extraction": "ocr_layout",
  "review": "verified"
}
```

字段各自回答一个问题。`documentVersionId` 找到原始版本，`parseRunId` 说明来自哪次处理，`blockId` 在该产物内定位一个块，`source` 找回原页和位置，`table` 保留语义结构。还可以增加 OCR 引擎版本、原始识别值、人工校正值及变更记录，为重新处理与对照提供依据。

第 4 页重跑以后，新的块 ID 可能变化。已发布引用应固定到能复核的版本和证据位置；重解析的结果作为新的处理产物，经过校验后再切换。第 04 期会用原文定位作为切片前后的共同参照。

## 三、核心逻辑是判断这页能否使用

这份制度的第 4 页承担门禁办理规则，业务要求至少能定位「区域」「办理人」和「适用对象」。**需要哪些字段由来源契约、文档模板或人工确认决定。** 页面识别程序负责说明它实际找到了什么。用字符数、平均置信度排序可帮助抽检，发布还要检查关键字段和区域是否齐全。

下面的 TypeScript 函数用于选路线。输入是各次抽取的质量检查摘要。缺失的值用 `null` 或缺键表示。`requireAgreement` 适用于可得到两种提取结果、且要求两路核对关键字段的页面。provider 的超时与网络重试由任务层处理。

```ts
type Inspection = {
  readable: boolean;
  expectedRegionsPresent: boolean;
  fields: Readonly<Record<string, string | null>>;
};

type PagePolicy = {
  requiredFields: readonly string[];
  requireAgreement: boolean;
};

type PageDecision =
  | "use_native"
  | "run_ocr"
  | "use_ocr"
  | "review_missing_content"
  | "review_conflicting_values";

function decidePage(
  native: Inspection | undefined,
  ocr: Inspection | undefined,
  policy: PagePolicy,
): PageDecision {
  const complete = (result: Inspection | undefined) =>
    result !== undefined && result.readable && result.expectedRegionsPresent
    && policy.requiredFields.every((key) => Boolean(result.fields[key]?.trim()));

  const nativeReady = complete(native);
  if (nativeReady && !policy.requireAgreement && ocr === undefined) return "use_native";
  if (ocr === undefined) return "run_ocr";

  const ocrReady = complete(ocr);
  const conflicting = policy.requiredFields.some((key) => {
    const left = native?.fields[key]?.trim();
    const right = ocr.fields[key]?.trim();
    return Boolean(left && right && left !== right);
  });
  if (conflicting) return "review_conflicting_values";
  if (policy.requireAgreement && (!nativeReady || !ocrReady)) {
    return "review_missing_content";
  }
  if (nativeReady) return "use_native";
  if (ocrReady) return "use_ocr";
  return "review_missing_content";
}
```

按这个函数看三种输入。第 2 页原生抽取齐全，直接选择原生结果。第 4 页原生层只有页脚，触发 OCR，补齐区域和负责人后采用 OCR。另一次识别把「5 个工作日」读成「S 个工作日」，若原生抽取已有可比值则进入冲突复核。扫描页只能得到 OCR 结果时，规则应额外检查关键数字的格式或要求人工核对。这类业务检查应保留原值和复核状态，再生成质量摘要。

## 四、清洗前后应该能对账

清洗是一组有条件的变换。原始识别结果、清洗输出和校正记录都需要可以追溯。对于日期、金额、单位、否定词和办理条件，优先保留文字与来源，并在存在疑点时要求复核。

| 变换 | 可以自动做的条件 | 保留什么 |
| --- | --- | --- |
| 去除页眉、页脚或导航 | 已有可信角色标记，或能同时验证重复内容和页边位置 | 原块、被排除的原因和规则版本 |
| 合并段内折行 | 同一文本块的版面和阅读顺序一致 | 合并前行的原页范围 |
| 还原表头与读取顺序 | 已识别列区间、表头关联和续页关系 | 表头与数据行各自的位置 |
| 修改关键数字或日期 | 原件或来源方能验证，且有复核记录 | 原始值、校正值、复核人或校验规则及时间 |

以「仅限项目负责人申请」为例。若一条通用清洗规则去掉所有页边小字，可能把适用条件当成模板页脚。选一组既含页脚又含关键脚注的材料作验收，观察去除噪声的同时，业务条件是否还与对应条目关联。

## 五、关键页失败时怎么恢复

处理任务可以按页记录 `native_ready`、`ocr_ready`、`needs_review` 和失败原因；文档层对必需页做汇总。对 Atlas 制度，第 4 页是发布必需内容。发现缺失，就把文件保留在待复核，允许重新识别该页。重跑时用同一原件版本、明确的页号和解析配置记录新产物，校验其他页的原件绑定一致，再组装一次完整结果。第 05 期会在发布阶段校验处理产物和索引代次是否成套。

| 方案 | 适用约束 | 要验证什么 |
| --- | --- | --- |
| 本地原生解析与按页 OCR | 接入类型有限，文档需要在内部环境处理 | 常见格式覆盖、页级耗时、坐标精度和复杂表格缺口 |
| 托管版面分析 | 授权允许发送所需资料，复杂版面较多 | 数据处理边界、单页成本、位置字段与表结构的实际效果 |
| 人工复核 | 高影响规则、低置信度字段或工具冲突 | 能否打开原页、只处理有疑问的区域，并保留校正记录 |

## 六、验收和短练习

先用人工标注检查六类页：普通数字页、纯扫描、扫描和文本混合、双栏、跨页表格，以及带关键脚注的页。评估关键字段是否正确、阅读顺序是否合理、引用能否定位，再观察逐页处理耗时。平均分再高，核心门禁规则缺页也要显式待复核。

**可选练习。** 用代码给第 4 页传入「原生少办理人、OCR 补齐」与「两种结果的办理人不同」两组输入，预测分别返回什么。再模拟要求双路确认、OCR 漏掉必需区域时的结果。用源页、期望字段和动作写成三条验收记录。

下一期会把这份已经能回到原页的内容交给切片。制作门禁片段时，读者还需要看到「区域」「办理人」和「适用条件」是怎样绑定在一起的。
