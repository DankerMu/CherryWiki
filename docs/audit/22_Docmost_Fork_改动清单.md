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

## 5A. Fork 开发红线

1. **不得依赖 Docmost 私有/未导出 API**：Bridge 只通过 NestJS 公共 DI 容器获取 service（如 `PageService`、`AttachmentService`），禁止 import 未 export 的内部函数、直接操作 Drizzle schema 实例、或依赖特定文件内部结构。若需要的能力 Docmost 未暴露，应通过 EventEmitter 订阅或提 upstream PR，不得 monkey-patch。
2. **excludedPaths 最小化 + 安全兜底**：`/api/internal/bridge` 跳过 workspaceId 中间件是必要的（Bridge 非 workspace 上下文），但必须确保：
   - Bridge 路由全局绑定 `BridgeAuthGuard`（HMAC + Bearer 双重校验）
   - Docker 网络层限制：Bridge 端口仅服务网络（`cherry-net`）可达，不暴露给外部
   - 禁止在 excludedPaths 中添加非 Bridge 路径
3. **不新增 Drizzle migration**：Bridge 不创建新表、不修改现有表。需要的元数据（如事件发送状态）存在 Cherry API 侧。
4. **不引入新 npm 依赖**：除非 Docmost 已有的包不能满足需求（如 crypto 已内置则不需要额外库）。新增依赖需记录理由并在 rebase 时确认兼容性。

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

### 7.1 Bridge 契约测试

Bridge controller 必须有独立的契约测试套件（contract tests），确保 API 行为不因 rebase 而回归。测试覆盖：

| 测试场景 | 验证点 |
|---|---|
| 页面保存事件投递 | POST page-saved → Cherry API 收到正确 payload |
| 页面删除事件投递 | POST page-deleted → Cherry API 收到 event_id |
| 附件创建事件投递 | POST attachment-created → payload 包含 download_url |
| 页面导出 | GET export → 返回 Markdown + content_hash |
| 页面导入 | PUT import → 页面内容更新 + overwrite_policy 生效 |
| HMAC 鉴权成功 | 正确签名 → 200 |
| HMAC 鉴权失败 | 错误签名 → 401 |
| Bearer token 缺失 | 无 Authorization → 401 |
| 重放攻击防护 | timestamp 超 5 分钟 → 401 |
| 幂等处理 | 重复 event_id → 200 + deduplicated=true |
| 权限映射 | Cherry 权限变更 → Docmost Space 成员可见性同步 |

契约测试技术栈：NestJS Testing Module + supertest，mock Cherry API HTTP 回调。

### 7.2 Rebase 后自动验证

每次 upstream rebase **必须**自动执行以下 CI 流水线（不可手动跳过）：

```yaml
# .github/workflows/bridge-rebase-check.yml（位于 fork repo）
on:
  push:
    branches: [cherrygraph-bridge]

jobs:
  bridge-contract:
    steps:
      - Docmost 构建 + 启动
      - Bridge 契约测试全量执行（§7.1 所有场景）
      - Cherry API mock server 验证 webhook 投递
      - HMAC 鉴权正反向测试
      - 输出测试报告 + 覆盖率
```

Rebase 后 CI 不通过则禁止更新 submodule 引用。

### 7.3 手动验收（CI 之外）

CI 自动化覆盖 Bridge API 层。以下需手动验收：

1. Docmost 前端页面创建、编辑、保存、删除正常
2. 附件上传正常
3. Cherry Web Chat 端到端同步（上传 → Graphify → Wiki → Chat 引用）
4. 权限变更后 Docmost Space 可见性正确

## 8. 回滚策略

如果 rebase 后 Bridge 不可用：

1. 回滚到上一稳定 Fork tag。
2. Docmost 进入只读维护模式。
3. Cherry Web Chat 继续使用上一成功索引。
4. 暂停 Docmost → Repo 回写。
5. 修复后重新执行同步 reconcile。
