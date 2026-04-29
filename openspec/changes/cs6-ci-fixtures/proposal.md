## Why

Stage 0 的收口需要 CI 管线和测试数据集骨架。没有 CI，后续 Stage 的代码质量无门禁；没有测试 fixture，E2E 和安全测试无法编写。

## What Changes

- 创建 `.github/workflows/ci.yml` CI 管线：lint → typecheck → unit test → OpenAPI 校验 → SQL 校验
- 创建全局测试配置（vitest.config.ts）
- 创建 `tests/fixtures/` 测试数据集骨架
  - test-corpus-small/（10 个样本文件占位）
  - test-corpus-security/（目录 + README 说明待补充内容）
- 确保 CI 在当前空壳状态下全链路跑通

## Capabilities

### New Capabilities
- `ci-pipeline`: GitHub Actions CI 管线（lint / typecheck / test / OpenAPI validate / SQL validate）
- `test-fixtures`: tests/fixtures/ 测试数据集骨架
- `test-config`: 全局 vitest 测试配置

### Modified Capabilities

## Impact

- 新建 .github/workflows/ci.yml、vitest.config.ts、tests/fixtures/
- 依赖 CS-0（pnpm workspace + lint + typecheck 即可运行 CI）
- 后续 Stage 1+ 的 PR 门禁由此 CI 管线守护

### 实现前必读文档

| 文档路径 | 读取重点 |
|---|---|
| `docs/engineering/13_开发规范.md` §9-§10 | Git 分支规范、PR 规范、commit 格式 |
| `docs/project/25_Phase1_Scope_Lock.md` §6 | Phase 1 验收数据集定义（test-corpus-small/medium/security/perf） |
| `docs/engineering/14_测试验收规范.md` §2 | 测试层级（单元/集成/E2E/权限/性能/安全/回归） |
| `docs/todo.md` T-15.3 | CI/CD pipeline 骨架：lint → test → build → security scan |
| `docs/todo.md` T-15.4 | tests/fixtures/ 测试数据集要求 |
| `docs/schemas/openapi.yaml` | OpenAPI 校验目标文件 |
| `docs/schemas/schema.sql` | SQL 语法校验目标文件 |
