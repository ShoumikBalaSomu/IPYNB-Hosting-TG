"""
Main FastAPI entry point for TeleBook Local Server.
"""

from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from local_server.auth import AuthManager
from local_server.bot_poller import BotPoller
from local_server.config import ServerConfig, load_server_config, settings
from local_server.db import Database
from local_server.storage import get_storage_engine
from local_server.watcher_service import WatcherService
from local_server.api import create_auth_router, create_notebook_router, create_webhook_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("telebook.server")


def create_app(config: Optional[ServerConfig] = None) -> FastAPI:
    cfg = config or load_server_config()
    db = Database(cfg.db_path)
    auth_manager = AuthManager(db, cfg)
    storage = get_storage_engine(cfg)

    poller = BotPoller(auth_manager, cfg) if cfg.enable_bot_poller else None
    watcher = WatcherService(auth_manager, storage, cfg) if cfg.watch_dir else None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info(f"TeleBook Local Server booting on {cfg.host}:{cfg.port}")
        logger.info(f"Storage backend: {cfg.storage_mode} (DB: {cfg.db_path})")

        if poller:
            await poller.start()
        if watcher:
            watcher.start()

        yield

        if poller:
            await poller.stop()
        if watcher:
            watcher.stop()
        logger.info("TeleBook Local Server shutdown cleanly.")

    app = FastAPI(
        title="TeleBook Local Server",
        version="1.0.0",
        description="Self-hosted backend parity server for TeleBook with SQLite and Telegram storage.",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Attach core services to state for introspection/testing
    app.state.db = db
    app.state.auth_manager = auth_manager
    app.state.storage = storage
    app.state.config = cfg

    # Include routes
    app.include_router(create_auth_router(auth_manager, cfg))
    app.include_router(create_notebook_router(auth_manager, storage, cfg))
    app.include_router(create_webhook_router(auth_manager, cfg))

    @app.get("/")
    async def root():
        return {
            "service": "TeleBook Local Server",
            "version": "1.0.0",
            "status": "operational",
            "storage_mode": cfg.storage_mode,
        }

    @app.get("/health")
    async def health():
        return {"status": "ok", "storage": cfg.storage_mode}

    return app


app = create_app(settings)


def run():
    uvicorn.run(
        "local_server.main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
    )


if __name__ == "__main__":
    run()
