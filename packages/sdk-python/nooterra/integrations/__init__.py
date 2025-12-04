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
"""

# Lazy imports to avoid requiring all dependencies
def __getattr__(name: str):
    if name == "NooterraTool":
        from .crewai import NooterraTool
        return NooterraTool
    if name == "register_nooterra_tool":
        from .autogen import register_nooterra_tool
        return register_nooterra_tool
    if name == "NooterraToolkit":
        from .crewai import NooterraToolkit
        return NooterraToolkit
    raise AttributeError(f"module 'nooterra.integrations' has no attribute '{name}'")

__all__ = [
    "NooterraTool",
    "NooterraToolkit",
    "register_nooterra_tool",
]
