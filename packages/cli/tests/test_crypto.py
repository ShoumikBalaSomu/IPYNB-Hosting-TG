"""
Unit tests for TELEBOOK_V1 cryptographic engine.
Asserts tamper resistance, AAD binding, chunk slicing, and error handling.
"""

import hashlib
import os
import pytest

from telebook.crypto import (
    derive_key,
    construct_aad,
    encrypt_chunk,
    decrypt_chunk,
    slice_payload,
    encrypt_notebook,
    decrypt_notebook,
    AuthenticationTagError,
    InvalidChunkHeaderError,
    IntegrityVerificationError,
    CryptoError,
    MAGIC_HEADER,
    MAX_RAW_CHUNK_SIZE,
)


def test_key_derivation():
    salt = os.urandom(16)
    k1 = derive_key("master-passkey", salt)
    k2 = derive_key("master-passkey", salt)
    k3 = derive_key("different-passkey", salt)
    assert k1 == k2
    assert len(k1) == 32
    assert k1 != k3


def test_aad_construction():
    aad = construct_aad("nb_test", 1, 0, 3)
    assert aad == b"nb_test:1:0:3"


def test_chunk_encryption_decryption_roundtrip():
    passkey = "super-secret-key-123"
    payload = b"print('Hello, TeleBook!')\nimport numpy as np"
    notebook_id = "nb_alpha"
    version = 2
    chunk_index = 0
    total_chunks = 1

    enc = encrypt_chunk(
        raw_chunk=payload,
        passkey=passkey,
        notebook_id=notebook_id,
        version=version,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
    )

    assert enc.binary_data[:4] == MAGIC_HEADER
    assert enc.chunk_index == 0
    assert enc.total_chunks == 1
    assert enc.chunk_hash == hashlib.sha256(enc.binary_data).hexdigest()

    dec = decrypt_chunk(
        binary_chunk=enc.binary_data,
        passkey=passkey,
        notebook_id=notebook_id,
        version=version,
        chunk_index=chunk_index,
        total_chunks=total_chunks,
    )
    assert dec == payload


def test_aad_tamper_resistance():
    """Verify that tampering with any AAD component causes decryption failure."""
    passkey = "passkey-123"
    payload = b"Sensitive model weights and code"
    enc = encrypt_chunk(payload, passkey, "nb_1", 1, 0, 1)

    # 1. Tampered notebook_id
    with pytest.raises(AuthenticationTagError):
        decrypt_chunk(enc.binary_data, passkey, "nb_tampered", 1, 0, 1)

    # 2. Tampered version (rollback attack)
    with pytest.raises(AuthenticationTagError):
        decrypt_chunk(enc.binary_data, passkey, "nb_1", 2, 0, 1)

    # 3. Tampered chunk_index (reordering attack)
    with pytest.raises(AuthenticationTagError):
        decrypt_chunk(enc.binary_data, passkey, "nb_1", 1, 1, 1)

    # 4. Tampered total_chunks (truncation attack)
    with pytest.raises(AuthenticationTagError):
        decrypt_chunk(enc.binary_data, passkey, "nb_1", 1, 0, 2)


def test_wrong_passkey_fails():
    enc = encrypt_chunk(b"Data", "correct-key", "nb_1", 1, 0, 1)
    with pytest.raises(AuthenticationTagError):
        decrypt_chunk(enc.binary_data, "wrong-key", "nb_1", 1, 0, 1)


def test_invalid_magic_header_fails():
    enc = encrypt_chunk(b"Data", "key", "nb_1", 1, 0, 1)
    corrupted = b"XXXX" + enc.binary_data[4:]
    with pytest.raises(InvalidChunkHeaderError):
        decrypt_chunk(corrupted, "key", "nb_1", 1, 0, 1)


def test_slice_payload():
    # 0 bytes
    empty_slices = slice_payload(b"")
    assert len(empty_slices) == 1
    assert empty_slices[0] == b""

    # Less than chunk size
    small_slices = slice_payload(b"hello", max_chunk_size=10)
    assert len(small_slices) == 1
    assert small_slices[0] == b"hello"

    # Multi-chunk slicing
    data = b"0123456789" * 10  # 100 bytes
    slices = slice_payload(data, max_chunk_size=30)
    assert len(slices) == 4
    assert b"".join(slices) == data


def test_multi_chunk_notebook_roundtrip():
    passkey = "my-encryption-passkey"
    notebook_id = "nb_multi"
    version = 3
    # Synthetic notebook content (3 chunks of ~400 bytes each)
    data = b'{"cells": [{"cell_type": "code", "source": "x = 42"}]}' * 20
    expected_hash = hashlib.sha256(data).hexdigest()

    # Split into 350-byte chunks to test multi-chunk reassembly cleanly
    encrypted_chunks = encrypt_notebook(
        notebook_bytes=data,
        passkey=passkey,
        notebook_id=notebook_id,
        version=version,
        max_chunk_size=350,
    )

    assert len(encrypted_chunks) == 4

    binary_list = [c.binary_data for c in encrypted_chunks]
    decrypted = decrypt_notebook(
        chunks=binary_list,
        passkey=passkey,
        notebook_id=notebook_id,
        version=version,
        expected_sha256=expected_hash,
    )

    assert decrypted == data


def test_integrity_hash_mismatch():
    passkey = "passkey"
    data = b"some notebook data"
    enc = encrypt_notebook(data, passkey, "nb_test", 1)
    binary_list = [c.binary_data for c in enc]

    with pytest.raises(IntegrityVerificationError):
        decrypt_notebook(
            chunks=binary_list,
            passkey=passkey,
            notebook_id="nb_test",
            version=1,
            expected_sha256="0000000000000000000000000000000000000000000000000000000000000000",
        )
