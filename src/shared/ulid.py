from __future__ import annotations

import os
import time

CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_base32(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(CROCKFORD_BASE32[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def new_ulid(timestamp_ms: int | None = None) -> str:
    timestamp_ms = int(time.time() * 1000) if timestamp_ms is None else timestamp_ms
    if timestamp_ms < 0 or timestamp_ms >= 2**48:
        raise ValueError("ULID timestamp must fit into 48 bits")

    randomness = int.from_bytes(os.urandom(10), byteorder="big")
    return _encode_base32(timestamp_ms, 10) + _encode_base32(randomness, 16)

