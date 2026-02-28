"""
tool_bridge.py — Python SDK for the Enterprise AI Chat Sandbox
Provides access to backend tools, web operations, and Qdrant vector search.

Environment variables (set by SandboxService.ts):
  BRIDGE_URL     — HTTP bridge to Node.js backend (e.g. http://localhost:54321)
  BRIDGE_SECRET  — Per-execution auth secret for the bridge
  QDRANT_URL     — Qdrant REST endpoint (e.g. http://qdrant:6333)
"""

import ipaddress
import json
import logging
import os
import socket
import threading
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlparse

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

BRIDGE_URL = os.environ.get("BRIDGE_URL", "http://localhost:9999").rstrip("/")
BRIDGE_SECRET = os.environ.get("BRIDGE_SECRET", "")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333").rstrip("/")

_MAX_HTTP_REQUESTS = 20
_MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MB
_HTTP_TIMEOUT = 10  # seconds per request
_ALLOWED_SCHEMES = {"http", "https"}

# Allowed Qdrant collections (security: prevent access to arbitrary collections)
_ALLOWED_COLLECTIONS = {"document_chunks", "episodic_memory", "procedural_memory"}

# Blocked private/internal networks for SSRF prevention (incl. IPv6 ULA, link-local, IPv4-mapped)
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("::ffff:0:0/96"),
    ipaddress.ip_network("2002::/16"),
]
_BLOCKED_HOSTS = {"metadata.google.internal", "metadata.internal"}


# ---------------------------------------------------------------------------
# URL validation (SSRF prevention)
# ---------------------------------------------------------------------------

def _check_ip_blocked(addr_str: str) -> None:
    """Raise ValueError if the IP address is in a blocked network."""
    try:
        addr = ipaddress.ip_address(addr_str)
        for net in _BLOCKED_NETWORKS:
            if addr in net:
                raise ValueError(f"Access to blocked IP range: {addr_str}")
    except ValueError as ve:
        if "blocked" in str(ve):
            raise


def _validate_url(url: str) -> None:
    """Raise ValueError if the URL is not safe for outbound requests.
    Resolves hostnames to prevent DNS rebinding attacks."""
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ValueError(f"URL scheme '{parsed.scheme}' not allowed (only http/https)")
    host = parsed.hostname or ""
    if not host:
        raise ValueError("URL has no hostname")
    if host in _BLOCKED_HOSTS:
        raise ValueError(f"Access to host '{host}' is blocked")
    # Check if host is a literal IP
    try:
        _check_ip_blocked(host)
    except ValueError as ve:
        if "blocked" in str(ve):
            raise
        # Not an IP literal — resolve hostname and validate all resolved IPs
    # DNS resolution check (prevents DNS rebinding)
    try:
        resolved = socket.getaddrinfo(host, None)
        for result in resolved:
            addr_str = result[4][0]
            _check_ip_blocked(addr_str)
    except socket.gaierror:
        raise ValueError(f"Cannot resolve hostname: {host}")
    except ValueError as ve:
        if "blocked" in str(ve) or "Cannot resolve" in str(ve):
            raise


def _validate_collection(collection: str) -> None:
    """Validate Qdrant collection name against allowlist."""
    if collection not in _ALLOWED_COLLECTIONS:
        raise ValueError(
            f"Collection '{collection}' not allowed. "
            f"Allowed: {', '.join(sorted(_ALLOWED_COLLECTIONS))}"
        )


# ---------------------------------------------------------------------------
# Streaming HTTP content reader (enforces size limit)
# ---------------------------------------------------------------------------

def _stream_content(resp: requests.Response, max_bytes: int = _MAX_CONTENT_LENGTH) -> str:
    """Read response content with streaming size enforcement."""
    chunks: list[bytes] = []
    total = 0
    for chunk in resp.iter_content(chunk_size=65536):
        total += len(chunk)
        if total > max_bytes:
            raise RuntimeError(f"Content too large: exceeded {max_bytes} bytes")
        chunks.append(chunk)
    return b"".join(chunks).decode(resp.encoding or "utf-8", errors="replace")


# ---------------------------------------------------------------------------
# ToolBridge class
# ---------------------------------------------------------------------------

