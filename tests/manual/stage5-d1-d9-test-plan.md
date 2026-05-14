# Stage 5 D1-D9 手动测试执行计划

## 前置条件

Stage 5 全部 issue (#84-#91) 已合并。Docker 环境已运行。

## Step 0: 修复 Graphify Worker 基础设施

### 0.1 安装 Graphify CLI 到 Docker 容器

graphify-worker 的 Dockerfile 缺少 Graphify CLI 安装。需要修改：

```dockerfile
# apps/graphify-worker/Dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Graphify CLI from GitHub at pinned ref
ARG GRAPHIFY_REF=7359cdace9a098ba8acf29d84d6c4bc1bab0e3b0
RUN pip install --no-cache-dir "git+https://github.com/safishamsi/graphify.git@${GRAPHIFY_REF}"

COPY src/ src/

EXPOSE 9094
CMD ["python", "-m", "src"]
```

同时修改 `docker-compose.yml` 中 graphify-worker 服务，从 `image: python:3.11-slim` + inline pip install 改为使用 Dockerfile build：

```yaml
graphify-worker:
  build:
    context: ./apps/graphify-worker
    dockerfile: Dockerfile
    args:
      GRAPHIFY_REF: ${GRAPHIFY_PINNED_REF:-7359cdace9a098ba8acf29d84d6c4bc1bab0e3b0}
  restart: unless-stopped
  working_dir: /app/apps/graphify-worker
  # 删除 command 行（Dockerfile CMD 已定义）
  # 删除 image 行
```

### 0.2 已修复的 Worker Bug（本 session 已完成）

以下修复已在本 session 中完成但**未提交**，需要在新 session 中提交：

1. **`docker-compose.yml`**:
   - graphify-worker 添加 `WORKER_API_KEY` 环境变量
   - graphify-worker 的 `API_BASE_URL` 从 `http://cherry-api:8080` 改为 `http://cherry-api:8080/api`
   - 添加 `CHERRY_API_URL`、`MINIO_*` 环境变量

2. **`apps/graphify-worker/src/job_client.py`**:
   - `poll_jobs()` 添加 `api_key` 参数，构造 `x-worker-key` header
   - `_parse_pending_job()` 添加 `payload.get("data")` 解析（API 返回 `{"data": [...]}` 格式）
   - `_fail_job()` endpoint 从 `/internal/jobs/{id}/failed` 改为 `/internal/jobs/{id}/fail`

3. **`apps/graphify-worker/src/main.py`**:
   - 读取 `WORKER_API_KEY` 环境变量并传给 `poll_jobs()`

### 0.3 重建并启动

```bash
# 重建 graphify-worker 镜像
docker compose build graphify-worker

# 重启
docker compose up -d graphify-worker

# 验证 worker 能 poll 到 jobs
docker logs cherrywiki-graphify-worker-1 --tail 10
# 期望看到: HTTP/1.1 200 OK（不是 404 或 401）
```

## Step 1: 上传文档 + 触发 Graphify

```bash
# 登录获取 token
TOKEN=$(curl -s http://localhost:8081/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<seed-admin-email>","password":"<seed-admin-password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

SPACE_ID="13c14ba5-1944-4f28-8e27-2a298a5028b5"

# 上传测试文档（需要 ≥5 个有实质内容的文档让 Graphify 产生足够节点）
for f in tests/fixtures/test-corpus-small/parsed-*.md; do
  curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/uploads" \
    -H "Authorization: Bearer $TOKEN" \
    -F "file=@$f" \
    -F 'metadata={"processing_strategy":"immediate"}'
done

# 等待 ingestion 完成（约 30-60s）
# 检查：所有 ingestion job status=succeeded
curl -s "http://localhost:8081/api/admin/jobs?type=ingestion&status=pending" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 创建 Graphify run
curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/graphify/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"full","trigger_type":"manual"}'

# 监控 Graphify run 状态（可能需要几分钟）
watch -n 10 "curl -s 'http://localhost:8081/api/graphify/runs?space_id=$SPACE_ID' \
  -H 'Authorization: Bearer $TOKEN' | python3 -c \"import sys,json; [print(r['status'], r['run_id'][:8]) for r in json.load(sys.stdin)['data']]\""

# 期望结果：run status = succeeded, wiki pages visible
curl -s "http://localhost:8081/api/spaces/$SPACE_ID/wiki/pages?per_page=50" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Total wiki pages: {d[\"meta\"][\"pagination\"][\"total\"]}')"
```

## Step 2: D1-D9 手动验证（使用 agent-browser）

Web 应用地址：`http://localhost` (nginx) 或 `http://localhost:5174` (direct vite)

### D1: Wiki 页面列表 — 分页、状态筛选、搜索

```bash
# 登录
agent-browser open http://localhost/login
agent-browser snapshot -i
# 填写 <seed-admin-email> / <seed-admin-password>
agent-browser fill @eXX "<seed-admin-email>"
agent-browser fill @eXX "<seed-admin-password>"
agent-browser click @eXX  # Login button
agent-browser wait --load networkidle

# 导航到 Wiki
agent-browser open "http://localhost/spaces/$SPACE_ID/wiki"
agent-browser wait --load networkidle
agent-browser screenshot /tmp/d-test/d1-wiki-list.png

# 验证：
# 1. 分页翻页正确（如果 >20 页，应有分页控件）
# 2. status=published 筛选仅显示已发布
# 3. 搜索关键词匹配标题
agent-browser snapshot -i
# 找到搜索框或状态筛选，验证功能
```

### D2: Wiki 页面详情 — GFM Markdown 渲染

```bash
# 点击任意一个 wiki 页面
agent-browser open "http://localhost/spaces/$SPACE_ID/wiki/<page_id>"
agent-browser wait --load networkidle
agent-browser screenshot /tmp/d-test/d2-wiki-detail.png

# 验证：表格渲染正确，代码块有语法高亮，任务列表有 checkbox
```

### D3: Wiki 版本历史 — 切换版本查看

```bash
# 打开有多版本的页面的 history
agent-browser open "http://localhost/spaces/$SPACE_ID/wiki/<page_id>/history"
agent-browser wait --load networkidle
agent-browser screenshot /tmp/d-test/d3-version-history.png

# 验证：点击旧版本显示对应内容，返回当前版本正确
```

### D4: 发布操作 — draft → published

```bash
# 通过 API 验证（UI 中可能需要 publish 按钮）
curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/wiki/pages/<draft_page_id>/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"version_id":"<version_id>"}'

# 验证：status=published, current_version_id 更新
# 验证审计日志：
curl -s "http://localhost:8081/api/admin/audit-logs?action=wiki.page.publish&per_page=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### D5: 回滚操作 — 创建新版本

```bash
# 回滚到旧版本
curl -s -X POST "http://localhost:8081/api/spaces/$SPACE_ID/wiki/pages/<page_id>/rollback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target_version_id":"<old_version_id>"}'

