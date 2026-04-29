## 1. 前置：阅读文档

- [ ] 1.1 阅读 `docs/engineering/13_开发规范.md` §9（Git 分支规范）§10（PR 规范）
- [ ] 1.2 阅读 `docs/project/25_Phase1_Scope_Lock.md` §6（Phase 1 验收数据集定义）
- [ ] 1.3 阅读 `docs/engineering/14_测试验收规范.md` §2（测试层级）
- [ ] 1.4 阅读 `docs/todo.md` T-15.3（CI/CD pipeline 骨架）和 T-15.4（test fixtures 要求）
- [ ] 1.5 确认 `docs/schemas/openapi.yaml` 和 `docs/schemas/schema.sql` 路径

## 2. 测试配置

- [ ] 2.1 安装 vitest 到 workspace root
- [ ] 2.2 创建 `vitest.config.ts`（全局配置，passWithNoTests: true）
- [ ] 2.3 在根 package.json 确认 `test` script 调用 vitest

## 3. CI 管线

- [ ] 3.1 创建 `.github/workflows/ci.yml`
- [ ] 3.2 CI 步骤配置：
  - checkout（actions/checkout@v4）
  - pnpm setup（pnpm/action-setup）
  - Node.js setup（actions/setup-node，cache pnpm）
  - pnpm install
  - pnpm lint
  - pnpm typecheck
  - pnpm test
- [ ] 3.3 添加 OpenAPI 校验步骤（安装 @redocly/cli，执行 redocly lint docs/schemas/openapi.yaml）
- [ ] 3.4 添加 SQL 语法校验步骤（使用 pg_format 或 pgsanity 检查 docs/schemas/schema.sql）
- [ ] 3.5 配置 PR 门禁（在 ci.yml 中 on: pull_request）

## 4. 测试数据集骨架

- [ ] 4.1 创建 `tests/fixtures/test-corpus-small/README.md`（说明预期 10 文件：5 PDF + 3 DOCX + 2 MD，共 50 页）
- [ ] 4.2 创建 `tests/fixtures/test-corpus-security/README.md`（说明预期恶意样本类型：ZIP bomb、路径穿越 ZIP、injection PDF、SSRF URL）
- [ ] 4.3 在 .gitkeep 确保空目录可提交

## 5. 验证

- [ ] 5.1 `pnpm test` 通过（passWithNoTests）
- [ ] 5.2 `pnpm lint` 通过
- [ ] 5.3 `pnpm typecheck` 通过
- [ ] 5.4 手动验证 CI yml 语法正确（可用 act 本地测试或推送触发）
- [ ] 5.5 tests/fixtures/ 目录结构就位
