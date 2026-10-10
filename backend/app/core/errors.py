"""Application failures with a stable, frontend-safe error contract."""


class DomainError(Exception):
    """Carry a public error message and a useful recovery action."""

    def __init__(self, code: str, message: str, hint: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.status_code = status_code

    def as_dict(self) -> dict[str, dict[str, str]]:
        return {"error": {"code": self.code, "message": self.message, "hint": self.hint}}
