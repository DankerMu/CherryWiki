## Context

Stage 3 完成了上传→解析→安全校验的完整管线，解析产物（parsed markdown）存放在 MinIO。当前系统缺少结构化 Wiki 层：没有页面实体、版本管理、发布控制或只读浏览入口。

已有基础设施：
- SQL schema（`schema.sql`）已定义 `wiki_pages`、`wiki_page_versions`、`wiki_sections`、`source_links` 四张表 + 6 个索引
- OpenAPI 已定义 Wiki 端点（含 Stage 6 的 reindex、Phase 2 的 proposals）
- Drizzle ORM（`packages/shared/src/schema/core.ts`）仅有 `spaces.wiki_repo_path`，未定义 wiki 表
- `packages/wiki-core` 是空壳（`export {}`）
- `apps/api/src/` 无 `wiki/` 模块
- 权限代码已预埋 `space:view`（auth.service.ts:110）、`wiki:publish`（:116）、`wiki:rollback`（:117）

## Goals / Non-Goals

**Goals:**
- 将 wiki_pages / wiki_page_versions / wiki_sections / source_links 纳入 Drizzle schema + Zod validation + 全部 6 个索引
- 实现 wiki-core package：frontmatter 解析/生成（对齐 Doc 21 §9.5 标准字段）、slug 生成（对齐 Doc 21 §9.3 `_safe_filename()`）、page_id 生成（对齐 Doc 21 §9.4）、section anchor（对齐 Doc 21 §9.6）、版本管理、发布状态机、回滚
- 实现 API wiki 模块：6 个端点（list pages、get page、get content、list versions、publish、rollback）+ space 权限守卫 + 审计
- Cherry Web 只读 Wiki：页面列表、详情（Markdown 渲染）、版本历史
- source_links 基础 CRUD（为后续 Graphify 导入和 Chat 引用奠基）

**Non-Goals:**
- Graphify 导入逻辑（Stage 5）
- Wiki chunk 分块和向量索引（Stage 6）
- reindex 端点（Stage 6 实现，不在 Stage 4 范围内）
- Chat 引用跳转（Stage 7）
- Docmost 双向同步（Phase 2）
- Wiki 编辑能力（Phase 2）
- proposals accept/reject 端点（Phase 2）

## Decisions

### D1: Drizzle schema 放在 shared package

**选择**: 在 `packages/shared/src/schema/core.ts` 追加 wiki 表定义

**理由**: 现有所有表（users、spaces、jobs 等）都在此文件，保持一致性。wiki-core 和 api 都依赖 shared，避免循环依赖。

**替代方案**: 在 wiki-core 内定义 → 会导致 api 需要同时依赖 shared 和 wiki-core 的 schema，增加耦合。

### D2: wiki-core 定位为纯领域逻辑 package

**选择**: wiki-core 不依赖 Fastify/NestJS 框架，只暴露纯函数和 class

**理由**: 与 auth-core、job-core 保持一致的 package 定位。便于 Stage 5 Graphify Worker 复用 frontmatter 逻辑。

**暴露内容**:
- `parseFrontmatter` / `generateFrontmatter`: 解析/生成 Doc 21 §9.5 标准 frontmatter（含 page_type、curation_status、managed_by 等完整字段）
- `generateSlug`: 复刻 Graphify `_safe_filename()`（空格→`_`，`/`→`-`，`:`→`-`，重复追加 `_2/_3`）
- `generatePageId`: 按 Doc 21 §9.4 生成 `{space_id}.{type_prefix}.{stable_key}`
- `PublishStateMachine`: draft → published / published → archived / rollback → 新版本
- `createVersion` / `getLatestVersionNo`: 版本号递增管理
- `extractSections`: 从 markdown h2/h3 提取 sections，生成 `{page_id}#heading-{slugify}` anchor

### D3: 发布状态机设计

```
                    ┌──────────┐
      创建/导入 ──▶ │  draft   │
                    └────┬─────┘
                         │ publish
                         ▼
                    ┌──────────┐
                    │published │◀──┐
                    └────┬─────┘   │
                         │         │ rollback（创建新版本,
                    archive        │ 自动 publish）
                         │         │
                         ▼         │
                    ┌──────────┐   │
                    │ archived │───┘
                    └──────────┘
```

状态值：`draft`、`published`、`archived`（与 openapi.yaml WikiPage.status enum 一致）。

- `publish`: 设置 `wiki_page_versions.status = 'published'`，更新 `wiki_pages.current_version_id`，写 `wiki.page.publish` 审计
- `rollback`: 复制目标版本的 content_markdown 创建新版本（version_no+1），source='rollback'，自动 publish，写 `wiki.page.rollback` 审计
- `archive`: 设置 status='archived'，不影响 current_version_id
- `published_at` / `published_by` 不是 schema 列，从 audit_logs 运行时派生
- 只有 published 的版本才会被后续 Stage 6 索引

### D4: API 端点权限映射

| 端点 | HTTP | 所需权限 |
|---|---|---|
| 列表页面 | GET /wiki/pages | `space:view` |
| 页面详情 | GET /wiki/pages/:id | `space:view` |
| 页面内容 | GET /wiki/pages/:id/content | `space:view` |
| 版本列表 | GET /wiki/pages/:id/versions | `space:view` |
| 发布 | POST /wiki/pages/:id/publish | `wiki:publish` |
| 回滚 | POST /wiki/pages/:id/rollback | `wiki:rollback` |

错误码：`WIKI_PAGE_NOT_FOUND`、`VERSION_NOT_FOUND`、`VERSION_ALREADY_PUBLISHED`（与 Doc 11 一致）。

审计动作：`wiki.page.publish`、`wiki.page.rollback`（与 Doc 11 一致）。

复用已有 `SpacePermissionGuard`，守卫逻辑与 uploads 模块一致。

### D5: 前端 Markdown 渲染

**选择**: `react-markdown` + `remark-gfm` + `rehype-highlight`

**理由**: 轻量、SSR 友好、已是 React 生态标准方案。GFM 支持表格/任务列表，rehype-highlight 支持代码高亮。

**替代方案**: `@mdx-js/react`（过重，Wiki 不需要嵌入组件）；`marked`（需要 dangerouslySetInnerHTML）。

### D6: 前端路由结构

```
/spaces/:spaceId/wiki                → 页面列表
/spaces/:spaceId/wiki/:pageId        → 页面详情（Markdown 渲染）
/spaces/:spaceId/wiki/:pageId/history → 版本历史
```

复用已有的 Space 侧边栏布局。Wiki 入口添加到 Space 详情页导航。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| Drizzle schema 追加到 core.ts 导致文件膨胀（当前 323 行 → ~450 行） | 4 张表 ~120 行，仍在可维护范围；Stage 5 后如果超过 500 行考虑拆分 |
| slug 算法需精确复刻 Graphify `_safe_filename()` | 从 Doc 21 §9.3 + Graphify v0.5.3 `wiki.py:9` 提取确切规则，单测覆盖 |
| rollback 创建新版本导致 version_no 只增不减 | 符合审计要求，版本历史完整可追溯，不做物理删除 |
| Cherry Web Markdown 渲染 XSS 风险 | react-markdown 默认不执行 HTML，rehype-sanitize 可选加固 |

## Open Questions

- wiki_sections 的 `acl_json` 在 Stage 4 是否需要实现？建议留空（`{}`），Phase 3 Graph ACL 时再填充。
- source_links 在 Stage 4 仅提供 CRUD 基础，实际关联在 Stage 5 Graphify 导入时建立——是否需要在 Stage 4 预留批量写入接口？
