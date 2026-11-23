"""
TeleBook CLI: Command-Line Interface for Zero-Knowledge Notebook Hosting.
"""

from __future__ import annotations
import asyncio
import datetime
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Optional

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, DownloadColumn, TransferSpeedColumn, TimeRemainingColumn

from telebook import __version__
from telebook.config import load_config, save_config, update_config
from telebook.client import TelebookClient, TelebookClientError, UnauthorizedError, NotFoundError
from telebook.crypto import (
    encrypt_notebook,
    decrypt_notebook,
    CryptoError,
    AuthenticationTagError,
    IntegrityVerificationError,
    MAX_RAW_CHUNK_SIZE,
)
from telebook.models import TelebookConfig
from telebook.watcher import DirectoryWatcher

console = Console()
error_console = Console(stderr=True)


def get_client(server_override: Optional[str] = None) -> TelebookClient:
    cfg = load_config()
    server_url = server_override or cfg.server_url
    return TelebookClient(base_url=server_url, session_token=cfg.session_token)


def get_passkey(passkey_override: Optional[str] = None) -> str:
    if passkey_override:
        return passkey_override
    cfg = load_config()
    if cfg.passkey:
        return cfg.passkey
    env_pass = os.getenv("TELEBOOK_PASSKEY")
    if env_pass:
        return env_pass
    # Prompt user securely
    passkey = click.prompt("Enter TELEBOOK_V1 encryption passkey", hide_input=True)
    if not passkey:
        raise click.ClickException("Encryption passkey cannot be empty.")
    return passkey


def format_bytes(size: int) -> str:
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    elif size < 1024 * 1024 * 1024:
        return f"{size / (1024 * 1024):.2f} MB"
    return f"{size / (1024 * 1024 * 1024):.2f} GB"


def format_timestamp(ts: int) -> str:
    if ts <= 0:
        return "-"
    try:
        dt = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return str(ts)


def slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text)
    return text.strip("-")


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, "-v", "--version", message="TeleBook CLI version %(version)s")
def main():
    """TeleBook: Zero-knowledge, sovereign Jupyter Notebook hosting and syncing."""
    pass


# ---------------------------------------------------------------------------
# LOGIN
# ---------------------------------------------------------------------------

@main.command()
@click.option("--server", "-s", help="TeleBook server URL (default: http://localhost:8000)")
@click.option("--passkey", "-p", help="Default encryption passkey to store locally")
def login(server: Optional[str], passkey: Optional[str]):
    """Authorize this terminal using a 120-second ephemeral magic token."""
    client = get_client(server_override=server)
    try:
        token_info = client.request_magic_token()
    except Exception as e:
        error_console.print(f"[bold red]Failed to request login token:[/bold red] {e}")
        sys.exit(1)

    panel_content = (
        f"[bold cyan]TeleBook Desktop Authentication[/bold cyan]\n\n"
        f"1. Open this authorization link on your Telegram client:\n"
        f"   [link={token_info.deep_link}]{token_info.deep_link}[/link]\n\n"
        f"2. Tap [bold green]Start[/bold green] or approve the prompt in your bot chat.\n"
        f"3. Single-owner security strictly verifies your Telegram ID.\n\n"
        f"[dim]Token ID: {token_info.token_id} | Expires in 120 seconds[/dim]"
    )
    console.print(Panel(panel_content, border_style="cyan"))

    # Poll for approval
    start_time = time.time()
    session_token = None

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:
        task = progress.add_task("Waiting for authorization in Telegram...", total=None)

        while time.time() - start_time < 120:
            try:
                status_res = client.check_magic_token(token_info.token_id)
                if status_res.status == "approved" and status_res.session_token:
                    session_token = status_res.session_token
                    break
                elif status_res.status == "expired":
                    progress.stop()
                    error_console.print("[bold red]Magic token expired.[/bold red] Please run `telebook login` again.")
                    sys.exit(1)
            except Exception:
                pass
            time.sleep(2)

    if not session_token:
        error_console.print("[bold red]Login timed out after 120 seconds.[/bold red]")
        sys.exit(1)

    # Save to config
    cfg_updates = {"session_token": session_token}
    if server:
        cfg_updates["server_url"] = server.rstrip("/")
    if passkey:
        cfg_updates["passkey"] = passkey

    update_config(**cfg_updates)
    console.print(Panel("[bold green]Success![/bold green] Terminal authorized and session token stored.", border_style="green"))


# ---------------------------------------------------------------------------
# PUSH
# ---------------------------------------------------------------------------

