## ADDED Requirements

### Requirement: vite-api-proxy
MUST vite dev server 代理 /api 请求到后端。

#### Scenario: 代理转发
- **WHEN** 前端发起 GET /api/health
- **THEN** Vite 代理请求到 http://localhost:8081/api/health 并返回结果

#### Scenario: 非 API 请求
- **WHEN** 前端请求 /login（非 /api 前缀）
- **THEN** Vite 返回前端页面（SPA fallback）

> **参考文档**: docs/ops/docker-compose.skeleton.yml cherry-api 端口 8081