class ToolBridge:
    """SDK for interacting with backend tools, web, and Qdrant from the sandbox."""

    def __init__(self) -> None:
        self._request_count = 0
        self._lock = threading.Lock()

    def _check_rate_limit(self) -> None:
        """Thread-safe per-instance rate limiting."""
        with self._lock:
            self._request_count += 1
            if self._request_count > _MAX_HTTP_REQUESTS:
                raise RuntimeError(
                    f"Rate limit exceeded: max {_MAX_HTTP_REQUESTS} HTTP requests per execution"
                )

    # ---- Backend tool bridge (HTTP to Node.js) ----

    def _bridge_headers(self) -> Dict[str, str]:
        """Common headers for bridge requests (includes auth secret)."""
        return {"X-Bridge-Secret": BRIDGE_SECRET}

    def _call_bridge(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Call a backend tool via the HTTP bridge. Raises RuntimeError on failure."""
        self._check_rate_limit()
        try:
            resp = requests.post(
                f"{BRIDGE_URL}/tool/{quote(tool_name, safe='')}",
                json=args,
                headers=self._bridge_headers(),
                timeout=_HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            raise RuntimeError(f"Bridge call to '{tool_name}' failed: {e}") from e

    def _call_embed(self, text: str) -> List[float]:
        """Generate embedding vector via the backend EmbeddingService."""
        self._check_rate_limit()
        try:
            resp = requests.post(
                f"{BRIDGE_URL}/embed",
                json={"text": text},
                headers=self._bridge_headers(),
                timeout=_HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("vector", [])
        except requests.RequestException as e:
            raise RuntimeError(f"Embedding generation failed: {e}") from e

    # ---- File operations (via bridge) ----

    def read_file(self, path: str) -> str:
        """Read a file from the user's project."""
        result = self._call_bridge("read_file", {"path": path})
        if result.get("success"):
            output = result.get("output", "")
            # output is already a parsed dict/string from JSON bridge
            if isinstance(output, dict):
                return output.get("content", str(output))
            return str(output)
        raise RuntimeError(result.get("error", "read_file failed"))

    def write_file(self, path: str, content: str) -> str:
        """Write content to a file in the user's project."""
        result = self._call_bridge("write_file", {"path": path, "content": content})
        if result.get("success"):
            output = result.get("output", "File written")
            if isinstance(output, dict):
                return output.get("message", str(output))
            return str(output)
        raise RuntimeError(result.get("error", "write_file failed"))

    def list_files(self, path: str = "") -> List[Any]:
        """List files and folders in the user's project."""
        result = self._call_bridge("list_files", {"path": path})
        if result.get("success"):
            output = result.get("output", {})
            # output is already a parsed object from JSON bridge
            if isinstance(output, dict):
                return output.get("files", [])
            if isinstance(output, list):
                return output
            return [output]
        raise RuntimeError(result.get("error", "list_files failed"))

    # ---- Web search (via bridge to WebSearchService) ----

    def web_search(self, query: str) -> List[Any]:
        """Search the web. Returns list of {url, title, snippet}."""
        result = self._call_bridge("web_search", {"query": query})
        if result.get("success"):
            output = result.get("output", {})
            if isinstance(output, dict):
                return output.get("results", [])
            if isinstance(output, list):
                return output
            return [output]
        raise RuntimeError(result.get("error", "web_search failed"))

    # ---- Direct web access (SSRF-protected) ----

    def http_get(self, url: str, headers: Optional[Dict[str, str]] = None) -> str:
        """HTTP GET request. Returns response body as text. No redirects (SSRF prevention)."""
        _validate_url(url)
        self._check_rate_limit()
        try:
            resp = requests.get(
                url,
                headers=headers or {},
                timeout=_HTTP_TIMEOUT,
                stream=True,
                allow_redirects=False,
            )
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                raise RuntimeError("Redirects are not permitted from the sandbox")
            resp.raise_for_status()
            return _stream_content(resp, _MAX_CONTENT_LENGTH)
        except requests.RequestException as e:
            raise RuntimeError(f"HTTP GET failed: {e}") from e

    def web_extract(self, url: str) -> str:
        """Extract clean text from a web page using trafilatura (fallback: BS4).
        SECURITY: Does NOT use trafilatura.fetch_url (follows redirects without SSRF check).
        Downloads content ourselves with redirect blocking, then passes HTML to trafilatura.extract().
        """
        _validate_url(url)
        self._check_rate_limit()

        # Download content ourselves (no redirects — prevents SSRF via redirect)
        try:
            resp = requests.get(
                url, timeout=_HTTP_TIMEOUT, stream=True, allow_redirects=False,
            )
            if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
                raise RuntimeError("Redirects are not permitted from the sandbox")
            resp.raise_for_status()
            raw = _stream_content(resp, _MAX_CONTENT_LENGTH)
        except requests.RequestException as e:
            raise RuntimeError(f"web_extract download failed: {e}") from e

        # Try trafilatura extraction on downloaded HTML
        try:
            import trafilatura

            text = trafilatura.extract(
                raw,
                include_links=False,
                include_images=False,
                include_tables=True,
                favor_recall=True,
            )
            if text:
                return text[:5000]
        except ImportError:
            pass  # trafilatura not installed — fall through to BS4
        except Exception as exc:
            logger.warning("trafilatura extraction failed for %s: %s", url, exc)

        # Fallback: BeautifulSoup (html.parser is safer than lxml for untrusted HTML)
        try:
            from bs4 import BeautifulSoup

            soup = BeautifulSoup(raw, "html.parser")
            # Remove script, style, nav, footer
            for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            return text[:5000]
        except Exception as e:
            raise RuntimeError(f"web_extract failed: {e}") from e

    # ---- Qdrant vector operations ----

    def vector_search(
        self,
        query: str,
        collection: str = "document_chunks",
        top_k: int = 5,
        score_threshold: float = 0.7,
    ) -> List[Dict[str, Any]]:
        """Semantic search in Qdrant. Returns list of {content, score, metadata}."""
        _validate_collection(collection)

        # Step 1: get embedding via bridge
        vector = self._call_embed(query)
        if not vector:
            raise RuntimeError("Failed to generate embedding for query")

        # Step 2: search Qdrant directly
        self._check_rate_limit()
        try:
            resp = requests.post(
                f"{QDRANT_URL}/collections/{quote(collection, safe='')}/points/search",
                json={
                    "vector": vector,
                    "limit": min(top_k, 20),
                    "score_threshold": score_threshold,
                    "with_payload": True,
                },
                timeout=_HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            results: List[Dict[str, Any]] = []
            for point in data.get("result", []):
                payload = point.get("payload", {})
                results.append({
                    "content": payload.get("content", ""),
                    "score": round(point.get("score", 0), 4),
                    "metadata": {
                        k: v for k, v in payload.items() if k != "content"
                    },
                })
            return results
        except requests.RequestException as e:
            raise RuntimeError(f"Qdrant search failed: {e}") from e

    def vector_upsert(
        self,
        text: str,
        metadata: Optional[Dict[str, Any]] = None,
        collection: str = "document_chunks",
    ) -> bool:
        """Upsert a text + embedding into Qdrant."""
        _validate_collection(collection)

        # Step 1: get embedding
        vector = self._call_embed(text)
        if not vector:
            raise RuntimeError("Failed to generate embedding")

        # Step 2: upsert to Qdrant
        self._check_rate_limit()
        point_id = str(uuid.uuid4())
        payload: Dict[str, Any] = {"content": text}
        if metadata:
            # Prevent overwriting reserved 'content' key
            safe_meta = {k: v for k, v in metadata.items() if k != "content"}
            payload.update(safe_meta)

        try:
            resp = requests.put(
                f"{QDRANT_URL}/collections/{quote(collection, safe='')}/points",
                json={
                    "points": [{
                        "id": point_id,
                        "vector": vector,
                        "payload": payload,
                    }]
                },
                timeout=_HTTP_TIMEOUT,
            )
            resp.raise_for_status()
            return True
        except requests.RequestException as e:
            raise RuntimeError(f"Qdrant upsert failed: {e}") from e

    # ---- Data analysis ----

    def dataframe(self, data: Any) -> "Any":
        """Create a pandas DataFrame from data (list of dicts, dict of lists, etc.)."""
        import pandas as pd

        return pd.DataFrame(data)
