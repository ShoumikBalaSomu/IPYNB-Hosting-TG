"""
TELEBOOK_V1 Cryptographic Implementation.

Enforces zero-knowledge client-side encryption using:
- AES-256-GCM authenticated cipher
- PBKDF2-HMAC-SHA256 (100,000 iterations, 16-byte salt, 256-bit key)
- 96-bit (12-byte) CSPRNG IV per chunk
- AAD Binding: notebook_id:version:chunk_index:total_chunks
- TB01 Binary Chunk Format:
    [4 bytes: 'TB01'] [16 bytes: Salt] [12 bytes: IV] [Ciphertext] [16 bytes: GCM Tag]
- Max raw chunk threshold: 15 MB (15,728,640 bytes)
"""

from __future__ import annotations
import hashlib
import math
import os
from dataclasses import dataclass
from typing import List, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

MAGIC_HEADER = b"TB01"
SALT_SIZE = 16
IV_SIZE = 12
TAG_SIZE = 16
HEADER_SIZE = len(MAGIC_HEADER) + SALT_SIZE + IV_SIZE  # 32 bytes
PBKDF2_ITERATIONS = 100_000
MAX_RAW_CHUNK_SIZE = 15 * 1024 * 1024  # 15 MB (15,728,640 bytes)


class CryptoError(Exception):
    """Base exception for TeleBook cryptographic failures."""
    pass


class InvalidChunkHeaderError(CryptoError):
    """Raised when chunk does not match TB01 magic prefix or expected structure."""
    pass


class AuthenticationTagError(CryptoError):
    """Raised when GCM authentication tag verification fails (tampering/wrong passkey)."""
    pass


class IntegrityVerificationError(CryptoError):
    """Raised when reassembled plaintext hash does not match expected manifest hash."""
    pass


@dataclass
class EncryptedChunk:
    chunk_index: int
    total_chunks: int
    binary_data: bytes
    chunk_hash: str  # SHA-256 of binary_data
    byte_length: int


def derive_key(passkey: str, salt: bytes) -> bytes:
    """
    Derive 256-bit AES key using PBKDF2-HMAC-SHA256 with 100,000 iterations.
    """
    if not isinstance(passkey, str) or not passkey:
        raise CryptoError("Passkey must be a non-empty string.")
    if len(salt) != SALT_SIZE:
        raise CryptoError(f"Salt must be exactly {SALT_SIZE} bytes.")
    
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(passkey.encode("utf-8"))


def construct_aad(notebook_id: str, version: int, chunk_index: int, total_chunks: int) -> bytes:
    """
    Construct Additional Authenticated Data (AAD) for AES-GCM binding:
    notebook_id:version:chunk_index:total_chunks
    """
    return f"{notebook_id}:{version}:{chunk_index}:{total_chunks}".encode("utf-8")


def encrypt_chunk(
    raw_chunk: bytes,
    passkey: str,
    notebook_id: str,
    version: int,
    chunk_index: int,
    total_chunks: int,
) -> EncryptedChunk:
    """
    Encrypt a single chunk buffer into the TB01 binary wire format.
    """
    salt = os.urandom(SALT_SIZE)
    iv = os.urandom(IV_SIZE)
    key = derive_key(passkey, salt)
    aad = construct_aad(notebook_id, version, chunk_index, total_chunks)

    aesgcm = AESGCM(key)
    # encrypt returns ciphertext + 16-byte auth tag
    ciphertext_and_tag = aesgcm.encrypt(iv, raw_chunk, aad)

    binary_data = MAGIC_HEADER + salt + iv + ciphertext_and_tag
    chunk_hash = hashlib.sha256(binary_data).hexdigest()

    return EncryptedChunk(
        chunk_index=chunk_index,
        total_chunks=total_chunks,
        binary_data=binary_data,
        chunk_hash=chunk_hash,
        byte_length=len(binary_data),
    )


