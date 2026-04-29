# Test Corpus: Security

用于安全测试的恶意/边界样本集。

## 预期恶意样本类型

| 类型 | 文件名 | 攻击向量 | 预期行为 |
|---|---|---|---|
| ZIP Bomb | zipbomb.zip | 解压膨胀攻击 | 上传拒绝或解压大小限制触发 |
| Path Traversal ZIP | traversal.zip | ../../../etc/passwd 路径 | 路径净化，拒绝越界写入 |
| Injection PDF | injection.pdf | PDF 内嵌 prompt injection | ingestion 扫描标记 injection_risk |
| SSRF URL | ssrf-urls.txt | 内网地址列表 | url-fetcher-worker 拒绝 SSRF_BLOCKED_CIDRS |
| XSS Markdown | xss.md | <script> 和 onerror 注入 | Markdown 渲染时 sanitize |
| Oversized File | oversized.bin | 超过 UPLOAD_MAX_SIZE_MB | 上传阶段拒绝 |

## 使用场景

- 安全测试（docs/engineering/14_测试验收规范.md §4）
- SSRF 防护验证
- Prompt injection 防护验证

## 注意事项

- 实际恶意样本文件由安全测试阶段生成
- 此目录当前仅包含说明文档
