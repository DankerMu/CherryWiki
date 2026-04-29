## ADDED Requirements

### Requirement: health-endpoint
MUST gET /api/health 返回系统健康状态。

#### Scenario: 正常运行
- **WHEN** GET /api/health
- **THEN** 返回 200 + `{ status: "healthy", version: "<package.json version>", uptime: <seconds> }`

#### Scenario: Docker healthcheck
- **WHEN** Docker healthcheck 调用 `curl -f http://localhost:8080/api/health`
- **THEN** 返回 200，容器标记为 healthy

> **参考文档**: docs/schemas/openapi.yaml /admin/system/health、docs/ops/docker-compose.skeleton.yml cherry-api healthcheck
