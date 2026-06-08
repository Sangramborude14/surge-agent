# Google Antigravity SDK Dummy Package for version 2.0.0
# Real implementation is caught and handled via the fallback mock generator in agent.py

class LocalAgentConfig:
    def __init__(self, *args, **kwargs):
        pass

class Agent:
    def __init__(self, *args, **kwargs):
        pass
    
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass
        
    async def chat(self, *args, **kwargs):
        raise NotImplementedError("This is a dummy implementation of Google Antigravity SDK.")
