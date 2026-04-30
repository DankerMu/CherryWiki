# 12. UI 设计规范：CherryStudio 风格对齐

## 1. 文档目的与适用范围

本文档定义 CherryWiki 所有前端页面的视觉标准、设计 token 使用规则、组件模式、暗色模式约束与 PR 审查要求；所有涉及 `apps/web/` 前端界面、样式、组件、页面布局或可视状态的 PR 都必须遵循本文档，以确保后续开发持续对齐 CherryStudio 的设计语言。

## 2. 设计 Token 参考表

以下 token 全部来源于 `apps/web/src/theme.css`。亮色值来自 `:root`，暗色值来自 `[data-theme='dark']`；暗色主题未覆盖的 token 继承亮色值。

**Primary**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-primary` | `#00b96b` | `#00b96b` | 品牌主色，用于主按钮、关键操作、选中态、强调图标。 |
| `--color-primary-hover` | `#00a862` | `#20c985` | 主色 hover 状态，用于可点击主操作的悬停反馈。 |
| `--color-primary-active` | `#009a5a` | `#009a5a` | 主色 active/pressed 状态，用于按钮按下、当前激活项。 |
| `--color-primary-soft` | `#00b96b99` | `#00b96b99` | 半透明主色，用于柔和高亮、选区背景、轻量强调。 |
| `--color-primary-mute` | `#00b96b33` | `#00b96b33` | 低强度主色背景，用于轻量标签、浅色装饰面。 |
| `--color-primary-focus-ring` | `rgba(0, 185, 107, 0.25)` | `rgba(0, 185, 107, 0.35)` | 焦点环颜色，用于键盘焦点和表单 focus 外发光。 |

**Text**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-text-1` | `rgba(0, 0, 0, 0.88)` | `rgba(255, 255, 245, 0.9)` | 一级文本，标题、正文主内容、强强调信息。 |
| `--color-text-2` | `rgba(0, 0, 0, 0.6)` | `rgba(235, 235, 245, 0.6)` | 二级文本，说明、辅助信息、次要字段。 |
| `--color-text-3` | `rgba(0, 0, 0, 0.38)` | `rgba(235, 235, 245, 0.38)` | 三级文本，弱提示、占位符、禁用或低优先级信息。 |
| `--color-text-4` | `rgba(0, 0, 0, 0.25)` | `rgba(235, 235, 245, 0.25)` | 四级文本，极弱辅助信息、分隔说明、不可用辅助文本。 |

**Background**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-background` | `#ffffff` | `#181818` | 页面全局底色，用于 `body`、主内容背景。 |
| `--color-background-soft` | `rgba(0, 0, 0, 0.04)` | `#222222` | 柔和背景，用于 hover 区域、浅层分组、输入框底色。 |
| `--color-background-mute` | `#f5f5f5` | `#333333` | 静态弱背景，用于列表区域、代码块、次级页面底色。 |
| `--color-background-hover` | `rgba(0, 0, 0, 0.04)` | `rgba(255, 255, 255, 0.06)` | 通用 hover 背景，用于菜单项、表格行、可点击列表项。 |

**Surface**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-surface` | `#ffffff` | `#222222` | 基础容器面，用于卡片、表单面板、工具栏。 |
| `--color-surface-raised` | `#ffffff` | `#2a2a2a` | 抬升容器面，用于弹层、浮动菜单、悬浮面板。 |
| `--color-surface-overlay` | `rgba(255, 255, 255, 0.85)` | `rgba(34, 34, 34, 0.85)` | 半透明覆盖面，用于毛玻璃感头部、遮罩内浮层、固定导航。 |
| `--color-backdrop` | `rgba(0, 0, 0, 0.45)` | `rgba(0, 0, 0, 0.65)` | 模态框、抽屉、全屏预览背后的遮罩。 |
| `--color-login-gradient-1` | `rgba(0, 185, 107, 0.1)` | `rgba(0, 185, 107, 0.08)` | 登录页主色渐变第一层。 |
| `--color-login-gradient-2` | `rgba(0, 185, 107, 0.05)` | `rgba(0, 185, 107, 0.04)` | 登录页主色渐变第二层。 |