@main.command()
@click.argument("file", type=click.Path(exists=True, dir_okay=False, path_type=Path))
@click.option("--id", "notebook_id", help="Explicit notebook ID (default: slug of filename)")
@click.option("--title", "-t", help="Notebook title (default: filename without extension)")
@click.option("--message", "-m", default="Updated via TeleBook CLI", help="Version commit message")
@click.option("--passkey", "-p", help="TELEBOOK_V1 encryption passkey")
@click.option("--server", "-s", help="TeleBook server URL")
@click.option("--tag", multiple=True, help="Tags to associate with this notebook")
def push(
    file: Path,
    notebook_id: Optional[str],
    title: Optional[str],
    message: str,
    passkey: Optional[str],
    server: Optional[str],
    tag: tuple[str, ...],
):
    """Encrypt and push a .ipynb notebook to TeleBook storage."""
    client = get_client(server_override=server)
    active_passkey = get_passkey(passkey)

    raw_bytes = file.read_bytes()
    try:
        json.loads(raw_bytes.decode("utf-8"))
    except Exception as e:
        error_console.print(f"[bold red]Invalid Jupyter Notebook format:[/bold red] {e}")
        sys.exit(1)

    file_title = title or file.stem.replace("_", " ").title()
    nb_id = notebook_id or f"nb_{slugify(file.stem)}"
    raw_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    # Create/check notebook entry on server to get current version
    current_ver = 1
    try:
        existing = client.get_notebook(nb_id)
        current_ver = existing.current_version + 1
    except NotFoundError:
        pass
    except UnauthorizedError as e:
        error_console.print(f"[bold red]Authentication error:[/bold red] {e}")
        sys.exit(1)
    except Exception:
        pass

    # Ensure notebook metadata is registered
    try:
        client.create_or_update_notebook(
            notebook_id=nb_id,
            title=file_title,
            tags=list(tag) if tag else None,
        )
    except Exception as e:
        error_console.print(f"[bold red]Failed to initialize notebook on server:[/bold red] {e}")
        sys.exit(1)

    # Encrypt chunks with TELEBOOK_V1
    try:
        encrypted_chunks = encrypt_notebook(
            notebook_bytes=raw_bytes,
            passkey=active_passkey,
            notebook_id=nb_id,
            version=current_ver,
            max_chunk_size=MAX_RAW_CHUNK_SIZE,
        )
    except CryptoError as e:
        error_console.print(f"[bold red]Encryption failed:[/bold red] {e}")
        sys.exit(1)

    total_chunks = len(encrypted_chunks)
    total_enc_bytes = sum(c.byte_length for c in encrypted_chunks)

    console.print(
        f"Encrypting [bold cyan]{file.name}[/bold cyan] -> "
        f"[bold]{total_chunks}[/bold] chunk(s), "
        f"{format_bytes(len(raw_bytes))} raw ({format_bytes(total_enc_bytes)} encrypted)"
    )

    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    ) as progress:
        upload_task = progress.add_task(f"Uploading v{current_ver}...", total=total_enc_bytes)

        for chunk in encrypted_chunks:
            try:
                client.upload_chunk(
                    notebook_id=nb_id,
                    version=current_ver,
                    chunk_index=chunk.chunk_index,
                    binary_data=chunk.binary_data,
                    chunk_hash=chunk.chunk_hash,
                    total_chunks=total_chunks,
                    title=file_title,
                    commit_message=message,
                    sha256_hash=raw_sha256,
                )
                progress.update(upload_task, advance=chunk.byte_length)
            except Exception as e:
                error_console.print(f"[bold red]Failed uploading chunk {chunk.chunk_index}:[/bold red] {e}")
                sys.exit(1)

    console.print(
        Panel(
            f"[bold green]Upload Complete![/bold green]\n\n"
            f"Notebook ID: [cyan]{nb_id}[/cyan]\n"
            f"Version: [bold]{current_ver}[/bold]\n"
            f"Title: {file_title}\n"
            f"Chunks: {total_chunks} | Payload: {format_bytes(len(raw_bytes))}\n"
            f"Integrity SHA-256: [dim]{raw_sha256[:16]}...{raw_sha256[-8:]}[/dim]",
            border_style="green",
        )
    )


# ---------------------------------------------------------------------------
# PULL
# ---------------------------------------------------------------------------

