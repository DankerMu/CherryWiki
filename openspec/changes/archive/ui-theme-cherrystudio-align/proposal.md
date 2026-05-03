## Why

CherryWiki 前端当前使用硬编码色值的朴素 CSS，主色调为蓝色 (#2563eb)，无暗色模式支持，与 CherryStudio 的翡翠绿 (#00b96b) 设计语言严重脱节。Chat 和 Wiki 页面尚为空壳（Phase 1 待实现），如果先建立主题 token 体系再开发新页面，可避免后续返工。

## What Changes

- 新建 CSS custom properties (design tokens) 体系，对齐 CherryStudio `external/cherry-studio/src/renderer/src/assets/styles/color.css` 的设计语言
- 主色调从蓝色 (#2563eb) 切换为 CherryStudio 翡翠绿 (#00b96b)
- 将 `apps/web/src/styles.css` 中所有硬编码色值迁移为 `var()` 引用
- 新增暗色/亮色模式支持（`data-theme` 属性 + `prefers-color-scheme` 自动检测）
- 新增主题化滚动条样式（对齐 CherryStudio scrollbar.css）
- 在 `index.html` 中添加主题检测脚本实现自动暗色模式
- 新建 UI 设计规范文档，指导后续 Phase 的前端开发对齐
- 更新现有需求/项目文档中的 UI 描述，统一引用 token 体系，消除硬编码视觉描述（如"淡黄色背景"→ token 引用）

## Capabilities

### New Capabilities

- `ui-theme-tokens`: CSS custom properties 设计 token 体系（颜色、阴影、圆角、字体、过渡、滚动条），支持亮色/暗色双模式
- `ui-design-guide`: UI 设计规范文档，定义后续 Phase 前端开发的视觉标准和 token 使用规范
- `docs-ui-alignment`: 现有需求/项目文档中 UI 描述的 token 化对齐，确保后续开发阶段直接引用设计规范

### Modified Capabilities

（无已有 spec 需要修改）

## Impact

- **前端代码**: `apps/web/src/styles.css` 全量色值迁移，`apps/web/index.html` 新增脚本
- **新增文件**: `apps/web/src/theme.css`, `docs/design/12_UI设计规范_CherryStudio风格对齐.md`
- **需求文档更新**: `03_产品需求_PRD.md`、`04_模块需求_CherryWeb_Chat_Admin.md`、`16_实施路线图与里程碑.md`、`25_Phase1_Scope_Lock.md`
- **依赖**: 无新依赖，纯 CSS custom properties
- **视觉变化**: 主色调从蓝色变为绿色，Login/Admin 页面色彩更新，支持系统级暗色模式
- **后续影响**: Chat/Wiki/工作台等 Phase 1 待实现页面将直接使用新 token 体系，开发者依据更新后的需求文档直接按 token 实现