**Border**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-border` | `rgba(0, 0, 0, 0.08)` | `rgba(255, 255, 255, 0.1)` | 默认边框，用于输入框、卡片、表格、分隔线。 |
| `--color-border-strong` | `rgba(0, 0, 0, 0.15)` | `rgba(255, 255, 255, 0.18)` | 强边框，用于 focus、选中态、重要分隔或警示边界。 |

**Semantic**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-error` | `#ff4d4f` | `#ff4d4f` | 错误主色，用于错误文本、失败图标、危险操作。 |
| `--color-error-hover` | `#ff7875` | `#ff7875` | 错误 hover 状态，用于危险按钮悬停。 |
| `--color-error-soft` | `#fff2f0` | `rgba(255, 77, 79, 0.16)` | 错误柔和背景，用于错误提示块、表单错误面。 |
| `--color-error-border` | `#ffccc7` | `rgba(255, 77, 79, 0.35)` | 错误边框，用于校验失败输入框、错误提示框。 |
| `--color-success` | `#00b96b` | `#00b96b` | 成功主色，用于成功图标、完成状态、正向反馈。 |
| `--color-success-soft` | `#e6f7ef` | `rgba(0, 185, 107, 0.16)` | 成功柔和背景，用于成功提示块。 |
| `--color-warning` | `#faad14` | `#faad14` | 警告主色，用于风险提示、待处理、注意事项。 |
| `--color-warning-soft` | `#fff7e6` | `rgba(250, 173, 20, 0.16)` | 警告柔和背景，用于警告提示块、引用缺失提示。 |
| `--color-info` | `#1677ff` | `#338cff` | 信息主色，用于信息提示、说明图标。 |
| `--color-link` | `#1677ff` | `#338cff` | 链接色，用于文本链接、可跳转引用。 |

**Status**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-status-healthy-bg` | `#dcfce7` | `rgba(0, 185, 107, 0.18)` | Healthy 状态徽章背景。 |
| `--color-status-healthy-text` | `#166534` | `#7ce2ad` | Healthy 状态徽章文字。 |
| `--color-status-degraded-bg` | `#fef3c7` | `rgba(250, 173, 20, 0.18)` | Degraded 状态徽章背景。 |
| `--color-status-degraded-text` | `#92400e` | `#ffd666` | Degraded 状态徽章文字。 |
| `--color-status-unhealthy-bg` | `#fee2e2` | `rgba(255, 77, 79, 0.18)` | Unhealthy 状态徽章背景。 |
| `--color-status-unhealthy-text` | `#991b1b` | `#ffaaa5` | Unhealthy 状态徽章文字。 |
| `--color-status-neutral-bg` | `#e2e8f0` | `rgba(255, 255, 255, 0.1)` | Neutral 状态徽章背景。 |
| `--color-status-neutral-text` | `#475569` | `rgba(255, 255, 245, 0.72)` | Neutral 状态徽章文字。 |

**Scrollbar**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--color-scrollbar-thumb` | `rgba(0, 0, 0, 0.15)` | `rgba(255, 255, 255, 0.15)` | 滚动条滑块默认颜色。 |
| `--color-scrollbar-thumb-hover` | `rgba(0, 0, 0, 0.25)` | `rgba(255, 255, 255, 0.25)` | 滚动条滑块 hover 颜色。 |
| `--scrollbar-width` | `6px` | `6px` | 垂直滚动条宽度。 |
| `--scrollbar-height` | `6px` | `6px` | 水平滚动条高度。 |
| `--scrollbar-thumb-radius` | `10px` | `10px` | 滚动条滑块圆角。 |

**Shadow**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--shadow-xs` | `0 1px 2px rgba(15, 23, 42, 0.06)` | `0 1px 2px rgba(0, 0, 0, 0.28)` | 最低层级阴影，用于细微浮起或分隔。 |
| `--shadow-sm` | `0 4px 12px rgba(15, 23, 42, 0.08)` | `0 4px 14px rgba(0, 0, 0, 0.32)` | 小卡片、面板默认阴影。 |
| `--shadow-md` | `0 12px 32px rgba(15, 23, 42, 0.1)` | `0 14px 36px rgba(0, 0, 0, 0.36)` | 下拉、浮动面板、较高层级容器。 |
| `--shadow-lg` | `0 24px 70px rgba(15, 23, 42, 0.12)` | `0 24px 70px rgba(0, 0, 0, 0.42)` | 高层级浮层、重要聚焦容器。 |
| `--shadow-modal` | `0 24px 80px rgba(15, 23, 42, 0.28)` | `0 24px 80px rgba(0, 0, 0, 0.58)` | 模态框、确认弹窗、全局阻塞弹层。 |

