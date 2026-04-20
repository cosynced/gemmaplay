"""Shared slowapi Limiter instance.

Kept in its own module so every route file can import `limiter` without
a circular dep on app.main.
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
