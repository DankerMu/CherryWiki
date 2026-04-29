# Test Corpus: Small

用于开发和 CI 快速验证的最小数据集。

## 预期组成

| 序号 | 文件名 | 格式 | 页数 | 用途 |
|---|---|---|---|---|
| 1 | auth-design.pdf | PDF | 8 | 认证模块设计文档 |
| 2 | api-spec.pdf | PDF | 12 | API 规范摘录 |
| 3 | deploy-guide.pdf | PDF | 5 | 部署指南 |
| 4 | security-audit.pdf | PDF | 10 | 安全审计报告 |
| 5 | architecture.pdf | PDF | 15 | 架构设计文档 |
| 6 | user-manual.docx | DOCX | 6 | 用户手册 |
| 7 | meeting-notes.docx | DOCX | 3 | 会议纪要 |
| 8 | changelog.docx | DOCX | 4 | 变更日志 |
| 9 | quick-start.md | Markdown | 2 | 快速入门指南 |
| 10 | faq.md | Markdown | 3 | 常见问题 |

**总计**: 10 文件，约 68 页

## 使用场景

- CI 单元测试和集成测试的输入数据
- 开发环境快速验证 ingestion → graphify → wiki 流程

## 注意事项

- 所有内容为合成数据，不含真实敏感信息
- 实际样本文件由 Stage 1 按需补充
