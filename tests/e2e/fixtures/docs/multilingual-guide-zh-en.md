# CherryWiki 多语言支持指南 / Multilingual Support Guide

## 概述 / Overview

CherryWiki 支持中英文混合文档的解析和检索。The system handles mixed-language content through language-aware chunking and multilingual embedding models.

## 文档解析 / Document Parsing

### 中文分词 / Chinese Tokenization
系统使用 jieba 分词器对中文内容进行分词处理。For BM25 indexing, Chinese text is segmented into meaningful tokens rather than individual characters.

分词示例 / Tokenization Example:
- Input: "CherryWiki知识图谱系统支持多语言文档"
- Tokens: ["CherryWiki", "知识", "图谱", "系统", "支持", "多", "语言", "文档"]

### 混合内容处理 / Mixed Content Handling
当文档同时包含中英文时 (when documents contain both Chinese and English):
1. 语言检测 / Language detection per paragraph
2. 分词策略选择 / Tokenizer selection based on detected language
3. 统一向量化 / Unified embedding with multilingual model

## 检索优化 / Retrieval Optimization

对于中文查询 (for Chinese queries):
- BM25 使用 jieba 分词结果进行匹配
- Vector search 使用 multilingual embedding model
- Hybrid fusion 权重可按语言调整 (weights adjustable per language)

对于英文查询 (for English queries):
- BM25 uses standard English tokenization
- Same multilingual embedding model ensures cross-language retrieval
- A Chinese document can be retrieved by an English query and vice versa

## 已知限制 / Known Limitations

- 繁体中文支持有限 (Traditional Chinese support is limited)
- 日韩文档需要额外分词器配置 (Japanese/Korean require additional tokenizer config)
- 混合语言的 BM25 精度略低于纯单语言文档
