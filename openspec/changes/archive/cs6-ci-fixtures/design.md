## Context

项目使用 GitHub（DankerMu/CherryWiki）。CI 只依赖 CS-0 的 pnpm workspace 即可跑通 lint/typecheck/test，前置到 CS-0 之后立即执行，确保后续所有 PR 有门禁。测试数据集要求见 docs/project/25_Phase1_Scope_Lock.md §6。

## Goals / Non-Goals

**Goals:**
- GitHub Actions CI 管线在当前空壳代码上全绿
- OpenAPI yaml 合法性校验通过
- SQL 语法校验通过
- tests/fixtures/ 目录结构就位
- 全局测试配置（vitest）可用

**Non-Goals:**
- 不实现集成测试或 E2E 测试——由 Stage 1+ 负责
- 不创建实际测试样本文件——只建目录结构和 README
- 不配置 CD（部署）——由 Stage 8 负责

## Decisions

1. **CI 平台**：GitHub Actions
2. **CI 步骤**：
   - checkout + pnpm install（缓存 node_modules）
   - lint（pnpm lint）
   - typecheck（pnpm typecheck）
   - unit test（pnpm test）
   - OpenAPI validate（使用 @redocly/cli lint 或 swagger-cli validate）
   - SQL validate（使用 pgsanity 或 pg_format --no-rcfile 检查语法）
3. **测试框架**：vitest（与 Vite 统一生态），根目录 vitest.config.ts
4. **fixture 目录**：
   - tests/fixtures/test-corpus-small/（含 README.md 说明 10 个样本的预期组成）
   - tests/fixtures/test-corpus-security/（含 README.md 说明恶意样本类型）
5. **PR 门禁**：CI 不通过则禁止 merge

## Risks / Trade-offs

- 空壳阶段 unit test 可能只有 0 个测试用例，CI 需配置 passWithNoTests
- OpenAPI/SQL 校验工具的选择需要轻量、无需数据库连接
