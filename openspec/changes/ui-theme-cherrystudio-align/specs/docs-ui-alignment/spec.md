## ADDED Requirements

### Requirement: All requirement docs reference UI design spec
每个包含前端 UI 描述的需求文档 SHALL 在文档头部或 UI 相关章节开头添加对 `docs/design/12_UI设计规范_CherryStudio风格对齐.md` 的引用声明，明确所有前端实现须遵循该规范。

#### Scenario: 04 模块需求文档包含规范引用
- **WHEN** 开发者阅读 `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` 的 §2 Cherry Web 前端章节
- **THEN** 该章节开头包含一行引用声明，指向 UI 设计规范文档

#### Scenario: 03 PRD 文档包含规范引用
- **WHEN** 开发者阅读 `docs/requirements/03_产品需求_PRD.md` 的 §7 页面需求章节
- **THEN** 该章节开头包含一行引用声明，指向 UI 设计规范文档

### Requirement: Chat UI descriptions use token references
`04_模块需求` 中 Chat 页面的 UI 视觉描述 SHALL 使用 token 名称替代硬编码的视觉描述词。

#### Scenario: 回答状态 UI 表现使用 token 描述
- **WHEN** 开发者查看 Chat 回答状态机的 UI 表现列
- **THEN** `pending_retrieval` 状态描述包含动画 token 引用（如 `--color-primary` 色调的加载动画），`failed` 状态描述使用 `--color-error` 相关 token

#### Scenario: answer_source UI 标注使用 token 描述
- **WHEN** 开发者查看 `model_knowledge` 的 UI 标注描述
- **THEN** "醒目标注"被具体化为使用 `--color-warning` 背景 + `--color-warning-soft` 边框的警告横幅

### Requirement: Citation card visual spec uses tokens
引用卡片的视觉区分描述 SHALL 使用具体 token 名称替代模糊描述（如"淡黄色背景"→ `--color-warning-soft` 背景）。

#### Scenario: 过期引用卡片视觉描述
- **WHEN** 开发者查看引用版本提示的视觉区分要求
- **THEN** 描述为"使用 `--color-warning-soft` 背景、`--color-border-strong` 虚线边框"，不再使用"淡黄色"等模糊色彩词

#### Scenario: INFERRED/AMBIGUOUS 关系标注
- **WHEN** 开发者查看引用关系置信度标注要求
- **THEN** 描述使用 `--color-warning` / `--color-status-degraded-text` 等具体 token

### Requirement: Milestone deliverables include UI compliance
`16_实施路线图与里程碑.md` 的 Phase 1 交付物 SHALL 在 Cherry Web 和 Admin 行中明确包含 UI 风格合规要求。

#### Scenario: Phase 1 交付物表提及 UI 规范
- **WHEN** 开发者查看 Phase 1 §2.2 交付物表的 Cherry Web 行
- **THEN** 交付物描述包含"遵循 UI 设计规范（`docs/design/12_UI设计规范`）"

### Requirement: Scope lock references UI spec
`25_Phase1_Scope_Lock.md` SHALL 在 §2 "Phase 1 做什么" 表格中添加 UI 视觉规范合规行。

#### Scenario: Scope lock 包含 UI 行
- **WHEN** 开发者查看 Phase 1 scope lock 的功能列表
- **THEN** 存在一行"UI 视觉规范合规"，交付标准为"所有前端页面遵循 `docs/design/12_UI设计规范`，使用 CSS token 体系，支持暗色模式"
