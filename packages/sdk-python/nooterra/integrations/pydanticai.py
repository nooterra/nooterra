"""
Nooterra PydanticAI Integration - The Vampire Bridge

Allows PydanticAI agents to hire Nooterra specialists via type-safe dependency injection.

PydanticAI is the modern, type-safe framework for building AI agents.
This bridge provides:
- Type-safe tool definitions using Pydantic models
- Dependency injection for Nooterra client
- Async-first design

Usage:
    from pydantic_ai import Agent
    from nooterra.integrations.pydanticai import nooterra_tool, NooterraContext

    agent = Agent(
        'openai:gpt-4',
        deps_type=NooterraContext,
    )

    @agent.tool
    async def analyze_image(ctx: RunContext[NooterraContext], image_url: str) -> str:
        '''Analyze an image using a vision specialist.'''
        return await ctx.deps.hire_agent(
            capability="cap.vision.analyze.v1",
            instructions=f"Analyze this image: {image_url}"
        )

Installation:
    pip install nooterra[pydanticai]
    # or: pip install nooterra pydantic-ai
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from pydantic_ai import RunContext

from ..client import NooterraClient, NooterraError


# Check for pydantic-ai
try:
    from pydantic_ai import Agent, RunContext
    from pydantic import BaseModel, Field
    HAS_PYDANTICAI = True
except ImportError:
    HAS_PYDANTICAI = False
    Agent = None
    RunContext = None
    BaseModel = object
    Field = lambda *args, **kwargs: None


@dataclass
class NooterraContext:
    """
    Dependency injection context for PydanticAI agents.
    
    Use this as your deps_type to give your agent access to Nooterra.
    
    Example:
        from pydantic_ai import Agent
        from nooterra.integrations.pydanticai import NooterraContext
        
        agent = Agent('openai:gpt-4', deps_type=NooterraContext)
        
        @agent.tool
        async def search_web(ctx: RunContext[NooterraContext], query: str) -> str:
            return await ctx.deps.hire_agent(
                capability="cap.search.web.v1",
                instructions=query
            )
        
        # Run with context
        result = await agent.run(
            "Search for Nooterra",
            deps=NooterraContext()
        )
    """
    
    coordinator_url: str = field(
        default_factory=lambda: os.environ.get("COORD_URL", "https://coord.nooterra.ai")
    )
    registry_url: str = field(
        default_factory=lambda: os.environ.get("REGISTRY_URL", "https://api.nooterra.ai")
    )
    api_key: str = field(
        default_factory=lambda: os.environ.get("NOOTERRA_API_KEY", "")
    )
    default_budget: int = 100  # NCR credits (100 = $1.00)
    default_timeout: int = 120  # seconds
    
    _client: Optional[NooterraClient] = field(default=None, repr=False)
    
    @property
    def client(self) -> NooterraClient:
        """Lazily initialize the Nooterra client."""
        if self._client is None:
            self._client = NooterraClient(
                coordinator_url=self.coordinator_url,
                registry_url=self.registry_url,
                coordinator_api_key=self.api_key,
                registry_api_key=self.api_key,
            )
        return self._client
    
    async def hire_agent(
        self,
        capability: str,
        instructions: str,
        context: str = "",
        budget_limit: Optional[int] = None,
        timeout: Optional[int] = None,
    ) -> str:
        """
        Hire a Nooterra agent to perform a task.
        
        Args:
            capability: Nooterra capability ID (e.g., "cap.vision.analyze.v1")
            instructions: What you want the agent to do
            context: Additional context (URLs, data, etc.)
            budget_limit: Max NCR credits for this call
            timeout: Seconds to wait for result
        
        Returns:
            The result from the Nooterra agent
        """
        budget = budget_limit or self.default_budget
        wait_time = timeout or self.default_timeout
        
        try:
            # Build task description
            task_desc = f"[{capability}] {instructions}"
            if context:
                task_desc += f"\n\nContext:\n{context}"
            
            # Publish task
            task_id = self.client.publish_task(
                description=task_desc,
                budget=budget / 100.0
            )
            
            # Poll for result (async-friendly)
            import asyncio
            import aiohttp
            
            start_time = time.time()
            
            async with aiohttp.ClientSession() as session:
                while time.time() - start_time < wait_time:
                    try:
                        headers = {}
                        if self.api_key:
                            headers["x-api-key"] = self.api_key
                        
                        async with session.get(
                            f"{self.coordinator_url}/v1/tasks/{task_id}",
                            headers=headers,
                            timeout=aiohttp.ClientTimeout(total=10)
                        ) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                status = data.get("status", "")
                                
                                if status == "completed":
                                    result = data.get("result", {})
                                    if isinstance(result, dict):
                                        return str(
                                            result.get("output") or
                                            result.get("text") or
                                            result.get("response") or
                                            result
                                        )
                                    return str(result)
                                
                                elif status in ("failed", "cancelled"):
                                    return f"Task {status}: {data.get('error', 'Unknown error')}"
                    except Exception:
                        pass
                    
                    await asyncio.sleep(2)
            
            return f"Task timed out after {wait_time}s"
            
        except Exception as e:
            return f"Error: {e}"
    
    async def discover_agents(
        self,
        query: str,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Discover agents on the Nooterra network.
        
        Args:
            query: Search query (capability or description)
            limit: Max number of agents to return
        
        Returns:
            List of agent info dicts
        """
        try:
            result = self.client.discovery(query=query, limit=limit)
            return result.get("agents", [])
        except Exception:
            return []


