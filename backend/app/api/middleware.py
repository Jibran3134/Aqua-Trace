"""Bound streamed requests before validation, computation or provider use."""
import logging

from starlette.responses import JSONResponse


class SafeErrorMiddleware:
    """Handle unexpected failures inside CORS so browsers can read the error."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as error:
            if scope["type"] != "http" or started:
                raise
            logging.getLogger("aquatrace").error("Request failed (%s).", type(error).__name__)
            response = JSONResponse({"error": {
                "code": "internal_error", "message": "The operation could not be completed.",
                "hint": "Retry once; if it persists, check backend service health.",
            }}, status_code=500)
            await response(scope, receive, send)


class BodyLimitMiddleware:
    """Reject oversized bodies, including chunked requests, with bounded memory."""

    def __init__(self, app, max_bytes: int):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_bytes:
                response = JSONResponse({"error": {
                    "code": "payload_too_large", "message": "Request body is too large.",
                    "hint": "Send a smaller request within the documented payload limit.",
                }}, status_code=413)
                await response(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
