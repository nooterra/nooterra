"""
Nooterra Integrations - Vampire Bridges

Connect existing agent frameworks to the Nooterra network.

CrewAI:
    from nooterra.integrations.crewai import NooterraTool
    
    tool = NooterraTool(capability="cap.vision.analyze.v1")
    agent = Agent(role='Researcher', tools=[tool])

AutoGen:
    from nooterra.integrations.autogen import register_nooterra_tool
    
    register_nooterra_tool(
        caller=assistant,
        executor=user_proxy,
        capability="cap.browser.scrape.v1",
        name="web_scraper"
    )

LlamaIndex:
    from nooterra.integrations.llamaindex import NooterraRetriever, NooterraTool
    
    retriever = NooterraRetriever(capability="cap.search.web.v1")
    tool = NooterraTool(capability="cap.browser.scrape.v1", name="browser")

PydanticAI:
    from nooterra.integrations.pydanticai import NooterraContext, create_nooterra_agent
    
    agent = create_nooterra_agent(model="openai:gpt-4")
    result = await agent.run("Search for X", deps=NooterraContext())
"""

# Lazy imports to avoid requiring all dependencies
def __getattr__(name: str):
    if name == "NooterraTool":
        from .crewai import NooterraTool
        return NooterraTool
    if name == "NooterraToolkit":
        from .crewai import NooterraToolkit
        return NooterraToolkit
    if name == "register_nooterra_tool":
        from .autogen import register_nooterra_tool
        return register_nooterra_tool
    if name == "register_nooterra_toolkit":
        from .autogen import register_nooterra_toolkit
        return register_nooterra_toolkit
    if name == "NooterraRetriever":
        from .llamaindex import NooterraRetriever
        return NooterraRetriever
    if name == "NooterraContext":
        from .pydanticai import NooterraContext
        return NooterraContext
    if name == "create_nooterra_agent":
        from .pydanticai import create_nooterra_agent
        return create_nooterra_agent
    raise AttributeError(f"module 'nooterra.integrations' has no attribute '{name}'")

__all__ = [
    # CrewAI
    "NooterraTool",
    "NooterraToolkit",
    # AutoGen
    "register_nooterra_tool",
    "register_nooterra_toolkit",
    # LlamaIndex
    "NooterraRetriever",
    # PydanticAI
    "NooterraContext",
    "create_nooterra_agent",
]
