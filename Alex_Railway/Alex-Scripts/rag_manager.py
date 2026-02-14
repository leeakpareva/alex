#!/usr/bin/env python3
"""
RAG Manager — Bridge between Node.js and ChromaDB.
Commands: index-text, query, cleanup, stats, index (legacy)
"""

import sys
import json
import hashlib
import os
from datetime import datetime, timedelta, timezone

CHROMA_PATH = "/home/head/.alex/chromadb"
COLLECTION = "alex_knowledge"
UPLOADS_DIR = "/home/head/.alex/uploads"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50

# Chroma Cloud credentials (from ~/.chroma/credentials)
CHROMA_API_KEY = os.environ.get("CHROMA_API_KEY", "ck-6okEKDvgvhyHGff5vpnQzcHWnXF7a72MjQEvYjcLTSmH")
CHROMA_TENANT = os.environ.get("CHROMA_TENANT", "efc7bdaa-9d78-48bd-94f4-d7202d714f10")
CHROMA_DATABASE = os.environ.get("CHROMA_DATABASE", "alex_knowledge")

_client = None


def get_client():
    """Get or create ChromaDB client. Uses Cloud if API key available, falls back to local."""
    global _client
    if _client is not None:
        return _client

    import chromadb

    if CHROMA_API_KEY:
        try:
            _client = chromadb.CloudClient(
                api_key=CHROMA_API_KEY,
                tenant=CHROMA_TENANT,
                database=CHROMA_DATABASE,
            )
            # Quick connectivity check
            _client.heartbeat()
            print("[CHROMA] Connected to Chroma Cloud", file=sys.stderr)
            return _client
        except Exception as e:
            print(f"[CHROMA] Cloud connection failed ({e}), falling back to local", file=sys.stderr)

    _client = chromadb.PersistentClient(path=CHROMA_PATH)
    print("[CHROMA] Using local PersistentClient", file=sys.stderr)
    return _client


def get_collection(name=None):
    client = get_client()
    return client.get_or_create_collection(name or COLLECTION)


