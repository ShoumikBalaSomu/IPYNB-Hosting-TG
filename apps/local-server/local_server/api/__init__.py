"""
API Router initialization.
"""

from local_server.api.auth_routes import create_auth_router
from local_server.api.notebook_routes import create_notebook_router
from local_server.api.webhook_routes import create_webhook_router

__all__ = [
    "create_auth_router",
    "create_notebook_router",
    "create_webhook_router",
]
