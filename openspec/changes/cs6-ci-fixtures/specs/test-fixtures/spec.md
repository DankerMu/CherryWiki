## ADDED Requirements

### Requirement: fixture-skeleton
MUST tests/fixtures/ 测试数据集目录骨架。

#### Scenario: 目录结构
- **WHEN** 查看 tests/fixtures/
- **THEN** 包含 test-corpus-small/ 和 test-corpus-security/ 子目录

#### Scenario: test-corpus-small
- **WHEN** 查看 test-corpus-small/README.md
- **THEN** 说明预期包含 10 个文件（5 PDF + 3 DOCX + 2 MD）共 50 页

#### Scenario: test-corpus-security
- **WHEN** 查看 test-corpus-security/README.md
- **THEN** 说明预期包含 ZIP bomb、路径穿越 ZIP、injection PDF、SSRF URL 等恶意样本

> **参考文档**: docs/project/25_Phase1_Scope_Lock.md §6（Phase 1 验收数据集定义）、docs/todo.md T-15.4（test fixtures 要求）
