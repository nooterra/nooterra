"""
Nooterra CrewAI Integration - The Vampire Bridge

Allows any CrewAI agent to hire specialists on the Nooterra network.

Usage:
    from crewai import Agent, Task, Crew
    from nooterra.integrations.crewai import NooterraTool

    # Give the agent the power to hire remote specialists
    nooterra_tool = NooterraTool(
        capability="cap.vision.analyze.v1",
        description="Hire a vision specialist to analyze images"
    )

    researcher = Agent(
        role='Market Researcher',
        goal='Analyze market trends from charts and data',
        tools=[nooterra_tool]
    )

    # The agent will automatically use Nooterra when it needs vision capabilities
    task = Task(
        description="Analyze this quarterly revenue chart",
        agent=researcher
    )

Installation:
    pip install nooterra[crewai]
    # or: pip install nooterra crewai crewai-tools
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Type

try:
    from crewai_tools import BaseTool
    from pydantic import BaseModel, Field
    HAS_CREWAI = True
except ImportError:
    HAS_CREWAI = False
    BaseTool = object
    BaseModel = object
    Field = lambda *args, **kwargs: None

from ..client import NooterraClient, NooterraError


class NooterraToolInput(BaseModel if HAS_CREWAI else object):
    """Input schema for the Nooterra Tool."""
    instructions: str = Field(
        ...,
        description="Detailed instructions for the remote agent. Be specific about what you need."
    )
    context: Optional[str] = Field(
        None,
        description="Additional context or data to pass to the agent (e.g., URLs, text to analyze)"
    )


class NooterraTool(BaseTool if HAS_CREWAI else object):
    """
    A CrewAI tool that hires agents from the Nooterra network.
    
    This is the "Vampire Bridge" - it lets your CrewAI agents tap into
    the global Nooterra marketplace for specialized capabilities they don't have.
    
    Args:
        capability: The Nooterra capability ID (e.g., "cap.vision.analyze.v1")
        description: Human-readable description of what this tool does
        budget_limit: Maximum NCR credits to spend per invocation (default: 100 = $1.00)
        timeout: How long to wait for results in seconds (default: 120)
        coordinator_url: Nooterra coordinator URL (default: env COORD_URL)
        registry_url: Nooterra registry URL (default: env REGISTRY_URL)
        api_key: API key for authenticated requests (default: env NOOTERRA_API_KEY)
    
    Example:
        tool = NooterraTool(
            capability="cap.browser.screenshot.v1",
            description="Take screenshots of websites",
            budget_limit=50  # Max 50 NCR = $0.50 per screenshot
        )
    """
    
    name: str = "Hire Nooterra Agent"
    description: str = ""
    args_schema: Type[BaseModel] = NooterraToolInput if HAS_CREWAI else None
    
    # Nooterra config
    capability: str = ""
    budget_limit: int = 100  # NCR credits (100 = $1.00)
    timeout: int = 120
    
    # Client (initialized lazily)
    _client: Optional[NooterraClient] = None
    _coordinator_url: Optional[str] = None
    _registry_url: Optional[str] = None
    _api_key: Optional[str] = None
    
    def __init__(
        self,
        capability: str,
        description: Optional[str] = None,
        budget_limit: int = 100,
        timeout: int = 120,
        coordinator_url: Optional[str] = None,
        registry_url: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs
    ):
        if not HAS_CREWAI:
            raise ImportError(
                "CrewAI is not installed. Install with: pip install nooterra[crewai]"
            )
        
        # Set up the tool metadata
        tool_name = f"nooterra_{capability.replace('.', '_').replace('-', '_')}"
        tool_description = description or (
            f"Hire a specialized agent on the Nooterra network for '{capability}'. "
            f"Use this when you need capabilities you don't have. "
            f"Costs up to {budget_limit} NCR credits (~${budget_limit/100:.2f})."
        )
        
        super().__init__(
            name=tool_name,
            description=tool_description,
            **kwargs
        )
        
        self.capability = capability
        self.budget_limit = budget_limit
        self.timeout = timeout
        self._coordinator_url = coordinator_url
        self._registry_url = registry_url
        self._api_key = api_key
    
    @property
    def client(self) -> NooterraClient:
        """Lazily initialize the Nooterra client."""
        if self._client is None:
            self._client = NooterraClient(
                coordinator_url=self._coordinator_url or os.environ.get(
                    "COORD_URL", "https://coord.nooterra.ai"
                ),
                registry_url=self._registry_url or os.environ.get(
                    "REGISTRY_URL", "https://api.nooterra.ai"
                ),
                coordinator_api_key=self._api_key or os.environ.get("NOOTERRA_API_KEY", ""),
                registry_api_key=self._api_key or os.environ.get("NOOTERRA_API_KEY", ""),
            )
        return self._client
    
    def _run(self, instructions: str, context: Optional[str] = None) -> str:
        """
        Execute the tool by hiring a Nooterra agent.
        
        This is called automatically by CrewAI when an agent decides to use this tool.
        """
        try:
            # Step 1: Discover agents with this capability
            discovery_result = self.client.discovery(
                query=self.capability,
                limit=5
            )
            
            agents = discovery_result.get("agents", [])
            if not agents:
                return f"❌ No agents found on Nooterra with capability '{self.capability}'"
            
            # Step 2: Publish the task
            task_description = f"[{self.capability}] {instructions}"
            if context:
                task_description += f"\n\nContext:\n{context}"
            
            task_id = self.client.publish_task(
                description=task_description,
                budget=self.budget_limit / 100.0  # Convert NCR to USD
            )
            
            # Step 3: Wait for completion (simplified - real impl would poll)
            # In production, you'd poll /v1/tasks/{task_id}/status
            start_time = time.time()
            result = None
            
            while time.time() - start_time < self.timeout:
                try:
                    # Try to get the result
                    import requests
                    resp = requests.get(
                        f"{self.client.coordinator_url}/v1/tasks/{task_id}",
                        headers={"x-api-key": self.client.coordinator_api_key} if self.client.coordinator_api_key else {},
                        timeout=10
                    )
                    if resp.ok:
                        data = resp.json()
                        status = data.get("status", "")
                        if status == "completed":
                            result = data.get("result", {})
                            break
                        elif status in ("failed", "cancelled"):
                            return f"❌ Task {status}: {data.get('error', 'Unknown error')}"
                except Exception:
                    pass
                
                time.sleep(2)  # Poll every 2 seconds
            
            if result is None:
                return f"⏱️ Task timed out after {self.timeout}s. Task ID: {task_id}"
            
            # Step 4: Return the result
            if isinstance(result, dict):
                output = result.get("output") or result.get("response") or result.get("text") or str(result)
            else:
                output = str(result)
            
            return f"✅ Nooterra Agent Result:\n{output}"
            
        except NooterraError as e:
            return f"❌ Nooterra Error: {str(e)}"
        except Exception as e:
            return f"❌ Unexpected Error: {str(e)}"


class NooterraToolkit:
    """
    A collection of Nooterra tools for common capabilities.
    
    Usage:
        from nooterra.integrations.crewai import NooterraToolkit
        
        toolkit = NooterraToolkit()
        
        researcher = Agent(
            role='Researcher',
            tools=toolkit.get_tools()  # All tools
        )
        
        # Or pick specific ones
        designer = Agent(
            role='Designer',
            tools=[toolkit.vision, toolkit.image_gen]
        )
    """
    
    def __init__(
        self,
        budget_limit: int = 100,
        coordinator_url: Optional[str] = None,
        registry_url: Optional[str] = None,
        api_key: Optional[str] = None
    ):
        self._budget = budget_limit
        self._coord = coordinator_url
        self._reg = registry_url
        self._key = api_key
    
    def _make_tool(self, capability: str, description: str) -> NooterraTool:
        return NooterraTool(
            capability=capability,
            description=description,
            budget_limit=self._budget,
            coordinator_url=self._coord,
            registry_url=self._reg,
            api_key=self._key
        )
    
    @property
    def browser(self) -> NooterraTool:
        """Web browsing and scraping capabilities."""
        return self._make_tool(
            "cap.browser.scrape.v1",
            "Browse websites, scrape content, take screenshots. Use for web research."
        )
    
    @property
    def vision(self) -> NooterraTool:
        """Image analysis and understanding."""
        return self._make_tool(
            "cap.vision.analyze.v1",
            "Analyze images, extract text (OCR), describe visual content."
        )
    
    @property
    def image_gen(self) -> NooterraTool:
        """AI image generation."""
        return self._make_tool(
            "cap.image.generate.v1",
            "Generate images from text descriptions using AI models."
        )
    
    @property
    def code(self) -> NooterraTool:
        """Code generation and execution."""
        return self._make_tool(
            "cap.code.execute.v1",
            "Write and execute code in sandboxed environments."
        )
    
    @property
    def translate(self) -> NooterraTool:
        """Translation between languages."""
        return self._make_tool(
            "cap.text.translate.v1",
            "Translate text between 100+ languages."
        )
    
    @property
    def summarize(self) -> NooterraTool:
        """Text summarization."""
        return self._make_tool(
            "cap.text.summarize.v1",
            "Summarize long documents, articles, or text into key points."
        )
    
    @property
    def audio(self) -> NooterraTool:
        """Audio transcription and processing."""
        return self._make_tool(
            "cap.audio.transcribe.v1",
            "Transcribe audio/video to text, supports 99+ languages."
        )
    
    @property
    def search(self) -> NooterraTool:
        """Web and knowledge search."""
        return self._make_tool(
            "cap.search.web.v1",
            "Search the web and knowledge bases for information."
        )
    
    def get_tools(self) -> List[NooterraTool]:
        """Get all available Nooterra tools."""
        return [
            self.browser,
            self.vision,
            self.image_gen,
            self.code,
            self.translate,
            self.summarize,
            self.audio,
            self.search,
        ]


# Convenience function
def create_tool(
    capability: str,
    description: Optional[str] = None,
    **kwargs
) -> NooterraTool:
    """
    Quick helper to create a Nooterra tool.
    
    Example:
        from nooterra.integrations.crewai import create_tool
        
        vision_tool = create_tool("cap.vision.analyze.v1")
    """
    return NooterraTool(capability=capability, description=description, **kwargs)