# 验证：新版本 source=rollback, status=published
# 验证审计日志：wiki.page.rollback
```

### D6: 路由导航完整性

```bash
agent-browser open "http://localhost/spaces/$SPACE_ID/wiki"
agent-browser screenshot /tmp/d-test/d6-wiki-list-route.png

agent-browser open "http://localhost/spaces/$SPACE_ID/wiki/<page_id>"
agent-browser screenshot /tmp/d-test/d6-wiki-detail-route.png

agent-browser open "http://localhost/spaces/$SPACE_ID/wiki/<page_id>/history"
agent-browser screenshot /tmp/d-test/d6-wiki-history-route.png

# 验证：三级路由跳转正常
```

### D7: 空状态 UI

```bash
# 需要一个没有 wiki 页面的空 Space
# 先创建一个新 Space
NEW_SPACE=$(curl -s -X POST "http://localhost:8081/api/spaces" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Empty Test Space","slug":"empty-test"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")

agent-browser open "http://localhost/spaces/$NEW_SPACE/wiki"
agent-browser wait --load networkidle
agent-browser screenshot /tmp/d-test/d7-empty-state.png

# 验证：显示 "No wiki pages in this space yet."
```

### D8: 跨 Space 权限隔离

```bash
# 创建无权限用户（需要先创建一个 viewer 用户，不授权 Space B）
# 然后用该用户请求 Space A 的 wiki pages
# 期望：返回 403

curl -s "http://localhost:8081/api/spaces/<other_space_id>/wiki/pages" \
  -H "Authorization: Bearer $VIEWER_TOKEN"
# 验证：403 Forbidden
```

### D9: Publish/Rollback 权限门控

```bash
# 用无 wiki:publish 权限的用户访问页面
# 验证：发布/回滚按钮不显示
# 注：当前前端权限 API 未就绪，标记为 deferred
```

## Step 3: 截图存档

```bash
# 所有截图保存在 /tmp/d-test/
ls -la /tmp/d-test/

# 复制到项目目录
mkdir -p tests/screenshots/stage5-d1-d9
cp /tmp/d-test/*.png tests/screenshots/stage5-d1-d9/
```

## Step 4: 提交基础设施修复

上述 graphify-worker 的 bug 修复需要作为独立 commit 提交：

```bash
git add docker-compose.yml apps/graphify-worker/src/job_client.py apps/graphify-worker/src/main.py apps/graphify-worker/Dockerfile
git commit -m "fix(graphify-worker): add CLI install, API auth, response parsing, MinIO env

- Dockerfile: install graphify CLI from GitHub at pinned ref
- docker-compose: add WORKER_API_KEY, fix API_BASE_URL prefix, add MinIO env
- job_client: add x-worker-key header, parse {data:[]} response, fix fail endpoint
- main: pass WORKER_API_KEY to poll_jobs"
```

## 未提交的代码变更清单

以下文件在本 session 中已修改但未 commit/push，需要在新 session 中处理：

| 文件                                     | 变更                                                           | 状态                       |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------- |
| `docker-compose.yml`                     | graphify-worker 添加 WORKER*API_KEY/MINIO*\*/API_BASE_URL 修复 | 已修改未提交               |
| `apps/graphify-worker/src/job_client.py` | api_key header + data[] 解析 + fail endpoint                   | 已修改未提交               |
| `apps/graphify-worker/src/main.py`       | 传递 WORKER_API_KEY                                            | 已修改未提交               |
| `apps/graphify-worker/Dockerfile`        | **需要修改**：添加 graphify CLI 安装                           | 待修改                     |
| `.env`                                   | 添加了完整配置（MODEL_API_KEY 等）                             | 已修改未提交（.gitignore） |

## 注意事项

- `.env` 包含 API key（`sk-GmcMPU...`），不要提交到 git
- Graphify CLI 需要 LLM API 才能运行（已配置 deepseek-v4-flash via dmxapi.cn）
- D9 标记为 deferred（前端权限 API 未就绪）
- DB 中可能有之前 seed 的测试 wiki 数据（25 条），如果 Graphify 跑通可以先清理再测