**Radius**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--radius-xs` | `4px` | `4px` | 小型控件、细粒度标签圆角。 |
| `--radius-sm` | `6px` | `6px` | 输入框、小按钮、表格内元素圆角。 |
| `--radius-md` | `8px` | `8px` | 卡片、面板、默认按钮圆角。 |
| `--radius-lg` | `10px` | `10px` | 模态框、小型浮层、较大面板圆角。 |
| `--radius-xl` | `12px` | `12px` | 大面板、登录容器、强调型容器圆角。 |
| `--radius-full` | `999px` | `999px` | 胶囊按钮、徽章、圆形头像容器。 |

**Typography**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--font-family` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 全站默认无衬线字体栈。 |
| `--font-family-mono` | `"Cascadia Code", "Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace` | `"Cascadia Code", "Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace` | 代码、日志、ID、等宽数据展示字体栈。 |

**Transition**

| Token 名称 | 亮色值 | 暗色值 | 用途说明 |
|---|---|---|---|
| `--transition-fast` | `150ms ease` | `150ms ease` | 快速反馈，用于 hover、focus、按钮状态变化。 |
| `--transition-normal` | `250ms ease` | `250ms ease` | 普通动效，用于弹层、主题切换、页面内状态过渡。 |

## 3. 组件模式指南

| 组件类型 | 状态 / 变体 | Token 使用规范 |
|---|---|---|
| 按钮 | Primary | 背景使用 `--color-primary`，hover 使用 `--color-primary-hover`，active 使用 `--color-primary-active`，文字使用 `--color-background`，focus ring 使用 `--color-primary-focus-ring`，圆角使用 `--radius-sm`，动效使用 `--transition-fast`。 |
| 按钮 | Secondary | 边框使用 `--color-border-strong`，背景使用 `--color-surface`，文字使用 `--color-text-1`；hover 时边框切换为 `--color-text-4`，背景切换为 `--color-background-soft`，圆角使用 `--radius-sm`。 |
| 按钮 | Danger | 背景使用 `--color-error`，hover 使用 `--color-error-hover`，弱危险按钮使用 `--color-error-soft` 背景与 `--color-error` 文本，边框使用 `--color-error-border`。 |
| 输入框 | Default | 背景使用 `--color-surface`，文字使用 `--color-text-1`，placeholder 使用 `--color-text-3`，边框使用 `--color-border-strong`，圆角使用 `--radius-sm`。 |
| 输入框 | Focus | 边框使用 `--color-primary` 或 `--color-border-strong`，外层阴影使用 `0 0 0 3px var(--color-primary-focus-ring)`，禁止写死 focus 色值。 |
| 卡片/面板 | Default | 背景使用 `--color-surface`，边框使用 `--color-border`，圆角使用 `--radius-md`，标题使用 `--color-text-1`，说明使用 `--color-text-2`。 |
| 空状态 | Default | 边框使用 `--color-border-strong` 虚线，背景使用 `--color-surface`，文字使用 `--color-text-3`，圆角使用 `--radius-md`。 |
| 图标按钮 | Default | 尺寸固定 `32px × 32px`，边框使用 `--color-border-strong`，背景使用 `--color-surface`，文字默认使用 `--color-text-2`；hover 时边框切换为 `--color-text-4`，背景切换为 `--color-background-soft`，圆角使用 `--radius-sm`。 |
| 复选框行 | Default | 文字使用 `--color-text-2`，内容间距 `8px`，复选框 input 尺寸固定 `16px × 16px`。 |
| 设置网格 | Default | `settings-grid` 容器仅负责布局；网格子项使用 `--color-border` 边框、`--color-background-soft` 背景与 `--radius-md` 圆角。 |
| 健康卡片 | Default | 边框使用 `--color-border`，背景使用 `--color-surface`，圆角使用 `--radius-md`；左侧状态条固定为 `5px solid`，健康/降级/异常/未配置分别使用 `--color-success`、`--color-warning`、`--color-error`、`--color-text-4`。 |
| 状态徽章 | Healthy | 背景使用 `--color-status-healthy-bg`，文字使用 `--color-status-healthy-text`，圆角使用 `--radius-full`。 |
| 状态徽章 | Degraded | 背景使用 `--color-status-degraded-bg`，文字使用 `--color-status-degraded-text`，用于降级、部分可用、需注意状态。 |
| 状态徽章 | Unhealthy | 背景使用 `--color-status-unhealthy-bg`，文字使用 `--color-status-unhealthy-text`，用于异常、失败、不可用状态。 |
| 状态徽章 | Neutral | 背景使用 `--color-status-neutral-bg`，文字使用 `--color-status-neutral-text`，用于未知、未启用、普通状态。 |
| 模态框 | Default | 遮罩使用 `--color-backdrop`，弹窗面板背景使用 `--color-surface`，阴影使用 `--shadow-modal`，圆角使用 `--radius-md`。 |
| 表格 | Default | 表头背景使用 `--color-background-soft`，单元格文字使用 `--color-text-1` / `--color-text-2` 层级，分隔线使用 `--color-border`，行 hover 使用 `--color-background-soft`。 |
| 侧边栏 | Default | 背景使用 `--color-surface`，分隔线使用 `--color-border`，导航项 hover 使用 `--color-background-hover` 与 `--color-text-1`，选中项使用 `--color-primary-mute` 背景与 `--color-primary-hover` 文本。 |
| 警告/提示 | Error | 背景使用 `--color-error-soft`，边框使用 `--color-error-border`，标题或图标使用 `--color-error`，正文使用 `--color-text-1`。 |
| 警告/提示 | Warning | 背景使用 `--color-warning-soft`，强调色使用 `--color-warning`，正文使用 `--color-text-1`，辅助说明使用 `--color-text-2`。 |
| 警告/提示 | Info | 背景使用 `--color-background-soft` 或信息组件已有浅背景，强调色使用 `--color-info`，链接使用 `--color-link`。 |

