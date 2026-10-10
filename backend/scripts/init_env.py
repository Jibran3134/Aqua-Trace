"""Create local development secrets without overwriting an existing .env."""
from pathlib import Path
from secrets import token_hex


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    target = root / ".env"
    if target.exists():
        print("Existing backend/.env preserved.")
        return
    text = (root / ".env.example").read_text(encoding="utf-8")
    text = text.replace("replace-with-a-random-url-safe-password", token_hex(24))
    text = text.replace("replace-with-a-different-random-url-safe-password", token_hex(24))
    target.write_text(text, encoding="utf-8")
    print("Created backend/.env with unique local database and Redis secrets.")


if __name__ == "__main__":
    main()
