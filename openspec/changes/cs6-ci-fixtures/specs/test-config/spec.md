## ADDED Requirements

### Requirement: vitest-config
MUST 全局 vitest 测试配置。

#### Scenario: 测试运行
- **WHEN** 执行 `pnpm test`
- **THEN** vitest 运行所有 **/*.test.ts 文件

#### Scenario: 空壳通过
- **WHEN** 当前无测试文件
- **THEN** `pnpm test` 通过（passWithNoTests 配置）

#### Scenario: workspace 集成
- **WHEN** 各 package 有自己的测试文件
- **THEN** 根目录 `pnpm test` 递归执行所有 workspace 的测试

> **参考文档**: docs/engineering/14_测试验收规范.md §2（测试层级）
