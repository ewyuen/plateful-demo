"""The order code a guest uses to find their order (ADR-0014).

12 characters from a 31-character alphabet without look-alikes (no I, L, O, 0 or 1), about
59 bits from the operating system's secure generator. The code is not derived from the
order's id or anything else, so it cannot be worked out from a number.
"""

import secrets

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LENGTH = 12
GROUP = 4


def generate() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))


def normalize(text) -> str | None:
    """The stored form of what a person typed, or None when it cannot be a code.

    Case, hyphens and spaces do not matter. Anything else that is not in the alphabet
    (so also a look-alike such as O or 1) makes it not a code.
    """
    if not isinstance(text, str) or len(text) > 64:
        return None
    cleaned = "".join(text.upper().replace("-", "").split())
    if len(cleaned) != LENGTH or any(char not in ALPHABET for char in cleaned):
        return None
    return cleaned


def display(code: str) -> str:
    """The code as people see it: XXXX-XXXX-XXXX."""
    return "-".join(code[i : i + GROUP] for i in range(0, len(code), GROUP))
