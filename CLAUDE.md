# CherryWiki Project Rules

## Stage 开工门禁

每个 Stage 进入编码前，必须用 `docs/project/26_需求追踪矩阵.md` 做一次对齐检查。需求、API、Schema、测试四列中任一列为空，不允许进入编码。

## Python 环境

- 虚拟环境路径：`apps/graphify-worker/.venv/`
- 所有 Python 操作必须使用虚拟环境，禁止使用系统 Python
  - 运行：`apps/graphify-worker/.venv/bin/python`
  - 测试：`apps/graphify-worker/.venv/bin/python -m pytest`
  - 安装：`apps/graphify-worker/.venv/bin/pip install`
- codeagent prompt 中涉及 Python 命令时必须指定 venv 完整路径