# Pre-built tool functions for common capabilities

async def nooterra_browse(
    ctx: "RunContext[NooterraContext]",
    url: str,
    instructions: str = "Extract the main content"
) -> str:
    """
    Browse a website using a Nooterra browser agent.
    
    Args:
        url: The URL to browse
        instructions: What to extract from the page
    
    Returns:
        The extracted content
    """
    return await ctx.deps.hire_agent(
        capability="cap.browser.scrape.v1",
        instructions=instructions,
        context=url
    )


async def nooterra_vision(
    ctx: "RunContext[NooterraContext]",
    image_url: str,
    instructions: str = "Describe this image in detail"
) -> str:
    """
    Analyze an image using a Nooterra vision agent.
    
    Args:
        image_url: URL of the image to analyze
        instructions: What to look for in the image
    
    Returns:
        Analysis of the image
    """
    return await ctx.deps.hire_agent(
        capability="cap.vision.analyze.v1",
        instructions=instructions,
        context=image_url
    )


async def nooterra_search(
    ctx: "RunContext[NooterraContext]",
    query: str
) -> str:
    """
    Search the web using a Nooterra search agent.
    
    Args:
        query: Search query
    
    Returns:
        Search results
    """
    return await ctx.deps.hire_agent(
        capability="cap.search.web.v1",
        instructions=query
    )


async def nooterra_translate(
    ctx: "RunContext[NooterraContext]",
    text: str,
    target_language: str,
    source_language: str = "auto"
) -> str:
    """
    Translate text using a Nooterra translation agent.
    
    Args:
        text: Text to translate
        target_language: Target language code (e.g., "es", "fr", "de")
        source_language: Source language code or "auto" for detection
    
    Returns:
        Translated text
    """
    return await ctx.deps.hire_agent(
        capability="cap.text.translate.v1",
        instructions=f"Translate to {target_language}: {text}",
        context=f"Source language: {source_language}"
    )


async def nooterra_summarize(
    ctx: "RunContext[NooterraContext]",
    text: str,
    max_length: int = 500
) -> str:
    """
    Summarize text using a Nooterra summarization agent.
    
    Args:
        text: Text to summarize
        max_length: Maximum length of summary in words
    
    Returns:
        Summary
    """
    return await ctx.deps.hire_agent(
        capability="cap.text.summarize.v1",
        instructions=f"Summarize in {max_length} words or less",
        context=text
    )


async def nooterra_code(
    ctx: "RunContext[NooterraContext]",
    code: str,
    language: str = "python"
) -> str:
    """
    Execute code in a sandbox using a Nooterra code agent.
    
    Args:
        code: Code to execute
        language: Programming language
    
    Returns:
        Execution output
    """
    return await ctx.deps.hire_agent(
        capability="cap.code.execute.v1",
        instructions=f"Execute this {language} code and return the output",
        context=code
    )


def create_nooterra_agent(
    model: str = "openai:gpt-4",
    system_prompt: Optional[str] = None,
    include_tools: Optional[List[str]] = None,
) -> "Agent[NooterraContext, str]":
    """
    Create a PydanticAI agent pre-configured with Nooterra tools.
    
    Args:
        model: The LLM model to use
        system_prompt: Optional system prompt
        include_tools: List of tool names to include, or None for all
    
    Returns:
        A PydanticAI Agent with Nooterra capabilities
    
    Example:
        agent = create_nooterra_agent(
            model="openai:gpt-4",
            include_tools=["browse", "vision", "search"]
        )
        
        result = await agent.run(
            "Search for Nooterra and summarize what it is",
            deps=NooterraContext()
        )
    """
    if not HAS_PYDANTICAI:
        raise ImportError(
            "PydanticAI is not installed. Install with: pip install nooterra[pydanticai]"
        )
    
    TOOLS = {
        "browse": nooterra_browse,
        "vision": nooterra_vision,
        "search": nooterra_search,
        "translate": nooterra_translate,
        "summarize": nooterra_summarize,
        "code": nooterra_code,
    }
    
    if include_tools is None:
        include_tools = list(TOOLS.keys())
    
    # Create agent
    agent = Agent(
        model,
        deps_type=NooterraContext,
        system_prompt=system_prompt or (
            "You are a helpful assistant with access to the Nooterra network. "
            "You can hire specialized AI agents for tasks like web browsing, "
            "image analysis, translation, and code execution."
        ),
    )
    
    # Register tools
    for tool_name in include_tools:
        if tool_name in TOOLS:
            agent.tool(TOOLS[tool_name])
    
    return agent
