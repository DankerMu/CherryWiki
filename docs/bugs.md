# CherryWiki Bug 追踪（浏览器 E2E 轮次 2026-06-02）

> 本轮基于 agent-browser 真实浏览器逐项测试。旧轮次记录保留在 git 历史。
> 编号 `B2-NNN`。环境：13 容器 healthy，源码 `fd07dda` 重新打包。入口 http://localhost。
> 测试清单与结果：`docs/e2e-browser-run-2026-06-02.md`。

## 严重程度

| 级别 | 含义 |
|------|------|
| P0 | 阻塞核心路径，系统不可用 |
| P1 | 功能缺陷，影响主要使用 |
| P2 | 边界/体验问题 |

---

## 活跃 BUG

### B2-001：前端与反代容器长期停摆，API 镜像滞后源码 2 周（环境卫生）

- **级别**：P0（运维 / 测试可信度）
- **现象**：本轮开始时 `docker compose ps` 显示 `cherry-web`（Exited 7 天前，exit 1）与 `nginx`（Exited 7 天前）均未运行，`http://localhost`（nginx:80）完全不可达；`cherry-api` 运行镜像为 **2 周前**构建，而源码已前进到 `fd07dda`。
- **影响**：任何基于此环境的"功能已通过"结论都不可信——测的是停运/陈旧代码。这是"经过测试仍很多 bug"的最可能根因。
- **处置**：已 `docker compose up -d cherry-web nginx` 拉起，并对 `cherry-api/cherry-web/ingestion/url-fetcher/graphify` 用当前源码重新打包（`docker compose build` → `up -d`），13 容器全部 healthy 后重新测试。
- **后续**：需排查为何 web/nginx 会停摆 7 天（重启策略/健康检查/CI 部署流程），并建立"镜像与 `main` HEAD 一致性"校验，避免再次出现陈旧镜像。
- **状态**：[x] 环境已修复；根因（为何停摆/镜像滞后）待团队排查

### B2-002：6 项后端管理能力无前端路由（产品覆盖缺口）

- **级别**：P1
- **现象**：后端 API 已实现但 `apps/web` 路由表中**无对应页面**：
  - API Tokens（`/api/admin/api-tokens`）
  - MCP 工具（`/api/admin/mcp/tools`）
  - Feedback 队列（`/api/admin/feedback`）
  - Governance 治理（`/api/admin/governance/*`）
  - Proposals 提案（`/api/admin/proposals`）
  - Workers 状态（`/api/admin/workers`）
- **现有前端 admin 路由仅**：users / groups / spaces / models / audit / health / jobs / graphify。
- **影响**：管理员无法通过界面使用上述能力（只能调 API）。旧清单将这些标记为"已测通过"，实为 API 层验证，浏览器层根本无入口——属虚假覆盖。
- **修复方向**：补齐对应 Admin 页面与侧边栏入口，或在产品上明确这些为"API-only"能力并从验收范围剔除。
- **状态**：[ ] 待产品/前端决策

### B2-003：Graph Explorer 画布在 headless 下截图为空白（待真人复核）

- **级别**：P2（疑似 headless 伪影，需确认）
- **现象**：Graph Explorer 搜索/选中节点/展开邻居/社区列表数据层全部正常（Selection Details 正确显示 Label/Node type/Community/Score/ID）；但 agent-browser 截图中中央画布区为纯白。`canvas.getContext('2d').getImageData` 采样显示**确有渲染像素**（约 4783px，集中于 (332,188)-(427,271) 的 95×83 小区域），与"几个节点被画得很小/聚簇"一致。
- **判断**：更可能是 headless Chromium 对 canvas 的截图捕获伪影，而非功能缺陷；但渲染内容偏小也可能是 zoom-to-fit/布局问题。
- **修复方向**：用真人浏览器目视确认节点是否正常可见与可交互；若确实偏小，检查初始 zoom / fit-to-view 逻辑。
- **处置**：`GraphCanvas.tsx` 新增 useEffect，在 `graphData.nodes.length` 变化且非空时延迟 150ms 调用 `zoomToFit(400,48)`，使初次搜索/展开/社区切换载入数据后视口自动贴合内容（此前疑似缺少 fit-to-view 致内容偏小）。typecheck/lint/test 通过。
- **状态**：[x] 已补 fit-to-view；仍建议真人浏览器目视复核渲染效果

### B2-004：窄视口下侧边栏不折叠，布局横向溢出（响应式缺陷）