def decrypt_chunk(
    binary_chunk: bytes,
    passkey: str,
    notebook_id: str,
    version: int,
    chunk_index: int,
    total_chunks: int,
) -> bytes:
    """
    Decrypt a TB01 binary chunk, verifying AAD binding and GCM tag.
    """
    if len(binary_chunk) < HEADER_SIZE + TAG_SIZE:
        raise InvalidChunkHeaderError(
            f"Chunk too small ({len(binary_chunk)} bytes). Minimum size is {HEADER_SIZE + TAG_SIZE} bytes."
        )

    magic = binary_chunk[:4]
    if magic != MAGIC_HEADER:
        raise InvalidChunkHeaderError(
            f"Invalid magic header: expected {MAGIC_HEADER.decode('ascii')}, got {magic!r}"
        )

    salt = binary_chunk[4:20]
    iv = binary_chunk[20:32]
    ciphertext_and_tag = binary_chunk[32:]

    key = derive_key(passkey, salt)
    aad = construct_aad(notebook_id, version, chunk_index, total_chunks)

    aesgcm = AESGCM(key)
    try:
        raw_data = aesgcm.decrypt(iv, ciphertext_and_tag, aad)
        return raw_data
    except Exception as e:
        raise AuthenticationTagError(
            f"Failed to decrypt chunk {chunk_index} of {notebook_id} v{version}. "
            "Invalid passkey or corrupted/tampered data."
        ) from e


def slice_payload(payload: bytes, max_chunk_size: int = MAX_RAW_CHUNK_SIZE) -> List[bytes]:
    """
    Slice raw bytes into segments not exceeding max_chunk_size.
    Always returns at least one chunk (even for empty payload).
    """
    if len(payload) == 0:
        return [b""]
    
    total = len(payload)
    num_chunks = math.ceil(total / max_chunk_size)
    chunks = []
    for i in range(num_chunks):
        start = i * max_chunk_size
        end = min(start + max_chunk_size, total)
        chunks.append(payload[start:end])
    return chunks


def encrypt_notebook(
    notebook_bytes: bytes,
    passkey: str,
    notebook_id: str,
    version: int,
    max_chunk_size: int = MAX_RAW_CHUNK_SIZE,
) -> List[EncryptedChunk]:
    """
    Split notebook bytes into <= 15MB chunks, encrypt each with TELEBOOK_V1.
    """
    raw_chunks = slice_payload(notebook_bytes, max_chunk_size)
    total_chunks = len(raw_chunks)
    encrypted_chunks: List[EncryptedChunk] = []

    for idx, raw_chunk in enumerate(raw_chunks):
        chunk = encrypt_chunk(
            raw_chunk=raw_chunk,
            passkey=passkey,
            notebook_id=notebook_id,
            version=version,
            chunk_index=idx,
            total_chunks=total_chunks,
        )
        encrypted_chunks.append(chunk)

    return encrypted_chunks


def decrypt_notebook(
    chunks: List[bytes],
    passkey: str,
    notebook_id: str,
    version: int,
    expected_sha256: Optional[str] = None,
) -> bytes:
    """
    Sequentially decrypt and reassemble chunks, asserting raw payload integrity.
    """
    total_chunks = len(chunks)
    if total_chunks == 0:
        raise CryptoError("No chunks provided for reassembly.")

    reassembled_parts: List[bytes] = []
    for idx, chunk_binary in enumerate(chunks):
        raw_part = decrypt_chunk(
            binary_chunk=chunk_binary,
            passkey=passkey,
            notebook_id=notebook_id,
            version=version,
            chunk_index=idx,
            total_chunks=total_chunks,
        )
        reassembled_parts.append(raw_part)

    payload = b"".join(reassembled_parts)

    if expected_sha256 is not None:
        computed_hash = hashlib.sha256(payload).hexdigest().lower()
        expected_norm = expected_sha256.strip().lower()
        if computed_hash != expected_norm:
            raise IntegrityVerificationError(
                f"Decrypted payload hash mismatch. Expected {expected_norm}, computed {computed_hash}."
            )

    return payload
