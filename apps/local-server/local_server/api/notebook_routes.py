"""
Notebook and Chunk Management API Routes.
Provides full Cloudflare Worker API parity for listing, manifest querying, and chunk streaming.
"""

from __future__ import annotations
import hashlib
import urllib.parse
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from local_server.auth import AuthManager, bearer_scheme
from local_server.config import ServerConfig
from local_server.storage.base import BaseStorage


class CreateNotebookRequest(BaseModel):
    id: str
    title: str
    description: str = ""
    tags: List[str] = Field(default_factory=list)
    is_starred: bool = False


def create_notebook_router(
    auth_manager: AuthManager,
    storage: BaseStorage,
    config: ServerConfig,
) -> APIRouter:
    router = APIRouter(prefix="/api/notebooks", tags=["notebooks"])

    def get_user_from_req(credentials) -> dict:
        if credentials:
            return auth_manager.verify_request_auth(credentials.credentials)
        # Fallback for local self-hosting dev mode
        owner_id = config.owner_telegram_id or 1000000001
        return auth_manager.db.get_or_create_user(owner_id, username="owner")

    @router.get("")
    async def list_notebooks(
        search: Optional[str] = None,
        tag: Optional[str] = None,
        starred: Optional[str] = None,
        credentials=Depends(bearer_scheme),
    ):
        user = get_user_from_req(credentials)
        is_starred_bool = None
        if starred is not None:
            is_starred_bool = starred.lower() in ("true", "1", "yes")

        items = auth_manager.db.list_notebooks(
            user_id=user["id"],
            search=search,
            tag=tag,
            starred=is_starred_bool,
        )
        return {"notebooks": items}

    @router.post("", status_code=status.HTTP_201_CREATED)
    async def create_or_update_notebook(
        req: CreateNotebookRequest,
        credentials=Depends(bearer_scheme),
    ):
        user = get_user_from_req(credentials)
        nb = auth_manager.db.upsert_notebook(
            notebook_id=req.id,
            user_id=user["id"],
            title=req.title,
            description=req.description,
            tags=req.tags,
            is_starred=req.is_starred,
        )
        return nb

    @router.get("/{notebook_id}")
    async def get_notebook_metadata(
        notebook_id: str,
        credentials=Depends(bearer_scheme),
    ):
        get_user_from_req(credentials)
        nb = auth_manager.db.get_notebook(notebook_id)
        if not nb:
            raise HTTPException(status_code=404, detail="Notebook not found")
        return nb

    @router.delete("/{notebook_id}")
    async def delete_notebook(
        notebook_id: str,
        credentials=Depends(bearer_scheme),
    ):
        get_user_from_req(credentials)
        success = auth_manager.db.delete_notebook(notebook_id)
        if not success:
            raise HTTPException(status_code=404, detail="Notebook not found")
        return {"deleted": True, "id": notebook_id}

    @router.get("/{notebook_id}/versions/{version}")
    async def get_version_manifest(
        notebook_id: str,
        version: int,
        credentials=Depends(bearer_scheme),
    ):
        get_user_from_req(credentials)
        manifest = auth_manager.db.get_version_manifest(notebook_id, version)
        if not manifest:
            raise HTTPException(status_code=404, detail=f"Version {version} not found for notebook {notebook_id}")
        return manifest

    @router.post("/{notebook_id}/versions/{version}/chunks/{index}", status_code=status.HTTP_201_CREATED)
    async def upload_chunk(
        notebook_id: str,
        version: int,
        index: int,
        request: Request,
        x_chunk_hash: str = Header(..., alias="X-Chunk-Hash"),
        x_total_chunks: int = Header(..., alias="X-Total-Chunks"),
        x_notebook_title: Optional[str] = Header(None, alias="X-Notebook-Title"),
        x_commit_message: Optional[str] = Header(None, alias="X-Commit-Message"),
        x_decrypted_hash: Optional[str] = Header(None, alias="X-Decrypted-Hash"),
        credentials=Depends(bearer_scheme),
    ):
        user = get_user_from_req(credentials)

        body_bytes = await request.body()
        if not body_bytes:
            raise HTTPException(status_code=400, detail="Empty chunk payload")

        # Verify chunk hash integrity
        computed_hash = hashlib.sha256(body_bytes).hexdigest().lower()
        if computed_hash != x_chunk_hash.strip().lower():
            raise HTTPException(
                status_code=400,
                detail=f"Chunk hash mismatch. Header: {x_chunk_hash}, Computed: {computed_hash}",
            )

        # Decode title and commit message if present
        title = urllib.parse.unquote(x_notebook_title) if x_notebook_title else notebook_id
        commit_msg = urllib.parse.unquote(x_commit_message) if x_commit_message else ""
        raw_sha256 = x_decrypted_hash or ""

        # Ensure notebook exists
        auth_manager.db.upsert_notebook(
            notebook_id=notebook_id,
            user_id=user["id"],
            title=title,
        )

        # Store chunk via storage engine
        chunk_id = f"chk_{notebook_id}_v{version}_{index}"
        filename = f"{chunk_id}.tb01"
        save_res = await storage.save_chunk(chunk_id, body_bytes, filename)

        # Record chunk in database
        auth_manager.db.record_chunk(
            chunk_id=chunk_id,
            notebook_id=notebook_id,
            version=version,
            chunk_index=index,
            total_chunks=x_total_chunks,
            telegram_file_id=save_res.file_id,
            telegram_message_id=save_res.message_id,
            chunk_hash=computed_hash,
            byte_length=len(body_bytes),
        )

        # Check if version is complete
        auth_manager.db.check_and_finalize_version(
            notebook_id=notebook_id,
            version=version,
            total_chunks=x_total_chunks,
            sha256_hash=raw_sha256,
            commit_message=commit_msg,
        )

        return {
            "chunk_index": index,
            "telegram_file_id": save_res.file_id,
            "status": "stored",
        }

    @router.get("/{notebook_id}/versions/{version}/chunks/{index}")
    async def download_chunk(
        notebook_id: str,
        version: int,
        index: int,
        credentials=Depends(bearer_scheme),
    ):
        get_user_from_req(credentials)

        chunk_record = auth_manager.db.get_chunk(notebook_id, version, index)
        if not chunk_record:
            raise HTTPException(status_code=404, detail="Chunk not found")

        file_id = chunk_record["telegram_file_id"]
        try:
            chunk_bytes = await storage.get_chunk(file_id)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed retrieving chunk from storage: {e}")

        return Response(
            content=chunk_bytes,
            media_type="application/octet-stream",
            headers={
                "X-Chunk-Hash": chunk_record["chunk_hash"],
                "Content-Length": str(len(chunk_bytes)),
            },
        )

    return router
