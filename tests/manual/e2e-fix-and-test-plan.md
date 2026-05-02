# 端到端修复与测试计划

> 生成时间：2026-05-02 | 基于上一 session 的排查结果

## 一、待修复问题清单

### Fix-1: ingestion-worker 缺少 NO_PROXY 环境变量（阻塞级）

**现象：** ingestion-worker 启动后立即 poll 失败，反复退出重启。日志：
```
HTTPConnectionPool(host='cherry-api', port=8080): Max retries exceeded ... Connection refused
```

**根因：** `.env` 全局设了 `HTTP_PROXY=http://egress-proxy:3128`，ingestion-worker 的 `docker-compose.yml` 没有设 `NO_PROXY`。Python `requests.Session()` 读取环境变量，把发往 `cherry-api`（内部服务）的请求路由到 egress-proxy，被拒绝。

对比：`url-fetcher-worker` 正确设了 `NO_PROXY: cherry-api,minio,localhost,127.0.0.1`。

**修复：** `docker-compose.yml` ingestion-worker 服务的 environment 添加：
```yaml
  ingestion-worker:
    environment:
      # ... 已有的 ...
      HTTP_PROXY: ${HTTP_PROXY:-http://egress-proxy:3128}
      HTTPS_PROXY: ${HTTPS_PROXY:-http://egress-proxy:3128}
      NO_PROXY: ${NO_PROXY:-cherry-api,minio,localhost,127.0.0.1}
```

**验证：**
```bash
docker compose restart ingestion-worker
sleep 10
docker logs cherrywiki-ingestion-worker-1 --tail 5
# 期望：不再看到 "Connection refused"，正常 poll（200 OK 或 "no pending jobs"）
```

### Fix-2: indexer-worker 同样检查 NO_PROXY（预防级）

indexer-worker 也可能有同样问题。检查并添加。

```bash
grep -A 20 "indexer-worker:" docker-compose.yml | grep "NO_PROXY"
```

如果没有，同样添加。

### Fix-3: 上传文件 security_rejected 排查

**现象：** 上传 .md/.txt 文件返回 `status: security_rejected`。

**排查步骤：** Fix-1 修复后重新上传，看是否因为 ingestion-worker 未处理导致的中间状态问题。如果仍然 rejected：

1. 检查 API 日志中具体的 rejection 原因：
   ```bash
   docker logs cherrywiki-cherry-api-1 2>&1 | grep -A 2 "security_rejected\|MIME_MISMATCH\|quarantine"
   ```
2. 对照 `apps/api/src/uploads/validators/mime-validator.ts` 的逻辑
3. 中文 UTF-8 文件的 magic bytes 以 `0xEF 0xBB 0xBF`（BOM）或中文字符开头，可能被 `file-type` 库识别为 `application/octet-stream`
4. 解决方案可能是：确保 `.md`/`.txt` 走 `validatePlainText()` 路径（line 110），不走 magic bytes 检测

### Fix-4: graphify-worker Dockerfile 未应用（来自上一 session 测试计划 Step 0）

**现象：** 测试计划 Step 0.1 要求给 graphify-worker 创建 Dockerfile 安装 graphify CLI。

**当前状态：** `apps/graphify-worker/Dockerfile` 可能不存在或不完整。

**修复：** 确保 Dockerfile 包含 graphify CLI 安装：
```dockerfile
ARG GRAPHIFY_REF=7359cdace9a098ba8acf29d84d6c4bc1bab0e3b0
RUN pip install --no-cache-dir "git+https://github.com/safishamsi/graphify.git@${GRAPHIFY_REF}"
```

同时确保 `docker-compose.yml` 中 graphify-worker 使用 `build:` 而非 `image:`。

## 二、端到端测试计划

### 前置条件

- Fix-1 ~ Fix-4 全部完成
- `docker compose down && docker compose up -d` 全量重启
- 所有服务 healthy（`docker compose ps` 确认）

### E2E-1: 文件上传 + Ingestion

```bash
TOKEN=$(curl -s http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@cherrywiki.local","password":"ChangeMe123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")
SPACE_ID="13c14ba5-1944-4f28-8e27-2a298a5028b5"

# 上传 5 个测试文件
for f in tests/fixtures/test-corpus-small/parsed-*.md; do
  curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/uploads" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$f;type=text/markdown" \
    -F 'metadata={"processing_strategy":"immediate"}'
done

# 等 30-60s，检查 ingestion jobs
curl -s "http://localhost:8081/api/admin/jobs?type=ingestion&per_page=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
for j in json.load(sys.stdin)['data']:
    print(f'{j[\"id\"][:8]}... type={j[\"type\"]} status={j[\"status\"]}')"
```

