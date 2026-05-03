## Context

Stage 4 交付了 Canonical Wiki Repo、wiki-core 领域逻辑和只读 Wiki 浏览。当前系统有完整的上传→解析管线（Stage 3），有 Wiki 页面骨架（Stage 4），但缺少中间环节：Graphify 执行和输出导入。

已有基础设施：
- SQL schema（`schema.sql`）已定义全部 Stage 5 相关表：graphify_runs、graph_nodes/edges/communities、graph_node_aliases/merges、graph_reports、page_block_metadata、graph_evidence_refs、index_snapshots
- OpenAPI 已定义 Graphify 和 Graph 端点（8 个 space 级 + 2 个 admin 级）
- `packages/graph-core/` 是空壳（`export {}`）
- `apps/graphify-worker/` 有骨架（main.py + job_client.py + health.py + lock.py），runner.py 是 no-op
- `packages/wiki-core/` 已有 frontmatter/slug/pageId/sections/state-machine，缺 normalization 子模块
- `packages/shared/src/schema/core.ts` 无 graphify/graph 相关 Drizzle 表
- 测试夹具已准备：`tests/fixtures/test-graphify-output/`（graph.json + wiki/ + GRAPH_REPORT.md）
- Graphify 输出 Schema 契约已完整定义（Doc 21）

## Goals / Non-Goals

**Goals:**
- 将 graphify_runs / graph_nodes / graph_edges / graph_communities / graph_node_aliases / graph_node_merges / graph_reports / page_block_metadata / graph_evidence_refs / index_snapshots 纳入 Drizzle schema + Zod validation + 全部索引
- 实现 graph-core package：graph.json 解析/校验（兼容 v0.5.3 实际输出）、stable_key 计算（Doc 21 §8A.3）、双置信度映射、community 归并、graph 数据写入
- 实现 graphify-worker 实际执行：manifest 生成、CLI 子进程调用、输出上传 MinIO、quarantine/shrink guard
- 实现 wiki-core normalization：页面类型识别 → frontmatter 生成 → 目录归类 → block ownership → page_block_metadata → 冲突合并
- 实现 Graphify API（9 个端点 per OpenAPI）和 Admin UI
- graph 数据仅入库存储和管理员查看，Phase 1 检索链路不走 graph path

**Non-Goals:**
- GraphRAG 检索（Phase 3）
- Graph path 查询 API（Stage 11）
- Indexer / Vector / BM25（Stage 6）
- Chat 引用（Stage 7）
- Docmost 双向同步（Phase 2）
- Wiki 编辑能力（Phase 2）
- graph_node_merges 实际合并操作（Phase 4 知识治理）
- 多 embedding 模型并存
- Community summary 生成（Phase 3）

## Decisions

### D1: graph-core 定位为 TypeScript 纯领域逻辑 package

**选择**: graph-core 不依赖框架，只暴露解析器、校验器和 repository interface

**理由**: 与 wiki-core、auth-core、job-core 一致。graph-core 被 API 层和未来 indexer-worker 复用。

**暴露内容**:
- `parseGraphJson(json)`: 解析 Graphify graph.json，返回类型化结构
- `validateGraphOutput(parsed)`: schema 校验，返回 errors/warnings
- `computeStableKey(spaceId, normLabel, nodeType)`: 跨 run 稳定键
- `mapConfidence(label, rawScore)`: 双置信度映射
- `mergeCommunities(nodes)`: 从节点 community 字段归并 community 列表
- `GraphImportService`: 协调 graph 数据写入（nodes → edges → communities → aliases）

### D2: graphify-worker 通过子进程调用 Graphify CLI

**选择**: 使用 `subprocess.run()` 调用 `graphify` CLI，不作为 Python library 导入

**理由**: Doc 21 §4 明确规定 "graph-core 不直接依赖 Graphify 内部 Python 类，只读取文件契约"。子进程隔离保证 Graphify 升级不影响 Worker 框架。

**流程**:
```
1. 从 MinIO 下载 parsed.md 文件到本地工作目录
2. 生成 graphify_input_manifest.json
3. subprocess.run(['graphify', '--wiki', '--mode', mode, '--output', outdir, ...])
4. 校验输出目录（graph.json / wiki/ / GRAPH_REPORT.md 存在性）
5. 上传输出到 MinIO（graph.json / wiki/*.md / GRAPH_REPORT.md / graph.html）
6. 向 API 上报完成状态 + output URIs
```

### D3: Quarantine 机制（内部状态，不暴露为 API status）

**选择**: 当 graph.json 校验失败或 shrink guard 触发时，run 标记为 `status='failed'` + `error_json.reason='quarantined'`。不在 OpenAPI 中新增 `quarantined` 状态，保持与 OpenAPI 的 5 种状态一致（pending/running/succeeded/failed/cancelled）。