def chunk_text(text, size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start = end - overlap
    return chunks


def cmd_index_text(args):
    """Read text from stdin, chunk it, index in ChromaDB."""
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Source identifier")
    parser.add_argument("--ttl", type=int, default=5, help="TTL in days")
    parser.add_argument("--permanent", action="store_true", help="Never expires")
    parser.add_argument("--collection", default=None, help="ChromaDB collection name (default: alex_knowledge)")
    parser.add_argument("--chunk-size", type=int, default=CHUNK_SIZE, help="Chunk size in chars")
    parser.add_argument("--chunk-overlap", type=int, default=CHUNK_OVERLAP, help="Chunk overlap in chars")
    parsed = parser.parse_args(args)

    text = sys.stdin.read().strip()
    if not text:
        print("No text provided on stdin", file=sys.stderr)
        sys.exit(1)

    chunks = chunk_text(text, size=parsed.chunk_size, overlap=parsed.chunk_overlap)
    if not chunks:
        print("No chunks generated from input", file=sys.stderr)
        sys.exit(1)

    collection = get_collection(parsed.collection)
    now = datetime.now(timezone.utc)
    expires = "9999-12-31" if parsed.permanent else (now + timedelta(days=parsed.ttl)).strftime("%Y-%m-%d")

    ids = []
    documents = []
    metadatas = []
    for i, chunk in enumerate(chunks):
        doc_id = hashlib.sha256(f"{parsed.source}:{i}:{chunk[:100]}".encode()).hexdigest()[:16]
        ids.append(doc_id)
        documents.append(chunk)
        metadatas.append({
            "source": parsed.source,
            "chunk_index": i,
            "created": now.strftime("%Y-%m-%d"),
            "expires": expires,
            "permanent": "true" if parsed.permanent else "false",
        })

    collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
    print(f"Indexed {len(chunks)} chunks from '{parsed.source}' (expires: {expires})")


def cmd_query(query_text):
    """Query ChromaDB and return results as JSON."""
    if not query_text:
        print(json.dumps({"results": []}))
        return

    collection = get_collection()
    results = collection.query(query_texts=[query_text], n_results=5)

    output = []
    if results and results["documents"] and results["documents"][0]:
        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            dist = results["distances"][0][i] if results["distances"] else 0
            # Convert distance to similarity score (ChromaDB uses L2 distance)
            score = max(0, 1 - dist / 2)
            output.append({
                "text": doc,
                "source": meta.get("source", "unknown"),
                "score": round(score, 3),
            })

    print(json.dumps({"results": output}))


def cmd_cleanup(args=None):
    """Remove expired entries based on TTL metadata."""
    collection_name = None
    if args:
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--collection", default=None, help="ChromaDB collection name")
        parsed = parser.parse_args(args)
        collection_name = parsed.collection
    collection = get_collection(collection_name)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Get all entries with their metadata
    all_data = collection.get(include=["metadatas"])
    if not all_data["ids"]:
        print("No entries to clean")
        return

    expired_ids = []
    for i, meta in enumerate(all_data["metadatas"]):
        expires = meta.get("expires", "")
        permanent = meta.get("permanent", "false")
        if permanent == "true":
            continue
        if expires and expires < today:
            expired_ids.append(all_data["ids"][i])

    if expired_ids:
        # ChromaDB delete has batch limits, process in chunks
        for batch_start in range(0, len(expired_ids), 100):
            batch = expired_ids[batch_start:batch_start + 100]
            collection.delete(ids=batch)
        print(f"Removed {len(expired_ids)} expired entries")
    else:
        print("No expired entries found")


def cmd_stats():
    """Print collection statistics as JSON."""
    collection = get_collection()
    count = collection.count()

    # Sample metadata to get source distribution
    sources = {}
    oldest = None
    newest = None

    if count > 0:
        all_data = collection.get(include=["metadatas"])
        for meta in all_data["metadatas"]:
            src = meta.get("source", "unknown")
            sources[src] = sources.get(src, 0) + 1
            created = meta.get("created", "")
            if created:
                if oldest is None or created < oldest:
                    oldest = created
                if newest is None or created > newest:
                    newest = created

    stats = {
        "total_entries": count,
        "sources": sources,
        "oldest": oldest,
        "newest": newest,
    }
    print(json.dumps(stats))


def cmd_index():
    """Legacy: scan uploads dir for .txt files and index each."""
    if not os.path.isdir(UPLOADS_DIR):
        print("No uploads directory found")
        return

    collection = get_collection()
    now = datetime.now(timezone.utc)
    indexed = 0

    for fname in os.listdir(UPLOADS_DIR):
        if not fname.endswith(".txt"):
            continue
        fpath = os.path.join(UPLOADS_DIR, fname)
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read().strip()
            if len(text) < 50:
                continue

            chunks = chunk_text(text)
            ids = []
            documents = []
            metadatas = []
            for i, chunk in enumerate(chunks):
                doc_id = hashlib.sha256(f"{fname}:{i}:{chunk[:100]}".encode()).hexdigest()[:16]
                ids.append(doc_id)
                documents.append(chunk)
                metadatas.append({
                    "source": fname,
                    "chunk_index": i,
                    "created": now.strftime("%Y-%m-%d"),
                    "expires": (now + timedelta(days=5)).strftime("%Y-%m-%d"),
                    "permanent": "false",
                })

            collection.upsert(ids=ids, documents=documents, metadatas=metadatas)
            indexed += len(chunks)
        except Exception as e:
            print(f"Error indexing {fname}: {e}", file=sys.stderr)

    print(f"Indexed {indexed} chunks from txt files in uploads")


def main():
    if len(sys.argv) < 2:
        print("Usage: rag_manager.py <command> [args]", file=sys.stderr)
        print("Commands: index-text, query, cleanup, stats, index", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]

    if command == "index-text":
        cmd_index_text(sys.argv[2:])
    elif command == "query":
        query_text = " ".join(sys.argv[2:]) if len(sys.argv) > 2 else ""
        cmd_query(query_text)
    elif command == "cleanup":
        cmd_cleanup(sys.argv[2:])
    elif command == "stats":
        cmd_stats()
    elif command == "index":
        cmd_index()
    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
