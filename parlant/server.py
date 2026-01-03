#!/usr/bin/env python3
"""
Parlant Server for Enterprise AI Chat

This server provides a controlled AI agent framework with guidelines-based behavior.
Uses the start_parlant function for proper HTTP API exposure.
"""

import os
import asyncio
import parlant.sdk as p

# Configuration from environment
PORT = int(os.getenv("PARLANT_PORT", "8800"))
DATA_DIR = os.getenv("PARLANT_DATA_DIR", "/app/data")

# LLM Provider settings
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")


async def initialize_agents(container):
    """Initialize default agents after server starts."""
    try:
        # Get the server from container to create agents
        from parlant.core.agents import AgentStore
        agent_store = container[AgentStore]

        # Check if Enterprise Assistant already exists
        existing_agents = await agent_store.list_agents()
        agent_names = [a.name for a in existing_agents]

        if "Enterprise Assistant" not in agent_names:
            print("Creating Enterprise Assistant agent...")
            agent = await agent_store.create_agent(
                name="Enterprise Assistant",
                description="Enterprise AI assistant with controlled behavior and guidelines compliance"
            )
            print(f"Enterprise Assistant agent created with ID: {agent.id}")
        else:
            print("Enterprise Assistant agent already exists")

    except Exception as e:
        print(f"Warning: Could not initialize agents: {e}")


async def main():
    """Main server startup function."""
    print(f"Starting Parlant Server on port {PORT}")
    print(f"Data directory: {DATA_DIR}")

    # Set the home directory for Parlant data
    os.environ["PARLANT_HOME"] = DATA_DIR

    # Determine NLP service based on available keys
    if ANTHROPIC_API_KEY:
        nlp_service = "anthropic"
        os.environ["ANTHROPIC_API_KEY"] = ANTHROPIC_API_KEY
        print("Using Anthropic as LLM provider")
    elif OPENAI_API_KEY:
        nlp_service = "openai"
        os.environ["OPENAI_API_KEY"] = OPENAI_API_KEY
        print("Using OpenAI as LLM provider")
    else:
        print("Error: No LLM API key configured!")
        print("Please set OPENAI_API_KEY or ANTHROPIC_API_KEY")
        return

    # Create startup parameters
    params = p.StartupParameters(
        port=PORT,
        nlp_service=nlp_service,
        log_level="info",
        modules=[],
        migrate=True,
        initialize=initialize_agents
    )

    print(f"Starting Parlant server with {nlp_service} on port {PORT}...")

    # Start the server using async context manager
    async with p.start_parlant(params) as container:
        print(f"Parlant server started successfully!")
        print(f"API available at http://0.0.0.0:{PORT}")
        print(f"Endpoints: /agents, /sessions, /customers, etc.")

        # Keep the server running
        try:
            while True:
                await asyncio.sleep(3600)
        except asyncio.CancelledError:
            print("Server shutdown requested")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer shutdown requested")
    except Exception as e:
        print(f"Server error: {e}")
        import traceback
        traceback.print_exc()
        raise