**理由**: 防止异常输出自动进入 Wiki 和索引链路，同时保持 API 契约简洁。管理员通过 admin retry 端点重试修复后的 run。

**状态机**:
```
pending → running → succeeded → (wiki normalization)
                  → failed (CLI 失败 / 校验失败 / 内部 quarantine)
                  → cancelled (用户取消)
```

### D4: Shrink Guard (Doc 12 §6.1)

**选择**: 当新 run 的节点数或边数与上一 succeeded run 的偏差 > 80% 时触发 shrink guard（per Doc 12 §6.1 偏离检测规则）

**理由**: 防止 Graphify 因输入异常导致大量节点丢失。80% 阈值与 Doc 12 §6.1 和 Doc 05 一致。

### D5: Wiki Normalization 放在 API 侧（Node.js），不在 graphify-worker（Python）

**选择**: graphify-worker 只负责执行 Graphify CLI + 上传原始输出到 MinIO，wiki normalization 由 API 层在 worker 上报 job 完成后触发

**理由**:
- Wiki normalization 依赖 wiki-core TypeScript package（frontmatter/slug/pageId）
- 需要读写 DB（wiki_pages、wiki_page_versions、page_block_metadata）
- 需要 Canonical Wiki Repo 上下文（已有页面、page_id 复用）
- Python Worker 不应直接访问 DB

**流程**:
```
graphify-worker 上报 job 完成（run 仍处于 running 状态，不直接变 succeeded）
  → API graphify.service 触发后处理流水线：
    1. 从 MinIO 下载 graphify-out/ + validation_report.json
    2. Doc 12 §6.1 全量校验（node/edge 上限、偏离检测 >80%、路径安全等）
    3. 校验失败 → 标记 failed + quarantine error_json，流程结束
    4. 校验通过 → graph-core 解析 + 导入 graph 数据
    5. wiki-core normalization 导入 wiki 页面（含 Markdown 清洗）
    6. 生成 index_update_manifest（供 Stage 6 indexer 使用）
    7. 全部完成 → 标记 succeeded
```

**关键**: run 状态从 running 直接转为 succeeded 或 failed，中间不经过其他状态。校验和导入在 API 侧执行（不在 Worker），Worker 只负责执行 CLI + 上传原始输出。

### D6: Phase 1 graph 数据只入库不检索

**选择**: graph_nodes/edges/communities 写入 DB，但 Phase 1 的 RAG 链路不走 graph path

**理由**: Phase 1 scope lock 明确只做 wiki_only + hybrid_text 检索。graph 数据在 Stage 11 启用 Graph API 和 Stage 12 启用 GraphRAG 时才进入检索链路。

### D7: 输出文件存储于 MinIO，报告同时写入 DB

**选择**: graph.json / wiki/ / GRAPH_REPORT.md / graph.html / validation_report.json 均上传到 MinIO，URI 记录在 graphify_runs（graph_json_uri / wiki_output_uri / report_uri / graph_html_uri）。GRAPH_REPORT.md 的 markdown 内容同时写入 `graph_reports` 表（report_markdown 字段）以支持 API 直接查询。

**理由**: MinIO 存原始文件便于审计追溯和 quarantine 检查；DB 存报告文本便于 API 响应（避免每次查询都从 MinIO 下载）。graph.json 原始数据不存 DB（太大），而是解析后写入 graph_nodes/edges/communities。

## Architecture

```
                                    ┌─────────────────────┐
                                    │  MinIO              │
                                    │  parsed/*.md        │
                                    │  graphify-out/*     │
                                    └──────┬──────────────┘
                                           │
  ┌────────────────┐    poll job    ┌──────┴──────────────┐
  │  cherry-api    │◄──────────────►│  graphify-worker    │
  │                │   complete/fail│  (Python)           │
  │  graphify.svc  │                │                     │
  │  graph-core    │                │  1. download inputs │
  │  wiki-core     │                │  2. gen manifest    │
  │  normalization │                │  3. run graphify CLI│
  │                │                │  4. upload outputs  │
  │  ┌───────────┐ │                └─────────────────────┘
  │  │ graph     │ │
  │  │ import    │ │     ┌──────────────┐
  │  │ service   │ │     │  PostgreSQL  │
  │  └───────────┘ │     │  graph_*     │
  │  ┌───────────┐ │◄───►│  wiki_*      │
  │  │ wiki      │ │     │  graphify_*  │
  │  │ normalize │ │     └──────────────┘
  │  └───────────┘ │
  └────────────────┘
```
