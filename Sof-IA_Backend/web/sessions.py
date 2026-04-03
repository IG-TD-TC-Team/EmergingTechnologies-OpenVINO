"""In-memory chat session — single session, demo only.

Single-worker Uvicorn keeps this race-condition-free.
Data is lost on server restart (intentional for the demo).
"""

_messages: list[dict] = []


def get_messages() -> list[dict]:
    """Return a copy of the current conversation message list."""
    return list(_messages)


def add_message(role: str, content: str) -> None:
    """Append a message to the conversation.

    Args:
        role: ``"user"`` or ``"assistant"``.
        content: Message text.
    """
    _messages.append({"role": role, "content": content})


def clear() -> None:
    """Clear all messages from the session."""
    _messages.clear()