## 4. 暗色模式开发规则

1. 所有颜色必须使用 `var()` 引用 `theme.css` 中已有 token，禁止在组件 CSS 中新增孤立色值。
2. 所有新增或修改的界面必须同时检查亮色模式和暗色模式。
3. 边框必须使用具备透明度的 token，例如 `--color-border`、`--color-border-strong`、`--color-error-border`，避免在暗色模式下出现高亮硬边。
4. 阴影必须使用 `--shadow-*` token，不允许在组件内自定义独立阴影体系。
5. 文本必须遵循 `--color-text-1` / `--color-text-2` / `--color-text-3` / `--color-text-4` 层级，不能用透明黑白直接模拟文本层级。
6. 页面与容器背景必须使用 `--color-background` 或 `--color-surface` 系列 token，根据层级选择 `--color-background-soft`、`--color-background-mute`、`--color-surface-raised`。
7. 推荐按以下层级选择暗色模式下的背景面，避免页面内不同容器层级混用：

| 层级 | 用途 | Token |
|------|------|-------|
| 页面底色 | body 背景 | `--color-background` |
| 分组/区域 | 表头、工具栏底色 | `--color-background-soft` |
| 卡片/面板 | 侧边栏、表格容器、表单 | `--color-surface` |
| 抬升浮层 | 模态框、下拉菜单 | `--color-surface-raised` |
| 半透明顶栏 | 固定导航、毛玻璃 | `--color-surface-overlay` |
| 交互 hover | 菜单项、表格行 | `--color-background-hover` |

8. 主题切换只能通过 `data-theme` 属性实现，持久化键名固定为 `localStorage` 的 `cherry-theme`；不得绕过该机制直接使用 `@media (prefers-color-scheme)` 编写第二套样式。

## 5. CherryStudio Token 映射表

下表中的“CherryStudio 源文件”均指 `external/cherry-studio/src/renderer/src/assets/styles/` 目录下的对应文件；无直接 token 的项标记为 CherryWiki 本地扩展。

