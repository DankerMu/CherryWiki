from __future__ import annotations

from decimal import Decimal
from typing import Any


def _json_scalar(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    return value


def build_echarts_option(chart_type: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    if chart_type not in {"bar", "line", "pie"}:
        raise ValueError(f"unsupported chart type: {chart_type}")

    labels: list[Any] = []
    values: list[Any] = []
    for row in rows:
        row_values = list(row.values())
        if not row_values:
            continue
        labels.append(_json_scalar(row_values[0]))
        values.append(_json_scalar(row_values[1] if len(row_values) > 1 else 1))

    if chart_type == "pie":
        return {
            "tooltip": {"trigger": "item"},
            "series": [
                {
                    "type": "pie",
                    "data": [
                        {"name": label, "value": value}
                        for label, value in zip(labels, values, strict=False)
                    ],
                }
            ],
        }

    return {
        "tooltip": {"trigger": "axis"},
        "xAxis": {"type": "category", "data": labels},
        "yAxis": {"type": "value"},
        "series": [{"type": chart_type, "data": values}],
    }
