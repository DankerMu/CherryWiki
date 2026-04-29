## Why

CherryGraph Studio 当前仅有设计文档，无任何源代码。所有后续 Stage（Auth、Upload、Graphify、Chat）都需要一个统一的 monorepo 工程骨架作为基础。没有这个骨架，开发无法启动。

## What Changes

- 创建 pnpm workspace monorepo 结构（apps/* + packages/*）
- 建立根级 TypeScript、ESLint、Prettier 配置
- 建立 `packages/shared` 公共包：env schema、错误码枚举、公共类型、常量
- 建立其余 5 个 packages 空壳：auth-core、wiki-core、rag-core、graph-core、ai-core（仅 package.json + tsconfig + 空 index.ts）
- 所有后续 changeset（CS-1 ~ CS-6）依赖本 changeset 的产出

## Capabilities

### New Capabilities
- `monorepo-workspace`: pnpm workspace 配置、根级 scripts（dev/build/lint/typecheck/test）
- `shared-package`: packages/shared 公共包——env 校验 schema、ErrorCode 枚举、RequestContext 类型

### Modified Capabilities

## Impact

- 新建约 15 个文件（package.json、tsconfig、lint 配置、shared 源码）
- 后续所有 apps/* 和 packages/* 均依赖此骨架
- 技术栈锁定：Node.js 20 LTS、TypeScript strict、pnpm

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` §2 | 推荐仓库结构（apps/packages/external 布局） |
| `docs/engineering/13_开发规范.md` §3 | 技术栈规范（Node.js 20、TypeScript strict） |
| `docs/engineering/13_开发规范.md` §4 | TypeScript 规范（strict、禁 any、unknown + runtime validation） |
| `docs/ops/env.example` | 环境变量完整清单（env schema 字段来源） |
| `docs/design/11_API规范.md` §统一响应 | ErrorCode 枚举参考（PERMISSION_DENIED 等大写蛇形） |
| `docs/audit/20_Cherry_Studio_代码审计.md` | 哪些 Cherry 代码可复用、哪些必须重写 |
