## Context

CherryGraph Studio 从零开始建设 monorepo。技术栈已定型（docs/engineering/13_开发规范.md §3）：Node.js 20 LTS、TypeScript strict、pnpm workspace。仓库结构见 13_开发规范.md §2。

## Goals / Non-Goals

**Goals:**
- pnpm workspace 统一管理 apps/* 和 packages/*
- TypeScript strict 全局配置，禁 any
- packages/shared 提供 env 校验、错误码、公共类型
- 所有 lint / typecheck 一条命令可跑

**Non-Goals:**
- 不安装任何框架（NestJS、React 等）——由 CS-1 / CS-3 负责
- 不创建 apps/ 下任何应用目录——由 CS-1 ~ CS-4 负责
- 不配置 Docker——由 CS-5 负责

## Decisions

1. **包管理器**：pnpm（workspace 原生支持，与 NestJS 生态兼容）
2. **TypeScript 配置**：根目录 tsconfig.base.json 定义 strict + paths alias，各 package 继承 extends
3. **Lint**：eslint flat config（eslint.config.js），集成 @typescript-eslint，规则含 no-explicit-any
4. **格式化**：Prettier，配置 printWidth=100、singleQuote=true、trailingComma=all
5. **env schema**：使用 zod 校验环境变量（docs/ops/env.example 为字段来源），启动时 parse 失败即 crash
6. **ErrorCode**：大写蛇形枚举（docs/engineering/13_开发规范.md §6），如 PERMISSION_DENIED、NOT_FOUND、VALIDATION_ERROR
7. **RequestContext**：类型定义 { request_id, tenant_id, user_id, space_id }，贯穿日志和审计

## Risks / Trade-offs

- pnpm workspace path alias 需要每个 package 的 tsconfig 正确配置 references，初始设置略复杂但一次性投入
- zod env schema 在开发环境可能因缺少变量报错，需提供合理默认值或 .env.development
