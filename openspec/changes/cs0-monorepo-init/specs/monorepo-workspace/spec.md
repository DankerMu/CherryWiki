## ADDED Requirements

### Requirement: pnpm-workspace
MUST pnpm workspace 配置，统一管理 apps/* 和 packages/*。

#### Scenario: workspace 安装
- **WHEN** 在项目根目录执行 `pnpm install`
- **THEN** 所有 apps 和 packages 的依赖被正确安装，workspace 内部引用通过 workspace: 协议解析

#### Scenario: 根级 scripts
- **WHEN** 执行 `pnpm lint` / `pnpm typecheck` / `pnpm test`
- **THEN** 命令递归执行所有 workspace package 的对应 script

### Requirement: typescript-config
MUST 根级 TypeScript 配置，strict 模式，所有 package 继承。

#### Scenario: strict 模式
- **WHEN** 任何 .ts 文件使用 `any` 类型
- **THEN** TypeScript 编译报错

#### Scenario: paths alias
- **WHEN** apps/api 导入 `@cherrygraph/shared`
- **THEN** TypeScript 正确解析到 packages/shared/src

### Requirement: lint-format
MUST eSLint flat config + Prettier，统一代码风格。

#### Scenario: lint 检查
- **WHEN** 执行 `pnpm lint`
- **THEN** 检查 TypeScript strict 规则（@typescript-eslint），no-explicit-any 报错

> **参考文档**: docs/engineering/13_开发规范.md §2（仓库结构）§4（TypeScript 规范）