@main.command()
@click.argument("notebook_id")
@click.option("--version", "-v", "version_num", type=int, help="Version to pull (default: latest)")
@click.option("--output", "-o", type=click.Path(dir_okay=False, path_type=Path), help="Output filename")
@click.option("--passkey", "-p", help="TELEBOOK_V1 encryption passkey")
@click.option("--server", "-s", help="TeleBook server URL")
def pull(
    notebook_id: str,
    version_num: Optional[int],
    output: Optional[Path],
    passkey: Optional[str],
    server: Optional[str],
):
    """Download, decrypt, and reassemble a notebook from TeleBook storage."""
    client = get_client(server_override=server)
    active_passkey = get_passkey(passkey)

    try:
        nb_meta = client.get_notebook(notebook_id)
    except NotFoundError:
        error_console.print(f"[bold red]Notebook '{notebook_id}' not found.[/bold red]")
        sys.exit(1)
    except Exception as e:
        error_console.print(f"[bold red]Failed to fetch notebook metadata:[/bold red] {e}")
        sys.exit(1)

    target_version = version_num if version_num is not None else nb_meta.current_version

    try:
        manifest = client.get_version_manifest(notebook_id, target_version)
    except NotFoundError:
        error_console.print(f"[bold red]Version {target_version} not found for notebook '{notebook_id}'.[/bold red]")
        sys.exit(1)
    except Exception as e:
        error_console.print(f"[bold red]Failed to fetch version manifest:[/bold red] {e}")
        sys.exit(1)

    total_chunks = len(manifest.chunks)
    sorted_chunks = sorted(manifest.chunks, key=lambda c: c.chunk_index)
    binary_chunks: List[bytes] = []

    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    ) as progress:
        dl_task = progress.add_task(f"Downloading v{target_version} ({total_chunks} chunks)...", total=manifest.byte_size)

        for chunk_info in sorted_chunks:
            try:
                data = client.download_chunk(chunk_info.download_url)
                # Verify chunk hash
                computed_chunk_hash = hashlib.sha256(data).hexdigest().lower()
                if computed_chunk_hash != chunk_info.chunk_hash.lower():
                    error_console.print(f"[bold red]Integrity error on chunk {chunk_info.chunk_index}: hash mismatch.[/bold red]")
                    sys.exit(1)
                binary_chunks.append(data)
                progress.update(dl_task, advance=len(data))
            except Exception as e:
                error_console.print(f"[bold red]Failed downloading chunk {chunk_info.chunk_index}:[/bold red] {e}")
                sys.exit(1)

    # Decrypt and reassemble
    try:
        raw_notebook = decrypt_notebook(
            chunks=binary_chunks,
            passkey=active_passkey,
            notebook_id=notebook_id,
            version=target_version,
            expected_sha256=manifest.sha256_hash,
        )
    except AuthenticationTagError:
        error_console.print("[bold red]Decryption failed:[/bold red] Invalid passkey or corrupted data.")
        sys.exit(1)
    except IntegrityVerificationError as e:
        error_console.print(f"[bold red]Integrity check failed:[/bold red] {e}")
        sys.exit(1)
    except CryptoError as e:
        error_console.print(f"[bold red]Decryption error:[/bold red] {e}")
        sys.exit(1)

    # Determine output path
    out_path = output
    if not out_path:
        out_name = f"{slugify(nb_meta.title or notebook_id)}.ipynb"
        out_path = Path.cwd() / out_name

    out_path.write_bytes(raw_notebook)
    console.print(
        Panel(
            f"[bold green]Successfully pulled and decrypted![/bold green]\n\n"
            f"Saved to: [bold cyan]{out_path.resolve()}[/bold cyan]\n"
            f"Size: {format_bytes(len(raw_notebook))} | Version: {target_version}\n"
            f"Verified SHA-256: [dim]{manifest.sha256_hash[:16]}...[/dim]",
            border_style="green",
        )
    )


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------

@main.command(name="list")
@click.option("--search", "-q", help="Filter by title, tags, or description")
@click.option("--tag", "-t", help="Filter by tag")
@click.option("--starred", is_flag=True, help="Show only starred notebooks")
@click.option("--json", "json_output", is_flag=True, help="Output as JSON")
@click.option("--server", "-s", help="TeleBook server URL")
def list_cmd(
    search: Optional[str],
    tag: Optional[str],
    starred: bool,
    json_output: bool,
    server: Optional[str],
):
    """List notebooks hosted on TeleBook."""
    client = get_client(server_override=server)
    try:
        res = client.list_notebooks(search=search, tag=tag, starred=starred if starred else None)
    except Exception as e:
        error_console.print(f"[bold red]Failed to fetch notebooks:[/bold red] {e}")
        sys.exit(1)

    if json_output:
        click.echo(json.dumps([nb.model_dump() for nb in res.notebooks], indent=2))
        return

    if not res.notebooks:
        console.print("[yellow]No notebooks found.[/yellow]")
        return

    table = Table(title="TeleBook Notebooks", show_header=True, header_style="bold magenta")
    table.add_column("ID", style="cyan", no_wrap=True)
    table.add_column("Title", style="bold white")
    table.add_column("Version", justify="center")
    table.add_column("Chunks", justify="center")
    table.add_column("Size", justify="right")
    table.add_column("Tags", style="dim")
    table.add_column("Starred", justify="center")
    table.add_column("Updated", style="dim")

    for nb in res.notebooks:
        star_icon = "[yellow]★[/yellow]" if nb.is_starred else " "
        tags_str = ", ".join(nb.tags) if nb.tags else "-"
        table.add_row(
            nb.id,
            nb.title,
            f"v{nb.current_version}",
            str(nb.total_chunks),
            format_bytes(nb.byte_size),
            tags_str,
            star_icon,
            format_timestamp(nb.updated_at),
        )

    console.print(table)


