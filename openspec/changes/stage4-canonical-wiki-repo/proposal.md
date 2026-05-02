## Why

Stage 3 完成了资料上传→解析→安全校验的管线，但解析产物（parsed markdown）目前只存在 MinIO，没有进入结构化 Wiki 体系。Stage 4 建立 Canonical Wiki Repo——唯一企业知识引用源，使系统具备"页面版本化 → 发布 → 只读浏览 → 引用跳转"的核心形态，为后续 Graphify 导入（Stage 5）和索引/Chat（Stage 6-7）奠定基础。

## What Changes

- 补全 Drizzle ORM schema：`wiki_pages`、`wiki_page_versions`、`wiki_sections`、`source_links` 四张表定义 + 6 个索引 + Zod 验证
- 实现 `packages/wiki-core`：frontmatter parser/generator（对齐 Doc 21 §9.5）、slug 生成（对齐 Doc 21 §9.3 `_safe_filename()`）、page_id 生成（对齐 Doc 21 §9.4）、section anchor（对齐 Doc 21 §9.6）、版本管理、发布状态机（draft → published → archived）、回滚（创建新版本）
- 新建 `apps/api/src/wiki/` 模块：6 个 REST 端点（list pages、get page、get content、list versions、publish、rollback）
- Cherry Web 只读 Wiki 页面：页面列表、页面详情 + Markdown 渲染、版本历史查看
- `source_links` 基础证据链：Wiki 页面段落到源文档的引用映射

## Capabilities

### New Capabilities

- `wiki-schema`: Drizzle ORM 表定义（wiki_pages / wiki_page_versions / wiki_sections / source_links）+ 全部索引 + DB migration + Zod validation
- `wiki-core`: 核心领域逻辑——frontmatter（Doc 21 §9.5 标准字段）、slug（`_safe_filename()`）、page_id、section anchor、版本管理、发布状态机、回滚
- `wiki-api`: REST API 模块——6 个端点 + 权限守卫（`space:view`/`wiki:publish`/`wiki:rollback`）+ 审计事件（`wiki.page.publish`/`wiki.page.rollback`）
- `wiki-ui`: Cherry Web 只读 Wiki 前端——页面列表、页面详情、Markdown 渲染、版本历史
- `source-links`: 证据链基础——Wiki section 到 source_document 的引用追踪

### Modified Capabilities

（无已有 capability 需要修改）

## Impact

- **Schema**: `packages/shared/src/schema/core.ts` 新增 4 张表定义 + 6 个索引；`packages/shared/src/schema/validation.ts` 新增 Wiki 相关 Zod schema
- **API**: `apps/api/` 新增 `wiki/` 模块（controller + service + tests），注册到 `app.module.ts`
- **Packages**: `packages/wiki-core/` 从空壳变为完整 package
- **Frontend**: `apps/web/` 新增 Wiki 页面路由和组件
- **权限**: 复用已有 `space_permissions` 守卫（`space:view` 查看、`wiki:publish` 发布、`wiki:rollback` 回滚），权限代码已在 `auth.service.ts:110,116-117` 定义
- **审计**: 新增 `wiki.page.publish`、`wiki.page.rollback` 审计事件类型（与 Doc 11 一致）
- **依赖**: 需要 Markdown 渲染库（前端），无新后端外部依赖
