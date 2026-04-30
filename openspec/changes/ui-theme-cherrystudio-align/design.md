## Context

CherryWiki 前端 (`apps/web/`) 当前使用单一 `styles.css` 文件，全部色值硬编码（蓝色主调 #2563eb，Slate 灰阶体系）。无暗色模式，无主题变量。CherryStudio 参考实现 (`external/cherry-studio/`) 使用完整的 CSS custom properties 体系，支持暗色/亮色双模式，主色调为翡翠绿 #00b96b。

当前已实现页面：Login（功能完整）、Admin 6 个子页（功能完整）、Chat/Wiki（占位符）。Chat 和 Wiki 是 Phase 1 M1 必交付项，尚未开发，建立 token 体系后可直接用新主题开发。

## Goals / Non-Goals

**Goals:**

- 建立 CSS custom properties 主题 token 体系，对齐 CherryStudio 设计语言
- 将现有 styles.css 所有硬编码色值迁移为变量引用
- 支持亮色/暗色双模式（系统偏好自动检测 + 手动切换）
- 产出 UI 设计规范文档，指导后续 Phase 开发
- 更新现有需求/项目文档中的 UI 描述，统一引用 token 体系

**Non-Goals:**

- 不引入 Ant Design、styled-components、TailwindCSS 等新依赖
- 不重构组件结构（保持现有 CSS class 命名）
- 不新增主题切换 UI 组件（留到 Chat 页面开发时）
- 不改变页面布局和交互逻辑
- 不实现 CherryStudio 的动画体系（framer-motion）

## Decisions

### D1: Token 命名对齐 CherryStudio 但适配 Web

CherryStudio 使用 `--color-text-1/2/3`、`--color-background`、`--color-primary` 等命名。CherryWiki 采用相同命名规范，新增 Web 场景需要的 token（如 `--color-surface`、`--shadow-*`、`--radius-*`）。

**理由**: 后续如果引入 CherryStudio 组件或代码，token 名称兼容可减少适配成本。

### D2: 亮色模式默认，暗色通过 data-theme 属性切换

CherryStudio 默认暗色（Electron 桌面应用惯例），CherryWiki 默认亮色（Web 应用惯例）。暗色模式通过 `<html data-theme="dark">` 激活。在 `index.html` 中添加内联脚本检测 `prefers-color-scheme: dark` 并自动设置属性。

**替代方案**: 纯 `@media (prefers-color-scheme: dark)` — 无法手动切换，排除。  
**替代方案**: 重复定义 dark tokens 在 `@media` 和 `[data-theme]` 中 — 维护成本翻倍，排除。

### D3: 单文件 theme.css + styles.css @import

新建 `theme.css` 存放所有 token 定义（`:root` 亮色 + `[data-theme='dark']` 暗色）。`styles.css` 顶部 `@import './theme.css'` 引入，然后使用 `var()` 引用。

**理由**: 职责分离。theme.css 是设计决策，styles.css 是组件样式。Vite 原生支持 CSS @import。

### D4: 状态色保持语义化独立 token

健康/降级/异常等状态色不直接复用 `--color-success/warning/error`，而是定义独立的 `--color-status-*` token。

**理由**: 状态色在暗色模式下需要不同的亮度调整（如暗色背景上用更亮的文字色），与通用语义色的暗色适配策略不同。

### D5: index.html 内联脚本防止 FOUC

主题检测脚本放在 `<head>` 中 `<script>` 标签内（非 module），在 DOM 渲染前同步执行，避免亮暗模式闪烁（Flash of Unstyled Content）。

**理由**: 如果用 React 组件设置 data-theme，会在首次渲染后才生效，导致闪烁。

### D6: 需求文档 UI 描述采用"引用声明 + token 内联"双层策略

**层 A — 统一引用声明**: 在 `03_PRD` §7 和 `04_模块需求` §2 的章节开头各加一行引用声明："所有前端 UI 实现须遵循 `docs/design/12_UI设计规范_CherryStudio风格对齐.md`"。

**层 B — 关键 UI 描述 token 化**: 在 Chat 状态表现、引用卡片视觉、answer_source 标注等具体 UI 描述处，将模糊的视觉词（"淡黄色背景"、"醒目标注"、"明显标注"）替换为 token 名称 + 具体效果描述。例：
- "淡黄色背景或虚线边框" → "`--color-warning-soft` 背景 + `--color-border-strong` 虚线边框"
- "醒目标注" → "`--color-warning` 色调警告横幅"
- "明显标注" → "`--color-status-degraded-text` 色标签"

**理由**: 层 A 确保不遗漏，层 B 确保关键 UI 决策在需求文档层面就可落地，不依赖开发者自行解读。

### D7: 里程碑和 Scope Lock 增加 UI 合规行

在 `16_实施路线图` Phase 1 交付物表和 `25_Phase1_Scope_Lock` §2 功能表中各加一行 UI 规范合规要求，使其成为交付门禁的一部分。

**理由**: 如果 UI 规范仅存在于独立的设计文档中，开发者可能绕过。写入交付物和 scope lock 后，验收时必须对照。

## Risks / Trade-offs

- **[视觉不一致]** 主色从蓝变绿，已有截图/文档中的 UI 参考图失效 → 可接受，当前无外部文档依赖
- **[Token 覆盖不全]** 首次迁移可能遗漏个别硬编码色值 → 通过全文搜索 `#` 开头色值验证
- **[暗色模式质量]** 暗色模式仅通过 token 切换，部分渐变/阴影效果可能需要额外调整 → Phase 1 先保证可用，后续迭代优化