- **级别**：P2
- **现象**：`apps/web/src/components/AppShell.tsx:217` 的 `Layout.Sider` **未设置 `breakpoint` 属性**，仅靠手动按钮折叠（状态存 localStorage）。将视口设为 375×812 后，侧栏仍固定 264px 宽、不自动折叠，主内容区被压到 111px，`document.body.scrollWidth=495 > 375` 出现横向滚动条。
- **影响**：移动端/窄屏不可用。若产品定位为桌面端则为低优先级。
- **修复方向**：给 `Layout.Sider` 增加 `breakpoint="lg"` + `collapsedWidth`，或在窄屏切换为抽屉式导航。
- **处置**：`AppShell.tsx` 加 `breakpoint="lg"` + `onBreakpoint`；新增 `responsiveCollapsed` 状态与手动 `collapsed`（localStorage）分离，派生 `effectiveCollapsed = responsiveCollapsed || collapsed` 驱动 Sider 与全部折叠态视觉条件——窄屏自动折叠且**不污染用户手动折叠的持久化**。typecheck/lint/test 通过。
- **状态**：[x] 已修复（建议真机/窄屏目视复核）

### B2-005：Wiki unpublish / 文档删除 / 模型删除——后端有能力但前端无入口

- **级别**：P1（覆盖缺口）
- **现象**（源码核实）：
  - `apps/api/src/wiki/wiki.controller.ts:102` 有 `@Post(':pageId/unpublish')`，但 `WikiPageDetail.tsx` 只接了 `publish`，**无取消发布按钮**（且 publish 按钮仅 draft 状态显示，现有 2 页均 Published 故不可见）。
  - `apps/api/src/uploads/uploads.controller.ts` **无 `@Delete`**，且 `reprocess`（`POST uploads/:id/reprocess`）端点存在却无 UI 按钮，上传列表行仅有 "Details"。
  - `apps/api/src/models/model-config.controller.ts` **无 `@Delete`**，模型仅支持启停（软删）+ 编辑。
- **影响**：取消发布、文档删除/重处理、模型删除无法从 UI 完成。文档/模型"无硬删除"可能是有意的软删除设计；unpublish 与 reprocess 已有端点却无按钮则更像遗漏。
- **修复方向**：补 unpublish 与 reprocess 的 UI 按钮；明确文档/模型删除策略（软删 vs 硬删）。
- **处置**：
  - **Wiki 取消发布（已修）**：`wikiApi.ts` 补 `unpublish()`；`WikiPageDetail.tsx` 加 danger「取消发布」按钮，门控 `status==='published'` 且 `wiki:publish` 权限，发布/取消发布操作互斥 disabled，失败经页面 Alert 提示，成功后 `loadPage` 刷新；`en/zh-CN` locale 同步 `wiki.detail.unpublish/unpublishing`。
  - **上传重处理（已修）**：reprocess 接线本已存在于 `UploadDetail`，本次将按钮可见条件由仅 `parse_failed` 扩展为 `parse_failed || security_rejected`（两者均终态失败、后端 reprocess 接受）。
  - **硬删除（推迟，待产品决策）**：uploads / model-config 后端均无 `@Delete`，仅软删（归档/禁用）。硬删除属横切产品决策（数据保留/合规、审计留痕、误删风险、对集成方破坏性），不擅自实现。建议另立 issue：先界定可删对象与权限（建议 `space:admin` 或租户 admin）、是否设清除宽限期、审计要求，批准后再补后端 `@Delete`（带审计）+ 前端两步确认删除 + i18n。
  - typecheck/lint/test 全过（201 测试）。
- **状态**：[x] unpublish + reprocess 已接线；[ ] 硬删除待产品决策

---

## 本轮未复现/已确认正常（历史 bug 区域）

- BUG-005 页面刷新丢登录：**未复现**，F5 停留当前页。
- BUG-006 XLSX 误拒：无 office 样本未直接验证；MIME 拒绝逻辑对 `.py` 正常（UNSUPPORTED_FILE_TYPE）。
- BUG-007 无模型前置提示：当前有可用 chat model，未触发该分支。
- 登出/会话保护、Health 6+组件、Job error_json、i18n、主题/折叠持久化、Audit 记录：均正常。

## 第二批深测（写回类）已验证通过

- **用户管理**：禁用（→Disabled，带 Popconfirm）/编辑显示名/删除，列表实时更新；分组创建（绑定 chat:use+space:view 权限）+ 删除。
- **Space 配置**：创建 Space、strict_knowledge_only 开关关闭抽屉重开 round-trip 持久、Rebuild Index 入队两条 Reindex job 均 Succeeded(snapshot_activated)、归档 Space→archived（坐实 §6.2 重建后状态更新）。
- **上传**：Status 过滤（20→2 行 Parse Failed）、详情抽屉全字段（SHA256/error_type/metadata JSON）完整。
- **Chat**：多轮上下文保持（"its"正确指代 RAG）、检索模式切换到 Graph first（走 Agent 路径正常回答）、session 新建/切换/删除（18↔17）。
- **Model**：新增（rerank 类型入列表）、禁用（→Disabled）、编辑显示名、连通性测试均生效。

> 说明：上述操作产生的测试数据（用户/分组/临时 Space/测试模型）已清理或置为 Disabled/archived，不影响后续使用。

---

## 已知覆盖缺口

见 B2-002。