# ---------------------------------------------------------------------------
# SEARCH
# ---------------------------------------------------------------------------

@main.command()
@click.argument("query")
@click.option("--server", "-s", help="TeleBook server URL")
@click.pass_context
def search(ctx: click.Context, query: str, server: Optional[str]):
    """Search notebooks by query string."""
    ctx.invoke(list_cmd, search=query, tag=None, starred=False, json_output=False, server=server)


# ---------------------------------------------------------------------------
# WATCH
# ---------------------------------------------------------------------------

@main.command()
@click.argument("directory", type=click.Path(exists=True, file_okay=False, path_type=Path), default=".")
@click.option("--passkey", "-p", help="TELEBOOK_V1 encryption passkey")
@click.option("--server", "-s", help="TeleBook server URL")
def watch(directory: Path, passkey: Optional[str], server: Optional[str]):
    """Monitor local directory and auto-sync .ipynb changes to TeleBook."""
    active_passkey = get_passkey(passkey)
    target_dir = directory.resolve()

    console.print(Panel(
        f"[bold cyan]TeleBook Folder Watcher Active[/bold cyan]\n\n"
        f"Monitoring: [bold white]{target_dir}[/bold white]\n"
        f"Saving any .ipynb file triggers automatic TELEBOOK_V1 encryption and sync.",
        border_style="cyan"
    ))

    def on_change(file_path: Path):
        console.print(f"[dim]{datetime.datetime.now().strftime('%H:%M:%S')}[/dim] Change detected in [bold cyan]{file_path.name}[/bold cyan] -> syncing...")
        client = get_client(server_override=server)
        raw_bytes = file_path.read_bytes()
        nb_id = f"nb_{slugify(file_path.stem)}"
        file_title = file_path.stem.replace("_", " ").title()
        raw_sha256 = hashlib.sha256(raw_bytes).hexdigest()

        try:
            cur_ver = 1
            try:
                existing = client.get_notebook(nb_id)
                cur_ver = existing.current_version + 1
            except Exception:
                pass

            client.create_or_update_notebook(notebook_id=nb_id, title=file_title)

            chunks = encrypt_notebook(
                notebook_bytes=raw_bytes,
                passkey=active_passkey,
                notebook_id=nb_id,
                version=cur_ver,
            )

            for c in chunks:
                client.upload_chunk(
                    notebook_id=nb_id,
                    version=cur_ver,
                    chunk_index=c.chunk_index,
                    binary_data=c.binary_data,
                    chunk_hash=c.chunk_hash,
                    total_chunks=len(chunks),
                    title=file_title,
                    commit_message="Auto-sync via watch",
                    sha256_hash=raw_sha256,
                )
            console.print(f"[bold green]Synced:[/bold green] {file_path.name} -> v{cur_ver} ({len(chunks)} chunks)")
        except Exception as e:
            error_console.print(f"[bold red]Sync failed for {file_path.name}:[/bold red] {e}")

    watcher = DirectoryWatcher(watch_dir=target_dir, on_change_callback=on_change)
    try:
        asyncio.run(watcher.run())
    except KeyboardInterrupt:
        console.print("\n[yellow]Watcher stopped.[/yellow]")


# ---------------------------------------------------------------------------
# EXPORT-ALL
# ---------------------------------------------------------------------------

