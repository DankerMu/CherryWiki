# 22. Docmost Fork 改动清单

## 1. 目标

本文件定义 `external/docmost/` 的 Fork 修改边界。原则是：**最小改动、Bridge 隔离、核心不动、可 rebase**。

## 2. Fork 基线版本

| 字段 | 值 |
|---|---|
| upstream | `docmost/docmost` |
| fork repo | `DankerMu/docmost` |
| fork path | `external/docmost/`（git submodule） |
| fork branch | `cherrygraph-bridge`（从 baseline 创建） |
| baseline tag | `v0.80.1` |
| baseline commit | `980521f95792ddd382ebbc275467a8319a351bae` |
| baseline date | 2026-04-28 |
| 技术栈 | NestJS + Fastify（后端）、React（前端）、Drizzle ORM、pnpm workspaces |
| rebase cycle | 每月一次或每个 Phase 结束后 |

## 3. 新增文件清单

经源码验证，Docmost 后端使用 NestJS + Fastify，路由按模块注册，非核心集成放在 `apps/server/src/integrations/`。Bridge 应放置于此。

| 路径（已验证） | 说明 |
|---|---|
| `apps/server/src/integrations/bridge/bridge.module.ts` | Bridge 路由模块，注册到 `app.module.ts` imports |
| `apps/server/src/integrations/bridge/bridge-auth.guard.ts` | `DOCMOST_BRIDGE_SECRET` HMAC 鉴权 |
| `apps/server/src/integrations/bridge/page-events.controller.ts` | 页面保存/删除事件 webhook |
| `apps/server/src/integrations/bridge/attachment-events.controller.ts` | 附件事件 webhook |
| `apps/server/src/integrations/bridge/page-export.controller.ts` | 页面 Markdown 导出 |
| `apps/server/src/integrations/bridge/page-import.controller.ts` | 页面 Markdown 导入/更新 |
| `apps/server/src/integrations/bridge/sync-status.controller.ts` | 同步状态查询 |
| `apps/server/src/integrations/bridge/dto/` | Bridge DTO 定义 |
| `apps/server/src/integrations/bridge/bridge-signature.ts` | HMAC-SHA256 签名校验 |
| `apps/server/src/integrations/bridge/README.md` | Fork 内部说明 |

**注册要点**（基于 Docmost v0.80.1 代码结构）：
1. 在 `apps/server/src/app.module.ts` 的 `imports` 添加 `BridgeModule`
2. Bridge 路由如需跳过 workspaceId 检查，在 `main.ts` 的 `excludedPaths` 添加 `/api/internal/bridge`
3. 如需跳过 DomainMiddleware，在 `core.module.ts` 的 `excludedRoutes` 添加
4. 参考现有 `apps/server/src/integrations/health/health.controller.ts` 作为最简控制器模板

## 4. 修改文件清单

| 修改点 | 说明 | 约束 |
|---|---|---|
| `apps/server/src/app.module.ts` | imports 添加 BridgeModule | 仅新增一行 import |
| `apps/server/src/main.ts` | excludedPaths 添加 `/api/internal/bridge` | 跳过 workspaceId 检查 |
| `apps/server/src/core/page/` 相关 service | 页面保存后 POST Cherry API `/api/internal/docmost/events/page-saved` | 不改变原保存逻辑，仅追加 EventEmitter + HTTP 通知 |
| `apps/server/src/core/page/` 相关 service | 页面删除后 POST Cherry API `/api/internal/docmost/events/page-deleted` | 不改变原删除逻辑 |
| 附件相关 service | 附件创建后 POST Cherry API `/api/internal/docmost/events/attachment-created` | 不改变存储层 |
| `.env.example` | 新增 `DOCMOST_BRIDGE_SECRET` | 不影响原配置 |

## 5. 不修改清单

| 模块 | 原因 |
|---|---|
| 核心编辑器 | 降低冲突，保留 Docmost 用户体验。 |
| 权限模型 | Cherry 只做映射与一致性检查，不改 Docmost ACL 内核。 |
| 存储层 schema | 避免 migration 冲突。 |
| 用户认证核心 | 通过现有认证或反向代理/OIDC 处理。 |
| 页面渲染核心 | 页面增强优先在 Cherry Web 旁路面板。 |

## 6. Bridge 事件

| 事件 | 触发时机 | 接收方 |
|---|---|---|
| `page.saved` | 页面保存成功后 | Cherry API / docmost-bridge |
| `page.deleted` | 页面删除成功后 | Cherry API / docmost-bridge |
| `attachment.created` | 附件上传成功后 | Cherry API / docmost-bridge |
| `attachment.deleted` | 附件删除成功后 | Cherry API / docmost-bridge |
| `space.updated` | Space 权限或属性变化 | Cherry API / docmost-bridge |

## 7. Rebase 流程

```bash
cd external/docmost
git fetch upstream
git checkout cherrygraph-bridge
git rebase upstream/main
# resolve conflicts
git push --force-with-lease origin cherrygraph-bridge
```

Rebase 后必须执行：

1. Docmost 启动测试。
2. 页面创建、编辑、保存、删除测试。
3. 附件上传测试。
4. Bridge webhook 投递测试。
5. Markdown export/import 测试。
6. 权限映射测试。
7. Cherry Web 端到端同步测试。

## 8. 回滚策略

如果 rebase 后 Bridge 不可用：

1. 回滚到上一稳定 Fork tag。
2. Docmost 进入只读维护模式。
3. Cherry Web Chat 继续使用上一成功索引。
4. 暂停 Docmost → Repo 回写。
5. 修复后重新执行同步 reconcile。
