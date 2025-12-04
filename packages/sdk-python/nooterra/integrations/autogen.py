"""
Nooterra AutoGen Integration - The Vampire Bridge

Allows AutoGen conversable agents to hire specialists on the Nooterra network.

Usage:
    from autogen import UserProxyAgent, AssistantAgent
    from nooterra.integrations.autogen import register_nooterra_tool

    # Create standard AutoGen agents
    assistant = AssistantAgent("coding_bot", llm_config={"model": "gpt-4"})
    user_proxy = UserProxyAgent("user", human_input_mode="NEVER")

    # Inject Nooterra superpowers
    register_nooterra_tool(
        caller=assistant,
        executor=user_proxy,
        capability="cap.browser.scrape.v1",
        name="web_scraper",
        description="Use this to scrape websites or search the web"
    )

    # Now the bot can browse the web via Nooterra
    user_proxy.initiate_chat(
        assistant,
        message="Go to ycombinator.com and tell me the top news"
    )

Installation:
    pip install nooterra[autogen]
    # or: pip install nooterra pyautogen
"""

from __future__ import annotations

import os
import time
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from autogen import ConversableAgent

from ..client import NooterraClient, NooterraError


def register_nooterra_tool(
    caller: "ConversableAgent",
    executor: "ConversableAgent",
    capability: str,
    name: str,
    description: str,
    budget_limit: int = 100,
    timeout: int = 120,
    coordinator_url: Optional[str] = None,
    registry_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Callable:
    """
    Register a Nooterra capability as an AutoGen function.
    
    This injects Nooterra superpowers into your AutoGen agents, allowing them
    to hire remote specialists for tasks they cannot do themselves.
    
    Args:
        caller: The agent that will call the function (usually AssistantAgent)
        executor: The agent that will execute the function (usually UserProxyAgent)
        capability: Nooterra capability ID (e.g., "cap.browser.scrape.v1")
        name: Name of the function (e.g., "web_scraper")
        description: Description shown to the LLM
        budget_limit: Max NCR credits per call (default: 100 = $1.00)
        timeout: How long to wait for results in seconds (default: 120)
        coordinator_url: Nooterra coordinator URL
        registry_url: Nooterra registry URL
        api_key: Nooterra API key
    
    Returns:
        The registered function
    
    Example:
        register_nooterra_tool(
            caller=assistant,
            executor=user_proxy,
            capability="cap.vision.analyze.v1",
            name="image_analyzer",
            description="Analyze images and extract information from them"
        )
    """
    try:
        from autogen import register_function
    except ImportError:
        raise ImportError(
            "AutoGen is not installed. Install with: pip install nooterra[autogen]"
        )
    
    # Create the Nooterra client
    client = NooterraClient(
        coordinator_url=coordinator_url or os.environ.get(
            "COORD_URL", "https://coord.nooterra.ai"
        ),
        registry_url=registry_url or os.environ.get(
            "REGISTRY_URL", "https://api.nooterra.ai"
        ),
        coordinator_api_key=api_key or os.environ.get("NOOTERRA_API_KEY", ""),
        registry_api_key=api_key or os.environ.get("NOOTERRA_API_KEY", ""),
    )
    
    def run_nooterra_task(instructions: str, context: str = "") -> str:
        """
        Hire a Nooterra agent to perform a task.
        
        Args:
            instructions: Detailed instructions for the remote agent
            context: Additional context or data (URLs, text, etc.)
        
        Returns:
            The result from the Nooterra agent
        """
        try:
            print(f"⚡ [Nooterra] Hiring agent for: {capability}...")
            
            # Step 1: Discover agents
            discovery = client.discovery(query=capability, limit=5)
            agents = discovery.get("agents", [])
            
            if not agents:
                return f"❌ No agents available for capability '{capability}'"
            
            # Step 2: Publish task
            task_description = f"[{capability}] {instructions}"
            if context:
                task_description += f"\n\nContext:\n{context}"
            
            task_id = client.publish_task(
                description=task_description,
                budget=budget_limit / 100.0
            )
            
            print(f"📋 [Nooterra] Task published: {task_id}")
            
            # Step 3: Poll for completion
            import requests
            start_time = time.time()
            result = None
            
            while time.time() - start_time < timeout:
                try:
                    resp = requests.get(
                        f"{client.coordinator_url}/v1/tasks/{task_id}",
                        headers={"x-api-key": client.coordinator_api_key} if client.coordinator_api_key else {},
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
                        
                        print(f"⏳ [Nooterra] Status: {status}...")
                except Exception:
                    pass
                
                time.sleep(2)
            
            if result is None:
                return f"⏱️ Task timed out after {timeout}s. Task ID: {task_id}"
            
            # Step 4: Extract output
            if isinstance(result, dict):
                output = (
                    result.get("output") or 
                    result.get("response") or 
                    result.get("text") or 
                    str(result)
                )
            else:
                output = str(result)
            
            print(f"✅ [Nooterra] Task completed!")
            return output
            
        except NooterraError as e:
            return f"❌ Nooterra Error: {str(e)}"
        except Exception as e:
            return f"❌ Error: {str(e)}"
    
    # Register with AutoGen
    register_function(
        run_nooterra_task,
        caller=caller,
        executor=executor,
        name=name,
        description=description,
    )
    
    return run_nooterra_task


def register_nooterra_toolkit(
    caller: "ConversableAgent",
    executor: "ConversableAgent",
    capabilities: Optional[List[str]] = None,
    budget_limit: int = 100,
    **kwargs
) -> Dict[str, Callable]:
    """
    Register multiple common Nooterra capabilities at once.
    
    Args:
        caller: The AssistantAgent
        executor: The UserProxyAgent
        capabilities: List of capabilities to register, or None for all
        budget_limit: Max NCR credits per call
        **kwargs: Additional args passed to register_nooterra_tool
    
    Returns:
        Dict mapping capability names to registered functions
    
    Example:
        tools = register_nooterra_toolkit(
            caller=assistant,
            executor=user_proxy,
            capabilities=["browser", "vision", "code"]
        )
    """
    TOOLKIT = {
        "browser": {
            "capability": "cap.browser.scrape.v1",
            "name": "nooterra_browser",
            "description": "Browse and scrape websites, take screenshots, search the web"
        },
        "vision": {
            "capability": "cap.vision.analyze.v1",
            "name": "nooterra_vision",
            "description": "Analyze images, extract text (OCR), describe visual content"
        },
        "image_gen": {
            "capability": "cap.image.generate.v1",
            "name": "nooterra_image_gen",
            "description": "Generate images from text descriptions using AI"
        },
        "code": {
            "capability": "cap.code.execute.v1",
            "name": "nooterra_code",
            "description": "Execute code in a sandboxed environment"
        },
        "translate": {
            "capability": "cap.text.translate.v1",
            "name": "nooterra_translate",
            "description": "Translate text between 100+ languages"
        },
        "summarize": {
            "capability": "cap.text.summarize.v1",
            "name": "nooterra_summarize",
            "description": "Summarize long documents or text"
        },
        "audio": {
            "capability": "cap.audio.transcribe.v1",
            "name": "nooterra_audio",
            "description": "Transcribe audio/video to text"
        },
        "search": {
            "capability": "cap.search.web.v1",
            "name": "nooterra_search",
            "description": "Search the web for information"
        },
    }
    
    if capabilities is None:
        capabilities = list(TOOLKIT.keys())
    
    registered = {}
    
    for cap_name in capabilities:
        if cap_name not in TOOLKIT:
            print(f"⚠️ Unknown capability: {cap_name}")
            continue
        
        config = TOOLKIT[cap_name]
        func = register_nooterra_tool(
            caller=caller,
            executor=executor,
            capability=config["capability"],
            name=config["name"],
            description=config["description"],
            budget_limit=budget_limit,
            **kwargs
        )
        registered[cap_name] = func
    
    return registered


# For compatibility with older AutoGen versions
def create_nooterra_function(
    capability: str,
    name: str,
    description: str,
    **kwargs
) -> Dict[str, Any]:
    """
    Create a function schema for manual registration with older AutoGen.
    
    Returns a dict with 'function' and 'schema' keys that can be used
    with agent.register_function() in older versions.
    """
    client = NooterraClient(
        coordinator_url=kwargs.get("coordinator_url") or os.environ.get(
            "COORD_URL", "https://coord.nooterra.ai"
        ),
        registry_url=kwargs.get("registry_url") or os.environ.get(
            "REGISTRY_URL", "https://api.nooterra.ai"
        ),
        coordinator_api_key=kwargs.get("api_key") or os.environ.get("NOOTERRA_API_KEY", ""),
        registry_api_key=kwargs.get("api_key") or os.environ.get("NOOTERRA_API_KEY", ""),
    )
    
    budget_limit = kwargs.get("budget_limit", 100)
    timeout = kwargs.get("timeout", 120)
    
    def func(instructions: str, context: str = "") -> str:
        # Same logic as run_nooterra_task above
        try:
            discovery = client.discovery(query=capability, limit=5)
            if not discovery.get("agents"):
                return f"No agents for {capability}"
            
            task_id = client.publish_task(
                description=f"[{capability}] {instructions}\n{context}",
                budget=budget_limit / 100.0
            )
            
            import requests
            start = time.time()
            while time.time() - start < timeout:
                resp = requests.get(
                    f"{client.coordinator_url}/v1/tasks/{task_id}",
                    headers={"x-api-key": client.coordinator_api_key} if client.coordinator_api_key else {},
                    timeout=10
                )
                if resp.ok:
                    data = resp.json()
                    if data.get("status") == "completed":
                        return str(data.get("result", {}).get("output", data.get("result")))
                    if data.get("status") in ("failed", "cancelled"):
                        return f"Failed: {data.get('error')}"
                time.sleep(2)
            
            return f"Timeout after {timeout}s"
        except Exception as e:
            return f"Error: {e}"
    
    schema = {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": {
                "instructions": {
                    "type": "string",
                    "description": "Detailed instructions for the remote agent"
                },
                "context": {
                    "type": "string",
                    "description": "Additional context (URLs, data, etc.)"
                }
            },
            "required": ["instructions"]
        }
    }
    
    return {"function": func, "schema": schema}
