"""
Nooterra LlamaIndex Integration - The Vampire Bridge

Allows LlamaIndex pipelines to hire Nooterra agents as data retrievers/processors.

LlamaIndex is the de-facto standard for RAG (Retrieval-Augmented Generation).
This bridge lets any LlamaIndex query engine use Nooterra agents as:
- Custom retrievers (search agents)
- Document processors (OCR, extraction agents)
- External data sources (web scrapers, API callers)

Usage:
    from llama_index.core import VectorStoreIndex, Settings
    from nooterra.integrations.llamaindex import NooterraRetriever, NooterraTool

    # Use as a retriever in RAG
    retriever = NooterraRetriever(capability="cap.search.web.v1")
    index = VectorStoreIndex.from_documents(docs, retriever=retriever)

    # Or as a tool for agents
    tool = NooterraTool(
        capability="cap.browser.scrape.v1",
        name="web_scraper",
        description="Scrape websites for content"
    )

Installation:
    pip install nooterra[llamaindex]
    # or: pip install nooterra llama-index
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Sequence, TYPE_CHECKING

if TYPE_CHECKING:
    from llama_index.core.schema import NodeWithScore, QueryBundle
    from llama_index.core.retrievers import BaseRetriever
    from llama_index.core.tools import BaseTool, ToolMetadata

from ..client import NooterraClient, NooterraError


# Check for llama-index
try:
    from llama_index.core.schema import NodeWithScore, TextNode, QueryBundle
    from llama_index.core.retrievers import BaseRetriever
    from llama_index.core.tools import FunctionTool, ToolMetadata
    HAS_LLAMAINDEX = True
except ImportError:
    HAS_LLAMAINDEX = False
    BaseRetriever = object
    NodeWithScore = None
    TextNode = None
    QueryBundle = None
    FunctionTool = None
    ToolMetadata = None


class NooterraRetriever(BaseRetriever if HAS_LLAMAINDEX else object):
    """
    A LlamaIndex retriever that fetches data from Nooterra agents.
    
    Use this when you want to augment your RAG pipeline with external
    data sources via Nooterra. For example:
    - Web search agents
    - Database query agents
    - API integration agents
    
    Args:
        capability: Nooterra capability ID (e.g., "cap.search.web.v1")
        top_k: Number of results to return (default: 5)
        budget_limit: Max NCR credits per retrieval (default: 50)
        timeout: Seconds to wait for results (default: 60)
    
    Example:
        retriever = NooterraRetriever(
            capability="cap.search.web.v1",
            top_k=5
        )
        nodes = retriever.retrieve("What is Nooterra?")
    """
    
    def __init__(
        self,
        capability: str,
        top_k: int = 5,
        budget_limit: int = 50,
        timeout: int = 60,
        coordinator_url: Optional[str] = None,
        registry_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        if not HAS_LLAMAINDEX:
            raise ImportError(
                "LlamaIndex is not installed. Install with: pip install nooterra[llamaindex]"
            )
        
        super().__init__()
        
        self.capability = capability
        self.top_k = top_k
        self.budget_limit = budget_limit
        self.timeout = timeout
        
        self._client = NooterraClient(
            coordinator_url=coordinator_url or os.environ.get(
                "COORD_URL", "https://coord.nooterra.ai"
            ),
            registry_url=registry_url or os.environ.get(
                "REGISTRY_URL", "https://api.nooterra.ai"
            ),
            coordinator_api_key=api_key or os.environ.get("NOOTERRA_API_KEY", ""),
            registry_api_key=api_key or os.environ.get("NOOTERRA_API_KEY", ""),
        )
    
    def _retrieve(self, query_bundle: "QueryBundle") -> List["NodeWithScore"]:
        """Retrieve nodes from Nooterra agent."""
        query_str = query_bundle.query_str
        
        try:
            # Publish task to Nooterra
            task_id = self._client.publish_task(
                description=f"[{self.capability}] {query_str}",
                budget=self.budget_limit / 100.0
            )
            
            # Poll for result
            import requests
            start_time = time.time()
            result = None
            
            while time.time() - start_time < self.timeout:
                try:
                    resp = requests.get(
                        f"{self._client.coordinator_url}/v1/tasks/{task_id}",
                        headers={"x-api-key": self._client.coordinator_api_key} if self._client.coordinator_api_key else {},
                        timeout=10
                    )
                    if resp.ok:
                        data = resp.json()
                        if data.get("status") == "completed":
                            result = data.get("result", {})
                            break
                        elif data.get("status") in ("failed", "cancelled"):
                            return []
                except Exception:
                    pass
                time.sleep(1)
            
            if result is None:
                return []
            
            # Convert result to nodes
            return self._result_to_nodes(result)
            
        except Exception as e:
            print(f"[Nooterra] Retrieval error: {e}")
            return []
    
    def _result_to_nodes(self, result: Any) -> List["NodeWithScore"]:
        """Convert Nooterra result to LlamaIndex nodes."""
        nodes = []
        
        # Handle different result formats
        if isinstance(result, dict):
            # If result has items/documents/results list
            items = (
                result.get("items") or 
                result.get("documents") or 
                result.get("results") or
                result.get("data") or
                [result]
            )
        elif isinstance(result, list):
            items = result
        else:
            items = [{"text": str(result)}]
        
        for i, item in enumerate(items[:self.top_k]):
            if isinstance(item, dict):
                text = item.get("text") or item.get("content") or item.get("snippet") or str(item)
                metadata = {k: v for k, v in item.items() if k not in ("text", "content", "snippet")}
            else:
                text = str(item)
                metadata = {}
            
            node = TextNode(
                text=text,
                metadata=metadata,
                id_=f"nooterra_{i}"
            )
            
            # Score based on position (first = best)
            score = 1.0 - (i * 0.1)
            nodes.append(NodeWithScore(node=node, score=score))
        
        return nodes


class NooterraTool:
    """
    A LlamaIndex-compatible tool that calls Nooterra agents.
    
    Use this in LlamaIndex agent workflows to give your agents
    access to Nooterra capabilities.
    
    Args:
        capability: Nooterra capability ID
        name: Tool name (for the LLM)
        description: Tool description (for the LLM)
        budget_limit: Max NCR credits per call
        timeout: Seconds to wait for result
    
    Example:
        from llama_index.core.agent import ReActAgent
        
        tool = NooterraTool(
            capability="cap.browser.scrape.v1",
            name="web_scraper",
            description="Scrape content from websites"
        )
        
        agent = ReActAgent.from_tools([tool.to_llamaindex_tool()])
    """
    
    def __init__(
        self,
        capability: str,
        name: str,
        description: str,
        budget_limit: int = 100,
        timeout: int = 120,
        coordinator_url: Optional[str] = None,
        registry_url: Optional[str] = None,
        api_key: Optional[str] = None,
    ):
        if not HAS_LLAMAINDEX:
            raise ImportError(
                "LlamaIndex is not installed. Install with: pip install nooterra[llamaindex]"
            )
        
        self.capability = capability
        self.name = name
        self.description = description
        self.budget_limit = budget_limit
        self.timeout = timeout
        
        self._client = NooterraClient(
            coordinator_url=coordinator_url or os.environ.get(
                "COORD_URL", "https://coord.nooterra.ai"
            ),
            registry_url=registry_url or os.environ.get(
                "REGISTRY_URL", "https://api.nooterra.ai"
            ),
            coordinator_api_key=api_key or os.environ.get("NOOTERRA_API_KEY", ""),
            registry_api_key=api_key or os.environ.get("NOOTERRA_API_KEY", ""),
        )
    
    def __call__(self, query: str) -> str:
        """Execute the tool."""
        try:
            # Publish task
            task_id = self._client.publish_task(
                description=f"[{self.capability}] {query}",
                budget=self.budget_limit / 100.0
            )
            
            # Poll for result
            import requests
            start_time = time.time()
            
            while time.time() - start_time < self.timeout:
                try:
                    resp = requests.get(
                        f"{self._client.coordinator_url}/v1/tasks/{task_id}",
                        headers={"x-api-key": self._client.coordinator_api_key} if self._client.coordinator_api_key else {},
                        timeout=10
                    )
                    if resp.ok:
                        data = resp.json()
                        if data.get("status") == "completed":
                            result = data.get("result", {})
                            if isinstance(result, dict):
                                return str(result.get("output") or result.get("text") or result)
                            return str(result)
                        elif data.get("status") in ("failed", "cancelled"):
                            return f"Task failed: {data.get('error', 'Unknown error')}"
                except Exception:
                    pass
                time.sleep(2)
            
            return f"Task timed out after {self.timeout}s"
            
        except Exception as e:
            return f"Error: {e}"
    
    def to_llamaindex_tool(self) -> "FunctionTool":
        """Convert to a LlamaIndex FunctionTool."""
        return FunctionTool.from_defaults(
            fn=self.__call__,
            name=self.name,
            description=self.description
        )


def create_nooterra_toolkit(
    capabilities: Optional[List[str]] = None,
    **kwargs
) -> List["FunctionTool"]:
    """
    Create a toolkit of Nooterra tools for LlamaIndex agents.
    
    Args:
        capabilities: List of capability shortnames to include, or None for all
        **kwargs: Passed to NooterraTool constructor
    
    Returns:
        List of LlamaIndex FunctionTools
    
    Example:
        from llama_index.core.agent import ReActAgent
        
        tools = create_nooterra_toolkit(["browser", "vision", "search"])
        agent = ReActAgent.from_tools(tools)
    """
    if not HAS_LLAMAINDEX:
        raise ImportError(
            "LlamaIndex is not installed. Install with: pip install nooterra[llamaindex]"
        )
    
    TOOLKIT = {
        "browser": {
            "capability": "cap.browser.scrape.v1",
            "name": "nooterra_browser",
            "description": "Browse and scrape websites, take screenshots"
        },
        "vision": {
            "capability": "cap.vision.analyze.v1",
            "name": "nooterra_vision",
            "description": "Analyze images, extract text (OCR)"
        },
        "search": {
            "capability": "cap.search.web.v1",
            "name": "nooterra_search",
            "description": "Search the web for information"
        },
        "translate": {
            "capability": "cap.text.translate.v1",
            "name": "nooterra_translate",
            "description": "Translate text between languages"
        },
        "summarize": {
            "capability": "cap.text.summarize.v1",
            "name": "nooterra_summarize",
            "description": "Summarize long documents"
        },
        "code": {
            "capability": "cap.code.execute.v1",
            "name": "nooterra_code",
            "description": "Execute code in sandbox"
        },
    }
    
    if capabilities is None:
        capabilities = list(TOOLKIT.keys())
    
    tools = []
    for cap_name in capabilities:
        if cap_name not in TOOLKIT:
            continue
        config = TOOLKIT[cap_name]
        tool = NooterraTool(
            capability=config["capability"],
            name=config["name"],
            description=config["description"],
            **kwargs
        )
        tools.append(tool.to_llamaindex_tool())
    
    return tools
