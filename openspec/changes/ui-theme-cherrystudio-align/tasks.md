## 1. Theme Token 体系

- [ ] 1.1 创建 `apps/web/src/theme.css`，定义 `:root` 亮色模式 token（primary、text、background、surface、border、semantic、status、shadow、radius、typography、transition、scrollbar）
- [ ] 1.2 在 `theme.css` 中添加 `[data-theme='dark']` 暗色模式 token 定义
- [ ] 1.3 在 `theme.css` 中添加滚动条主题样式（`::-webkit-scrollbar` 伪元素）

## 2. 样式迁移

- [ ] 2.1 在 `styles.css` 顶部添加 `@import './theme.css'`
- [ ] 2.2 迁移 `styles.css` 中所有硬编码色值为 `var()` 引用（含 root、body、login、form、button、admin、table、modal、status、health 等全部选择器）
- [ ] 2.3 迁移 `styles.css` 中硬编码的 border-radius 为 `var(--radius-*)` 引用
- [ ] 2.4 迁移 `styles.css` 中硬编码的 box-shadow 为 `var(--shadow-*)` 引用
- [ ] 2.5 迁移 `styles.css` 中硬编码的 transition duration 为 `var(--transition-*)` 引用
- [ ] 2.6 迁移 `styles.css` 中硬编码的 font-family 为 `var(--font-family)` 引用
- [ ] 2.7 验证 `styles.css` 中无残留硬编码 hex 色值（grep `#[0-9a-fA-F]`）

## 3. 暗色模式基础设施

- [ ] 3.1 在 `apps/web/index.html` 的 `<head>` 中添加内联主题检测脚本（检查 localStorage `cherry-theme` → 检查 `prefers-color-scheme` → 设置 `data-theme`）

## 4. UI 设计规范文档

- [ ] 4.1 创建 `docs/design/12_UI设计规范_CherryStudio风格对齐.md`，包含：token 参考表、组件模式指南、暗色模式开发规则、CherryStudio 映射表、禁止模式清单

## 5. 需求文档 UI 对齐

- [ ] 5.1 在 `docs/requirements/04_模块需求_CherryWeb_Chat_Admin.md` §2 开头添加 UI 设计规范引用声明
- [ ] 5.2 更新 `04_模块需求` §2.2 Chat 回答状态机 UI 表现列，将视觉描述 token 化（如 `failed` 状态使用 `--color-error` token）
- [ ] 5.3 更新 `04_模块需求` §2.2 answer_source UI 标注列，将"醒目标注"具体化为 `--color-warning` 警告横幅
- [ ] 5.4 更新 `04_模块需求` §2.2 引用版本提示，将"淡黄色背景或虚线边框"替换为 `--color-warning-soft` + `--color-border-strong` token 描述
- [ ] 5.5 更新 `04_模块需求` §2.2 引用展示中"明显标注"INFERRED/AMBIGUOUS 为具体 token 描述
- [ ] 5.6 在 `docs/requirements/03_产品需求_PRD.md` §7 页面需求开头添加 UI 设计规范引用声明
- [ ] 5.7 在 `docs/project/16_实施路线图与里程碑.md` §2.2 交付物表 Cherry Web 行追加 UI 规范合规要求
- [ ] 5.8 在 `docs/project/25_Phase1_Scope_Lock.md` §2 功能表中添加"UI 视觉规范合规"行
