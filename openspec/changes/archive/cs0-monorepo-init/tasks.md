## 1. 前置：阅读文档

- [x] 1.1 阅读 `docs/engineering/13_开发规范.md` §2（仓库结构）§3（技术栈）§4（TypeScript 规范）
- [x] 1.2 阅读 `docs/ops/env.example`（环境变量完整清单）
- [x] 1.3 阅读 `docs/design/11_API规范.md` 统一响应部分（ErrorCode 枚举参考）
- [x] 1.4 阅读 `docs/audit/20_Cherry_Studio_代码审计.md`（哪些 Cherry 代码可复用、哪些必须重写）

## 2. Monorepo 配置

- [x] 2.1 创建 `pnpm-workspace.yaml`，配置 `packages: ['apps/*', 'packages/*']`
- [x] 2.2 创建根 `package.json`（name: cherrygraph-studio, private: true, scripts: dev/build/lint/typecheck/test）
- [x] 2.3 创建 `tsconfig.base.json`（strict: true, 禁 any, paths alias @cherrygraph/*）
- [x] 2.4 创建根 `tsconfig.json` 引用 tsconfig.base.json
- [x] 2.5 创建 `eslint.config.js`（flat config, @typescript-eslint, no-explicit-any 报错）
- [x] 2.6 创建 `.prettierrc`（printWidth: 100, singleQuote: true, trailingComma: all）
- [x] 2.7 更新 `.gitignore`（node_modules, dist, .env, *.local）

## 3. packages/shared

- [x] 3.1 创建 `packages/shared/package.json`（name: @cherrygraph/shared）
- [x] 3.2 创建 `packages/shared/tsconfig.json`（extends tsconfig.base.json）
- [x] 3.3 创建 `packages/shared/src/env.ts`：zod schema 校验 DATABASE_URL、REDIS_URL、JWT_SECRET、MINIO_ENDPOINT 等（字段来源 docs/ops/env.example）
- [x] 3.4 创建 `packages/shared/src/errors.ts`：ErrorCode 枚举（PERMISSION_DENIED、NOT_FOUND、VALIDATION_ERROR、INTERNAL_ERROR、CONFLICT、RATE_LIMITED 等大写蛇形）
- [x] 3.5 创建 `packages/shared/src/types.ts`：RequestContext 类型 { request_id, tenant_id, user_id, space_id }
- [x] 3.6 创建 `packages/shared/src/constants.ts`：全局常量（版本号等）
- [x] 3.7 创建 `packages/shared/src/index.ts`：统一导出

## 4. 其余 packages 空壳

- [x] 4.1 创建 `packages/auth-core/package.json`（name: @cherrygraph/auth-core）+ tsconfig.json + src/index.ts（空导出）
- [x] 4.2 创建 `packages/wiki-core/package.json`（name: @cherrygraph/wiki-core）+ tsconfig.json + src/index.ts（空导出）
- [x] 4.3 创建 `packages/rag-core/package.json`（name: @cherrygraph/rag-core）+ tsconfig.json + src/index.ts（空导出）
- [x] 4.4 创建 `packages/graph-core/package.json`（name: @cherrygraph/graph-core）+ tsconfig.json + src/index.ts（空导出）
- [x] 4.5 创建 `packages/ai-core/package.json`（name: @cherrygraph/ai-core）+ tsconfig.json + src/index.ts（空导出）

## 5. 单元测试（packages/shared）

- [x] 5.1 `packages/shared/src/__tests__/env.test.ts`：env schema 校验通过 — 所有必需环境变量已设置时，`envSchema.parse(process.env)` 返回类型安全的配置对象
- [x] 5.2 `packages/shared/src/__tests__/env.test.ts`：env schema 缺失字段 — DATABASE_URL 未设置时，抛出 ZodError 且错误信息包含缺失字段名
- [x] 5.3 `packages/shared/src/__tests__/env.test.ts`：env schema 可选字段默认值 — 可选字段（如 LOG_LEVEL）未设置时使用默认值
- [x] 5.4 `packages/shared/src/__tests__/errors.test.ts`：ErrorCode 枚举包含所有必需值 — UNAUTHENTICATED、PERMISSION_DENIED、NOT_FOUND、VALIDATION_ERROR、RATE_LIMITED、CONFLICT、INTERNAL_ERROR
- [x] 5.5 `packages/shared/src/__tests__/errors.test.ts`：ErrorCode 值均为大写蛇形格式
- [x] 5.6 `packages/shared/src/__tests__/types.test.ts`：RequestContext 类型编译检查 — 包含 request_id: string, tenant_id: string, user_id: string | null, space_id: string | null
- [x] 5.7 `packages/shared/src/__tests__/index.test.ts`：统一导出验证 — 从 @cherrygraph/shared 可导入 ErrorCode、RequestContext、envSchema

## 6. 集成验证

- [x] 6.1 `pnpm install` 成功
- [x] 6.2 `pnpm lint` 通过
- [x] 6.3 `pnpm typecheck` 通过
- [x] 6.4 `pnpm test` 通过（所有单元测试绿色）
- [x] 6.5 从其他 package 导入 `@cherrygraph/shared` 验证 workspace 引用正确
- [x] 6.6 确认 7 个 packages 目录均存在且可被 workspace 识别（`pnpm ls --depth 0`）