| CherryWiki Token | CherryStudio Token | 对齐状态 | CherryStudio 源文件 |
|---|---|---|---|
| `--color-primary` | `--color-primary` | 完全一致 | `color.css` 直接定义。 |
| `--color-primary-hover` | `--color-primary` 派生 hover 值 | Web 适配 | `color.css` 主色二次派生。 |
| `--color-primary-active` | `--color-primary` 派生 active 值 | Web 适配 | `color.css` 主色二次派生。 |
| `--color-primary-soft` | `--color-primary-soft` | 完全一致 | `color.css` 直接定义。 |
| `--color-primary-mute` | `--color-primary-mute` | 完全一致 | `color.css` 直接定义。 |
| `--color-primary-focus-ring` | `--color-primary` 透明度派生值 | Web 适配 | `color.css` 主色透明度派生。 |
| `--color-text-1` | `--color-text-1` | Web 适配 | `color.css` 直接定义。 |
| `--color-text-2` | `--color-text-2` | 完全一致 | `color.css` 直接定义。 |
| `--color-text-3` | `--color-text-3` | 完全一致 | `color.css` 直接定义。 |
| `--color-text-4` | `--color-text-3` 更弱层级派生 | CherryWiki 独有 | `color.css` 文本层级基础上继续细分。 |
| `--color-background` | `--color-background` | 完全一致 | `color.css` 直接定义。 |
| `--color-background-soft` | `--color-background-soft` | 完全一致 | `color.css` 直接定义。 |
| `--color-background-mute` | `--color-background-mute` | Web 适配 | `color.css` 直接定义。 |
| `--color-background-hover` | `--color-hover` | Web 适配 | `color.css` hover 语义映射。 |
| `--color-surface` | `--color-background-soft` / `--color-white` | Web 适配 | `color.css` 容器背景语义重组。 |
| `--color-surface-raised` | `--modal-background` / `--color-background-soft` | Web 适配 | `color.css` 弹层背景语义映射。 |
| `--color-surface-overlay` | `--color-background-opacity` | Web 适配 | `color.css` 半透明背景映射。 |
| `--color-backdrop` | `--modal-background` 场景遮罩派生 | CherryWiki 独有 | `color.css` 模态背景语义基础上本地扩展。 |
| `--color-login-gradient-1` | `--color-primary` 透明度派生值 | CherryWiki 独有 | `color.css` 主色透明度派生。 |
| `--color-login-gradient-2` | `--color-primary` 透明度派生值 | CherryWiki 独有 | `color.css` 主色透明度派生。 |
| `--color-border` | `--color-border` | Web 适配 | `color.css` 直接定义。 |
| `--color-border-strong` | `--color-border-soft` / `--color-frame-border` 派生 | Web 适配 | `color.css` 边框层级重组。 |
| `--color-error` | `--color-error` | Web 适配 | `color.css` 直接定义。 |
| `--color-error-hover` | `--color-error` 派生 hover 值 | CherryWiki 独有 | `color.css` 错误色基础上本地扩展。 |
| `--color-error-soft` | `--color-error` 透明度派生值 | Web 适配 | `color.css` 错误色透明度派生。 |
| `--color-error-border` | `--color-error` 透明度派生值 | Web 适配 | `color.css` 错误色透明度派生。 |
| `--color-success` | `--color-status-success` / `--color-primary` | Web 适配 | `color.css` 成功语义与主色语义映射。 |
| `--color-success-soft` | `--color-primary` 透明度派生值 | CherryWiki 独有 | `color.css` 主色透明度派生。 |
| `--color-warning` | `--color-status-warning` | 完全一致 | `color.css` 直接定义。 |
| `--color-warning-soft` | `--color-status-warning` 透明度派生值 | CherryWiki 独有 | `color.css` 警告色基础上本地扩展。 |
| `--color-info` | `--color-link` | Web 适配 | `color.css` 信息色映射到链接语义。 |
| `--color-link` | `--color-link` | 完全一致 | `color.css` 直接定义。 |
| `--color-status-healthy-bg` | `--color-status-success` 语义派生 | CherryWiki 独有 | `color.css` 成功语义基础上本地扩展。 |
| `--color-status-healthy-text` | `--color-status-success` 语义派生 | CherryWiki 独有 | `color.css` 成功语义基础上本地扩展。 |
| `--color-status-degraded-bg` | `--color-status-warning` 语义派生 | CherryWiki 独有 | `color.css` 警告语义基础上本地扩展。 |
| `--color-status-degraded-text` | `--color-status-warning` 语义派生 | CherryWiki 独有 | `color.css` 警告语义基础上本地扩展。 |
| `--color-status-unhealthy-bg` | `--color-status-error` 语义派生 | CherryWiki 独有 | `color.css` 错误语义基础上本地扩展。 |
| `--color-status-unhealthy-text` | `--color-status-error` 语义派生 | CherryWiki 独有 | `color.css` 错误语义基础上本地扩展。 |
| `--color-status-neutral-bg` | `--color-background-mute` / `--color-list-item` | Web 适配 | `color.css` 中性色背景语义重组。 |
| `--color-status-neutral-text` | `--color-text-2` | Web 适配 | `color.css` 文本层级映射。 |
| `--color-scrollbar-thumb` | `--color-scrollbar-thumb` | 完全一致 | `scrollbar.css` 直接定义。 |
| `--color-scrollbar-thumb-hover` | `--color-scrollbar-thumb-hover` | Web 适配 | `scrollbar.css` hover 变量直接对应。 |
| `--scrollbar-width` | `--scrollbar-width` | 完全一致 | `scrollbar.css` 直接定义。 |
| `--scrollbar-height` | `--scrollbar-height` | 完全一致 | `scrollbar.css` 直接定义。 |
| `--scrollbar-thumb-radius` | `--scrollbar-thumb-radius` | 完全一致 | `scrollbar.css` 直接定义。 |
| `--shadow-xs` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--shadow-sm` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--shadow-md` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--shadow-lg` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--shadow-modal` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--radius-xs` | `--list-item-border-radius` 派生 | CherryWiki 独有 | `color.css` 中圆角变量基础上继续细分。 |
| `--radius-sm` | `--list-item-border-radius` 派生 | CherryWiki 独有 | `color.css` 中圆角变量基础上继续细分。 |
| `--radius-md` | `--list-item-border-radius` 派生 | Web 适配 | `color.css` 中圆角变量语义映射。 |
| `--radius-lg` | `--list-item-border-radius` | Web 适配 | `color.css` 中圆角变量直接映射。 |
| `--radius-xl` | `--list-item-border-radius` 派生 | CherryWiki 独有 | `color.css` 中圆角变量基础上继续细分。 |
| `--radius-full` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--font-family` | `--font-family` | Web 适配 | `font.css` 直接定义。 |
| `--font-family-mono` | `--code-font-family` | Web 适配 | `font.css` 等宽字体变量映射。 |
| `--transition-fast` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |
| `--transition-normal` | 无直接 token | CherryWiki 独有 | 无直接源文件，CherryWiki 本地扩展。 |