@main.command(name="export-all")
@click.option("--output-dir", "-o", type=click.Path(file_okay=False, path_type=Path), default="./telebook_export", help="Target export directory")
@click.option("--passkey", "-p", help="TELEBOOK_V1 encryption passkey")
@click.option("--server", "-s", help="TeleBook server URL")
def export_all(output_dir: Path, passkey: Optional[str], server: Optional[str]):
    """Bulk decrypt and export all stored notebooks (Zero Vendor Lock-in)."""
    client = get_client(server_override=server)
    active_passkey = get_passkey(passkey)

    try:
        nb_list = client.list_notebooks()
    except Exception as e:
        error_console.print(f"[bold red]Failed to fetch notebooks list:[/bold red] {e}")
        sys.exit(1)

    if not nb_list.notebooks:
        console.print("[yellow]No notebooks found to export.[/yellow]")
        return

    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    console.print(Panel(
        f"[bold cyan]Zero Lock-in Full Export[/bold cyan]\n\n"
        f"Exporting [bold]{len(nb_list.notebooks)}[/bold] notebooks to:\n"
        f"[bold white]{output_dir}[/bold white]",
        border_style="cyan"
    ))

    exported_manifest = []

    with Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        console=console,
    ) as progress:
        task = progress.add_task("Exporting...", total=len(nb_list.notebooks))

        for nb in nb_list.notebooks:
            try:
                manifest = client.get_version_manifest(nb.id, nb.current_version)
                sorted_chunks = sorted(manifest.chunks, key=lambda c: c.chunk_index)
                binary_chunks = []
                for chunk_info in sorted_chunks:
                    data = client.download_chunk(chunk_info.download_url)
                    binary_chunks.append(data)

                raw_notebook = decrypt_notebook(
                    chunks=binary_chunks,
                    passkey=active_passkey,
                    notebook_id=nb.id,
                    version=nb.current_version,
                    expected_sha256=manifest.sha256_hash,
                )

                safe_title = slugify(nb.title or nb.id)
                file_name = f"{nb.id}_{safe_title}.ipynb"
                file_path = output_dir / file_name
                file_path.write_bytes(raw_notebook)

                exported_manifest.append({
                    "id": nb.id,
                    "title": nb.title,
                    "version": nb.current_version,
                    "sha256_hash": manifest.sha256_hash,
                    "file_name": file_name,
                    "tags": nb.tags,
                })
            except Exception as e:
                error_console.print(f"[bold red]Failed to export {nb.id}:[/bold red] {e}")

            progress.update(task, advance=1)

    # Write export_manifest.json
    manifest_path = output_dir / "export_manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(exported_manifest, f, indent=2)

    console.print(Panel(
        f"[bold green]Export Complete![/bold green]\n\n"
        f"Exported [bold]{len(exported_manifest)}/{len(nb_list.notebooks)}[/bold] notebooks.\n"
        f"Directory: [cyan]{output_dir}[/cyan]\n"
        f"Manifest index: [dim]{manifest_path}[/dim]",
        border_style="green"
    ))


# ---------------------------------------------------------------------------
# REVOKE
# ---------------------------------------------------------------------------

@main.command()
@click.option("--server", "-s", help="TeleBook server URL")
def revoke(server: Optional[str]):
    """Atomically revoke all active desktop and mobile sessions globally."""
    if not click.confirm("Are you sure you want to invalidate all active sessions globally?"):
        console.print("[dim]Aborted.[/dim]")
        return

    client = get_client(server_override=server)
    try:
        res = client.revoke_sessions()
        console.print(Panel(
            f"[bold green]All Sessions Revoked Globally![/bold green]\n\n"
            f"User Auth Epoch bumped to: [bold]{res.new_epoch}[/bold].\n"
            f"All existing JWTs and sessions are now invalid.",
            border_style="green"
        ))
    except Exception as e:
        error_console.print(f"[bold red]Revocation failed:[/bold red] {e}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

@main.command()
@click.option("--server", "-s", help="Set default server URL")
@click.option("--passkey", "-p", help="Set default passkey")
def config(server: Optional[str], passkey: Optional[str]):
    """View or update local TeleBook configuration."""
    if server or passkey:
        update_config(server_url=server, passkey=passkey)
        console.print("[bold green]Configuration updated.[/bold green]")

    cfg = load_config()
    table = Table(title="TeleBook Configuration", show_header=False)
    table.add_column("Setting", style="bold cyan")
    table.add_column("Value")
    table.add_row("Server URL", cfg.server_url)
    table.add_row("Session Token", f"{cfg.session_token[:10]}...{cfg.session_token[-5:]}" if cfg.session_token else "[dim]Not logged in[/dim]")
    table.add_row("Passkey Configured", "[green]Yes[/green]" if cfg.passkey else "[dim]Prompt on demand[/dim]")
    table.add_row("Owner Telegram ID", str(cfg.owner_telegram_id) if cfg.owner_telegram_id else "[dim]Not set[/dim]")
    console.print(table)


if __name__ == "__main__":
    main()
