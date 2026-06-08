import os
import random
from pydantic import BaseModel, Field

class FlashPromotion(BaseModel):
    discount_code: str = Field(description="The discount code for the promotion")
    message: str = Field(description="The promotional message to display to the user")
    duration_minutes: int = Field(description="Duration of the flash promotion in minutes")

async def generate_promotion(store_name: str, item_name: str, current_stock: int, target_stock: int) -> FlashPromotion:
    """
    Generates a structured flash promotion using the google.antigravity SDK.
    If the SDK is not available or encounters runtime errors (e.g. missing API keys),
    it falls back to a local mock generator to ensure reliability for the demo.
    """
    prompt = (
        f"Generate a flash promotion for store '{store_name}' which has an excess stock of '{item_name}'. "
        f"Current stock is {current_stock} and target stock is {target_stock}. "
        f"Respond with a discount_code, message, and duration_minutes (15, 30, or 60)."
    )
    
    try:
        # Attempt to use google.antigravity SDK
        from google.antigravity import Agent, LocalAgentConfig
        
        config = LocalAgentConfig(
            system_instructions="You are a retail promotion agent. Generate discount codes and messages for surplus items."
        )
        async with Agent(config) as agent:
            # We attempt to chat and fetch structured output
            response = await agent.chat(prompt)
            if hasattr(response, "structured_output"):
                data = await response.structured_output()
                if isinstance(data, FlashPromotion):
                    return data
                elif isinstance(data, dict):
                    return FlashPromotion(**data)
            
            # If the response has text but no structured_output, try reading the text
            text = await response.text()
            # If it's a JSON string, try parsing it
            import json
            try:
                parsed = json.loads(text)
                return FlashPromotion(**parsed)
            except Exception:
                pass
                
            raise ValueError(f"Could not parse structured output from response: {text}")
            
    except Exception as e:
        # Fallback to local mock generator
        print(f"[Agent SDK Fallback] Using mock generator because: {e}")
        
        discount = random.choice([15, 20, 25, 30, 40, 50])
        # Clean store name for promo code
        clean_name = "".join(c for c in store_name if c.isalnum()).upper()
        discount_code = f"SURGE{discount}_{clean_name[:5]}"
        
        # Craft a compelling message
        message = f"Tourist Surge Alert! Get {discount}% off on '{item_name}' at {store_name}! Hurry, offer valid for a limited time."
        duration_minutes = random.choice([30, 45, 60])
        
        return FlashPromotion(
            discount_code=discount_code,
            message=message,
            duration_minutes=duration_minutes
        )

if __name__ == "__main__":
    import asyncio
    async def test():
        promo = await generate_promotion("World Cup Athletics", "World Cup Jersey", 150, 20)
        print(promo)
    asyncio.run(test())