**验收：** 全部 ingestion job status=succeeded，source_documents status=parsed

### E2E-2: Graphify 运行

```bash
# 创建 Graphify run
curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/graphify/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"full","trigger_type":"manual"}'

# 监控（可能 5-15 分钟）
watch -n 30 "curl -s 'http://localhost:8081/api/graphify/runs?space_id=$SPACE_ID' \
  -H 'Authorization: Bearer $TOKEN' | python3 -c \"import sys,json; [print(r['status'], r['run_id'][:8]) for r in json.load(sys.stdin)['data']]\""

# 检查 worker 日志
docker logs cherrywiki-graphify-worker-1 --tail 20
```

**验收：** run status=succeeded，新 wiki 页面生成

### E2E-3: Wiki 页面可见性

```bash
# 检查新生成的 wiki 页面
curl -s "http://localhost:8081/api/spaces/$SPACE_ID/wiki/pages?per_page=50" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(f'Total pages: {d[\"meta\"][\"pagination\"][\"total\"]}')"
```

**验收：** Graphify 产生的新 wiki 页面出现在列表中

### E2E-4: Publish → Index → Embedding

```bash
# 发布一个 draft 页面
PAGE_ID="<从 E2E-3 获取的 draft page_id>"
VERSION_ID="<current_version_id>"
curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/wiki/pages/$PAGE_ID/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"version_id\":\"$VERSION_ID\"}"

# 等 indexer 处理（30-60s）
# 检查 indexer job
curl -s "http://localhost:8081/api/admin/jobs?type=indexer&per_page=5" \
  -H "Authorization: Bearer $TOKEN"

# 检查 indexer worker 日志
docker logs cherrywiki-indexer-worker-1 --tail 20
```

**验收：** indexer job succeeded，embedding 向量生成

### E2E-5: Chat RAG 引用

```bash
# 发起 Chat（引用已索引的 wiki 内容）
curl -s -X POST "http://localhost:8081/api/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"请介绍一下系统的认证设计"}],
    "space_id": "'$SPACE_ID'"
  }'
```

**验收：** 回复包含 citations，引用了 wiki 内容

## 三、已完成的修复（上一 session，未提交）

| 文件 | 变更 | 需要提交 |
|------|------|----------|
| `apps/web/Dockerfile` | 新建：cherry-web Dockerfile 化 | 是 |
| `docker-compose.yml` | cherry-web 改 build + graphify-worker env 修复 + 删 web volumes | 是 |
| `packages/auth-core/src/constants.ts` | admin 角色添加 wiki:publish/wiki:rollback | 是 |
| `ops/nginx/nginx.conf` | CSP unsafe-inline + Host header | 是 |
| `apps/web/src/lib/auth.tsx` | AuthUser 扩展 spaces + hasSpacePermission | 是 |
| `apps/web/src/pages/wiki/WikiPageDetail.tsx` | Publish 按钮权限检查 | 是 |
| `apps/web/src/pages/wiki/WikiVersionHistory.tsx` | Rollback 按钮权限检查 | 是 |
| `apps/web/src/__tests__/App.test.tsx` | 适配 /auth/me 调用 | 是 |
| `apps/web/src/__tests__/wiki.test.tsx` | AuthProvider wrapper + mock | 是 |
| `.env` | DEFAULT_EMBEDDING_MODEL 改为 text-embedding-3-small | 否（.gitignore） |

## 四、LLM 模型配置（已在 DB 中）

| 模型 | ID | Provider | Type |
|------|-----|----------|------|
| OpenAI Embedding Small | `75515e96-d510-41c2-a512-3036350661a0` | openai | embedding |
| Deepseek Flash | `4a4d3407-00e4-4dff-8546-5a3e8731964d` | openai | chat |

两个模型连通性测试已通过（`reachable: true`）。

## 五、执行顺序

1. 提交上一 session 的修复（第三节）
2. 修复 Fix-1 ~ Fix-4
3. `docker compose down && docker compose up -d`
4. 验证所有服务 healthy
5. 执行 E2E-1 → E2E-5
6. 截图存档到 `tests/screenshots/e2e/`
