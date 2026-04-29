from __future__ import annotations

import asyncio

from .main import main as async_main


def main() -> None:
    asyncio.run(async_main())


if __name__ == "__main__":
    main()