## 6. 禁止模式清单

| 禁止模式 | 正确做法 | 示例 |
|---|---|---|
| 硬编码 hex 色值 | 使用 `var(--color-*)` token | 禁止：`color: #2563eb;`；正确：`color: var(--color-primary);` |
| inline style colors | 将颜色写入 CSS class 并引用 token | 禁止：`style={{ color: '#ff4d4f' }}`；正确：`.error { color: var(--color-error); }` |
| 裸 `rgba()` 色值 | 若表达语义色或边框，必须先沉淀为 token 或使用现有透明 token | 禁止：`border-color: rgba(0,0,0,.12);`；正确：`border-color: var(--color-border);` |
| 新增 CSS 框架 | 沿用现有 CSS 与 token 体系，新增依赖需先经过架构评审 | 禁止：为单个页面引入 TailwindCSS、Ant Design 或 styled-components；正确：复用 `theme.css` 与现有组件样式。 |
| `!important` 覆盖 | 调整选择器结构或组件状态 class，避免破坏主题层级 | 禁止：`.btn { color: var(--color-primary) !important; }`；正确：使用明确状态类 `.btn.is-active`。 |
| 绕过 `data-theme` 的 `@media (prefers-color-scheme)` | 所有暗色差异写入 `[data-theme='dark']` token 覆盖 | 禁止：在组件 CSS 中写 `@media (prefers-color-scheme: dark)`；正确：使用 `color: var(--color-text-1);`。 |

## 7. PR 审查清单

- [ ] 新增或修改的 CSS 中没有硬编码 hex、rgb、rgba、hsl 颜色值；文档示例和第三方不可控片段除外。
- [ ] React inline style 中没有直接写颜色、边框色、阴影色。
- [ ] 所有颜色均通过 `var(--color-*)`、`var(--shadow-*)`、`var(--radius-*)`、`var(--transition-*)` 等 token 引用。
- [ ] 新增页面和组件已检查亮色模式显示效果。
- [ ] 新增页面和组件已检查暗色模式显示效果。
- [ ] hover/focus-visible 状态在暗色模式下对比度足够。
- [ ] 文本颜色符合 `--color-text-1/2/3/4` 层级，未用透明黑白绕过文本 token。
- [ ] 背景层级符合 `--color-background`、`--color-surface`、`--color-surface-raised` 的使用边界。
- [ ] 边框、圆角、阴影、动效分别使用 `--color-border*`、`--radius-*`、`--shadow-*`、`--transition-*` token。
- [ ] disabled 状态视觉明确（降低对比度，cursor: not-allowed）。
- [ ] 状态徽章、错误、警告、成功、信息提示使用语义 token，未复用不匹配的品牌色。
- [ ] 空状态和加载状态使用正确 token（`--color-text-3` 文字、`--color-border-strong` dashed 边框）。
- [ ] 未新增 TailwindCSS、Ant Design、styled-components 等 CSS 或 UI 依赖；确需新增时已有单独架构评审记录。
