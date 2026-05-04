# Stage 8 — Phase 1 E2E 测试清单

> 测试环境：`docker compose up -d`（全服务），admin / `Admin123!@#`
> 标记：API = curl/脚本，UI = agent-browser，DB = psql 验证

---

## A. Auth / Session（Stage 1）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| A1 | 正确凭据登录 | API | 返回 access_token + refresh_token | |
| A2 | 错误密码登录 | API | 401 INVALID_CREDENTIALS | |
| A3 | 连续 5 次错误 → 账号锁定 | API | ACCOUNT_LOCKED + Redis key 存在 | |
| A4 | Token refresh | API | 新 access_token，旧 token 失效 | |
| A5 | Logout | API | session 标记 revoked，token 不可用 | |
| A6 | GET /auth/me | API | 返回当前用户 email/role/groups | |
| A7 | GET /auth/sessions | API | 返回活跃会话列表，标记当前会话 | |
| A8 | DELETE /auth/sessions/{id} | API | 撤销指定会话，只能撤本人 | |
| A9 | 修改密码 | API | 旧密码校验 + 新密码强度 + 审计 auth.password_change | |
| A10 | 过期 token 访问 | API | 401 TOKEN_EXPIRED | |

## B. User / Group / RBAC（Stage 1）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| B1 | Admin 创建用户 | API+UI | 新用户可登录，审计 admin.user.create | |
| B2 | Admin 编辑用户（改角色） | API+UI | role 变更生效 | |
| B3 | Admin 禁用用户 | API+UI | status=disabled，会话撤销，permission_version+1 | |
| B4 | 非 Admin 访问 /admin/* | API | 403 FORBIDDEN | |
| B5 | 创建 Group | API+UI | Group 可见，成员列表空 | |
| B6 | Group 添加成员 | API+UI | 成员获得 Group 关联的 Space 权限 | |
| B7 | Group 移除成员 | API+UI | 成员立即失去 Space 权限，permission_version+1 | |
| B8 | Group 授权 Space 读取 | API+UI | Group 成员可访问 Space | |

## C. Space 管理（Stage 1）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| C1 | 创建 Space | API+UI | Space 可见，审计 space.create | |
| C2 | 更新 Space 配置 | API | strict_knowledge_only 可切换 | |
| C3 | Space 列表按权限过滤 | API | 无权限用户看不到 Space | |
| C4 | Space 详情含配置 | API | 返回 strict_knowledge_only / repo_path / index_status | |
| C5 | Space 权限管理 | API+UI | space:admin 可修改 Group 授权 | |
| C6 | Space 统计 | API | 返回 page/source/node/edge 计数 | |

## D. 文件上传 / 归档 / 解析（Stage 3）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| D1 | 上传 PDF → quarantine → archive | API | file_blob + source_document 创建，ingestion job 入队 | |
| D2 | 上传后 ingestion 完成 | API+DB | source_document.status=parsed，parsed_uri 非空 | |
| D3 | 去重上传（同 SHA256） | API | 返回已有 source_document_id，无新 blob | |
| D4 | 大文件 >50MB 分层 | API | job priority=low，不阻塞小文件 | |
| D5 | 解析失败保留原件 | API+DB | status=parse_failed，原件仍在 MinIO archive | |
| D6 | Reprocess 失败文件 | API | 新 ingestion job 创建，status 重置 | |
| D7 | 上传 URL（source_type=url） | API | 创建 url_fetch job，无 file_blob | |
| D8 | Upload Center UI | UI | 文件列表、状态、错误信息可见 | |

## E. 安全上传验证（Stage 3）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| E1 | ELF 伪装 PDF（magic bytes） | API | MIME_MISMATCH 拒绝 | |
| E2 | Shell 伪装 txt | API | MIME_MISMATCH 拒绝 | |
| E3 | ZIP bomb（压缩比超限） | API | ZIP_BOMB_DETECTED 拒绝 | |
| E4 | ZIP 路径穿越 (../../) | API | PATH_TRAVERSAL 拒绝 | |
| E5 | ZIP 嵌套 >3 层 | API | ZIP_NESTING_EXCEEDED 拒绝 | |
| E6 | ZIP symlink | API | 拒绝 | |
| E7 | SSRF localhost | API+Worker | Worker 拒绝，job failed | |
| E8 | SSRF 169.254.169.254 | API+Worker | SsrfBlockedError，block_reason=link_local_metadata | |
| E9 | SSRF 重定向到内网 | Worker 测试 | redirect_to_private_ip 拒绝 | |
| E10 | SSRF IPv6 mapped (::ffff:10.0.0.1) | Worker 测试 | ipv4_mapped_ipv6_private 拒绝 | |

## F. Graphify Pipeline（Stage 5）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| F1 | 触发 Graphify run | API | run 创建，graphify job 入队 | |
| F2 | Graphify 完成 → graph/wiki 导入 | DB | graph_nodes/edges 有数据，wiki_pages 生成 | |
| F3 | Graphify 失败 → 回滚 | DB | active_index_snapshot 不变，run.status=failed | |
| F4 | Graphify 输出超限 → quarantine | DB | status=quarantine，error_json 有详情 | |
| F5 | Cancel Graphify run | API | status=cancelled，无导入 | |
| F6 | Retry failed run | API | 新 job 创建，可重跑 | |
| F7 | 批量 5 文件合并 1 run | API | 单个 graphify job 包含 5 个 source | |
| F8 | Validation report 查看 | API+UI | report 含 check results/counts/sizes | |
| F9 | Graphify Runs UI | UI | 列表、状态、详情页可访问 | |

## G. Wiki 功能（Stage 4-5）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| G1 | Wiki 页面列表（分页） | API+UI | 返回 page_id/title/status，翻页正确 | |
| G2 | 按 status 筛选（published/draft） | API+UI | 筛选结果正确 | |
| G3 | 搜索关键词匹配标题 | API+UI | 返回匹配页面 | |
| G4 | 页面详情（GFM Markdown） | API+UI | 表格/代码块/任务列表渲染正确 | |
| G5 | 版本历史（时间倒序） | API+UI | 版本列表正确，可查看旧版本 | |
| G6 | 发布 draft → published | API+UI | status 变更，current_version_id 更新，审计写入 | |
| G7 | 回滚到旧版本 | API+UI | 新版本 source=rollback，审计写入 | |
| G8 | 空 Space 空状态 UI | UI | 显示 "No wiki pages in this space yet." | |
| G9 | 跨 Space 权限隔离 | API | 无权限用户请求返回 403 | |

## H. 索引构建（Stage 6）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| H1 | Publish 后自动触发索引 | DB | wiki_chunks + embeddings 生成 | |
| H2 | index_snapshot status=activated | DB | 仅一个 activated snapshot per space | |
| H3 | 索引只含 published 页面 | DB | draft 页面无 chunk | |
| H4 | Admin 手动触发 reindex | API | 新 snapshot 创建 | |

## I. Chat / RAG / SSE（Stage 7）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| I1 | Chat 基本问答 + citations | API+UI | SSE 流式响应，citations 非空 | |
| I2 | Citation 引用 Published Wiki | API | page_id 指向已发布页面 | |
| I3 | Citation 点击跳转 Wiki | UI | 引用卡片可点击，跳转到 wiki 页面 | |
| I4 | 无知识（strict）→ no_hit | API | 返回 "未找到相关知识"，0 tokens | |
| I5 | 无知识（relaxed）→ model_knowledge | API | 返回模型回答，标注非知识库来源 | |
| I6 | 多轮对话 | API+UI | 同 session_id 保持上下文 | |
| I7 | 新建 Chat 会话 | UI | New Chat 按钮，创建新 session | |
| I8 | 切换会话 | UI | 左侧会话列表点击切换 | |
| I9 | 删除会话 | UI | 会话从列表移除 | |
| I10 | Chat 会话列表 API | API | GET /chat/sessions 返回分页列表 | |
| I11 | Chat 会话历史 API | API | GET /chat/sessions/{id} 返回消息历史 | |
| I12 | 未发布页面不出现在 Chat | API | draft 内容不被引用 | |
| I13 | Source Doc 不直接检索 | API | 未 Graphify 的文件不出现 | |
| I14 | SSE 事件格式完整 | API | session → content* → citations → usage → [DONE] | |
| I15 | Prompt injection 不泄露系统 prompt | API | 注入内容不改变系统行为 | |

## J. Job / Task 系统（Stage 2）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| J1 | Job 详情查看 | API | 返回 status/progress/error/created_at | |
| J2 | Job 事件时间线 | API | GET /jobs/{id}/events 返回有序事件 | |
| J3 | Job 取消（pending） | API | 直接 cancelled，记录 status_changed | |
| J4 | Job 取消（running） | API | cancel_requested_at 设置，幂等 | |
| J5 | Worker 心跳超时 → 任务释放 | DB | locked_at 过期后可被重取 | |
| J6 | Task Center UI | UI | 任务列表、筛选、详情、取消操作 | |

## K. 模型管理（Stage 1）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| K1 | 模型列表 | API+UI | 显示已配置模型 | |
| K2 | 添加新模型 | API+UI | 新模型入库 | |
| K3 | 模型连通性测试 | API+UI | 返回 reachable/latency/error | |
| K4 | 单一 embedding 模型约束 | API | 不允许同时启用多个 embedding 模型 | |

## L. 审计日志（Stage 1-7）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| L1 | 审计日志列表（分页筛选） | API+UI | 按 action/user/time 可筛选 | |
| L2 | 登录/登出事件 | DB | auth.login / auth.logout 记录 | |
| L3 | Space 操作事件 | DB | space.create / space.update / space.permission_change | |
| L4 | Wiki 操作事件 | DB | wiki.page.publish / wiki.page.rollback | |
| L5 | 上传安全拒绝事件 | DB | upload.rejected + MIME_MISMATCH/ZIP_BOMB 等 | |
| L6 | Chat 完成事件 | DB | chat.completion + token_count + citations_count | |
| L7 | Graphify 事件 | DB | graphify.run.created/completed/failed | |

## M. System Health（Stage 1）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| M1 | GET /admin/system/health | API+UI | DB/Redis/MinIO 状态 healthy | |
| M2 | 未部署组件状态 | API | 返回 not_configured（非 unhealthy） | |
| M3 | MinIO 连通性 | API | bucket 可访问，presigned URL 可用 | |

## N. 权限撤销即时生效（§4.1）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| N1 | 授权 → Chat 可用 → 撤权 → 5s 内 Chat 不可用 | API | 撤权后 Chat 返回空/no_hit | |
| N2 | 授权 → Wiki 可访问 → 撤权 → Wiki 403 | API | 权限版本递增，缓存失效 | |
| N3 | permission_version 递增验证 | DB | 每次权限变更 version+1 | |

## O. Docker / 部署 / 合规（Stage 8）

| # | 场景 | 方法 | 预期 | 状态 |
|---|------|------|------|------|
| O1 | docker compose up -d 单命令启动 | Bash | 全部服务 healthy | |
| O2 | 自动 migration + seed | 日志 | entrypoint 日志显示 migrate + seed 成功 | |
| O3 | LICENSE 文件存在 | 文件 | AGPL-3.0 全文 | |
| O4 | nginx Phase 1 配置 | 文件 | /api/* 代理到 API，/ 代理到 web | |
| O5 | env.example 完整 | 文件 | 所有必需变量有说明 | |

## P. 性能基准（建议 staging 环境）

| # | 场景 | 目标 | 状态 |
|---|------|------|------|
| P1 | Chat 首 token P95 | < 3s | |
| P2 | 纯 vector 检索 P95 | < 500ms | |
| P3 | BM25 检索 P95 | < 500ms | |
| P4 | 混合检索 P95 | < 1.0s | |
| P5 | Wiki 页面加载 P95 | < 1.5s | |

---

## 统计

- **A 组（Auth/Session）**: 10 项
- **B 组（User/Group/RBAC）**: 8 项
- **C 组（Space）**: 6 项
- **D 组（上传/解析）**: 8 项
- **E 组（安全上传）**: 10 项
- **F 组（Graphify）**: 9 项
- **G 组（Wiki）**: 9 项
- **H 组（索引）**: 4 项
- **I 组（Chat/RAG）**: 15 项
- **J 组（Job 系统）**: 6 项
- **K 组（模型管理）**: 4 项
- **L 组（审计日志）**: 7 项
- **M 组（System Health）**: 3 项
- **N 组（权限撤销）**: 3 项
- **O 组（部署/合规）**: 5 项
- **P 组（性能基准）**: 5 项

**总计：112 项 E2E 测试**
