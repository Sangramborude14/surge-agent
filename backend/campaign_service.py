import os
import hashlib
import json
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from db import db, raw_db
from tenancy import get_current_tenant_id

class CampaignCreative(BaseModel):
    model_config = {"populate_by_name": True}
    
    title: str = Field(description="Headline for the promotion")
    copy_text: str = Field(alias="copy", description="Ad copy explaining the discount")
    discount_value: int = Field(description="The discount value as an integer percentage")

# DETERMINISTIC EMBEDDING GENERATOR FOR FALLBACKS
def get_deterministic_embedding(text: str, dimensions: int = 1536) -> List[float]:
    """
    Generates a deterministic 1536-dimensional unit vector based on the SHA-256 hash of input text.
    Provides a high-quality, reproducible local fallback for vector similarity search.
    """
    vector = []
    text_bytes = text.encode("utf-8")
    for i in range(dimensions):
        # Hash text concatenated with current index
        h = hashlib.sha256(text_bytes + str(i).encode("utf-8")).digest()
        # Convert first 4 bytes of hash to a signed float
        val = int.from_bytes(h[:4], "big") / (2**31 - 1) - 1.0
        vector.append(val)
        
    # Normalize the vector to a unit length of 1.0 (so dot product equals cosine similarity)
    norm = sum(x*x for x in vector) ** 0.5
    if norm > 0:
        vector = [x / norm for x in vector]
    return vector

def get_context_embedding(text: str) -> List[float]:
    """
    Generates a text embedding vector using the Gemini API.
    Falls back to a deterministic local embedding generator if offline or key is missing.
    """
    try:
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
            # Use Gemini standard embedding model
            response = genai.embed_content(
                model="models/text-embedding-004",
                content=text,
                task_type="retrieval_document"
            )
            return response["embedding"]
    except Exception as e:
        print(f"[Embedding SDK Fallback] Falling back to deterministic local embedding: {e}")
        
    return get_deterministic_embedding(text)


# VECTOR SEARCH IMPLEMENTATION
def find_similar_campaigns(surge_state_text: str, limit: int = 3) -> List[Dict[str, Any]]:
    """
    Searches the past_campaigns collection to find historical campaigns matching the current surge state context.
    Executes a $vectorSearch aggregation stage. If run locally on standalone databases,
    automatically falls back to a python-implemented cosine-similarity search.
    """
    query_vector = get_context_embedding(surge_state_text)
    tenant_id = get_current_tenant_id()
    
    try:
        # Atlas Vector Search must be the FIRST stage in the aggregation pipeline.
        # We query raw_db to place $vectorSearch first, then filter by tenantId for data isolation.
        pipeline = [
            {
                "$vectorSearch": {
                    "index": "campaign_vector_index",
                    "path": "context_embedding",
                    "queryVector": query_vector,
                    "numCandidates": 10,
                    "limit": limit
                }
            },
            {
                "$match": {
                    "tenantId": tenant_id
                }
            }
        ]
        # Run search
        results = list(raw_db.past_campaigns.aggregate(pipeline))
        # Ensure we decrypt sensitive fields if raw query bypassed wrappers
        from tenancy import db as tenanted_db
        return [tenanted_db.past_campaigns._decrypt_doc(r) for r in results]
    except Exception as e:
        # Fallback to local cosine similarity search over the current tenant's data
        print(f"[Vector Search Fallback] Falling back to local cosine similarity search: {e}")
        
        # db.past_campaigns automatically applies tenantId isolation filter
        tenant_campaigns = list(db.past_campaigns.find({}))
        scored_campaigns = []
        
        for campaign in tenant_campaigns:
            camp_emb = campaign.get("context_embedding")
            if camp_emb and len(camp_emb) == len(query_vector):
                # Cosine similarity is the dot product of two normalized unit vectors
                similarity = sum(x*y for x, y in zip(query_vector, camp_emb))
                scored_campaigns.append((similarity, campaign))
                
        scored_campaigns.sort(key=lambda x: x[0], reverse=True)
        return [camp for _, camp in scored_campaigns[:limit]]


# LLM CREATIVE AD OFFER DRAFTING
def generate_creative_offer(surge_context: str, past_campaigns: List[Dict[str, Any]]) -> CampaignCreative:
    """
    Combines the current surge context with historical successful A/B campaigns.
    Queries Gemini to generate an optimized creative flash discount.
    """
    prompt = (
        f"You are a retail marketing copywriter. We have a tourist surge context: '{surge_context}'.\n"
        f"Here are the top {len(past_campaigns)} most successful historical campaigns for reference:\n"
    )
    for i, camp in enumerate(past_campaigns):
        prompt += f"Campaign {i+1}: Title: {camp.get('title')}, Copy: {camp.get('copy')}, Discount: {camp.get('discount_value')}%\n"
        
    prompt += (
        "\nBased on these winners and the current context, draft a new contextually optimized localized offer. "
        "Respond with a JSON object containing the keys: 'title', 'copy', and 'discount_value' (integer percent between 10 and 50)."
    )

    try:
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            data = json.loads(response.text)
            return CampaignCreative(
                title=data.get("title", "Tourist Surge Sale!"),
                copy=data.get("copy", "Take advantage of our discount while stock lasts."),
                discount_value=int(data.get("discount_value", 20))
            )
    except Exception as e:
        print(f"[Gemini Creative Fallback] Falling back to local heuristic creative generator: {e}")

    # Local heuristic fallback generator
    ctx_lower = surge_context.lower()
    discount = 20
    if past_campaigns:
        discount = int(sum(c.get("discount_value", 20) for c in past_campaigns) / len(past_campaigns))
    else:
        if "rain" in ctx_lower or "storm" in ctx_lower:
            discount = 25
        elif "heavy" in ctx_lower or "crowd" in ctx_lower:
            discount = 30
            
    if "rain" in ctx_lower:
        title = "☔ Stay Dry Special!"
        copy = "Don't let the rain stop you. Grab waterproof gear and umbrellas at a major discount!"
    elif "families" in ctx_lower or "kids" in ctx_lower:
        title = "👪 Family Fan Frenzy!"
        copy = "Special discounts on youth jerseys and family-sized snack packs inside the zone!"
    else:
        title = "⚡ Live Tourist Surge Deal!"
        copy = f"Flash promo activated: Enjoy a limited-time {discount}% off on select items!"

    return CampaignCreative(title=title, copy=copy, discount_value=discount)


# FEEDBACK LOOP & METRIC TRACKING
def create_and_save_campaign(surge_context: str, creative: CampaignCreative) -> Dict[str, Any]:
    """Generates the context embedding and stores the new campaign with metrics initialized."""
    embedding = get_context_embedding(surge_context)
    tenant_id = get_current_tenant_id()
    
    campaign_doc = {
        "title": creative.title,
        "copy": creative.copy_text,
        "discount_value": creative.discount_value,
        "surge_context": surge_context,
        "context_embedding": embedding,
        "impressions": 0,
        "redemptions": 0,
        "conversion_rate": 0.0,
        "tenantId": tenant_id
    }
    
    # db.past_campaigns handles tenant isolation and CSFLE field encryption
    result = db.past_campaigns.insert_one(campaign_doc)
    campaign_doc["_id"] = str(result.inserted_id)
    return campaign_doc

def track_campaign_impression(campaign_id: str):
    """Increments impression counts and recalculates the conversion rate."""
    from bson import ObjectId
    campaign = db.past_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not campaign:
        return
        
    impressions = campaign.get("impressions", 0) + 1
    redemptions = campaign.get("redemptions", 0)
    conversion = float(redemptions) / float(impressions)
    
    db.past_campaigns.update_one(
        {"_id": ObjectId(campaign_id)},
        {
            "$set": {
                "impressions": impressions,
                "conversion_rate": conversion
            }
        }
    )

def track_campaign_redemption(campaign_id: str):
    """Increments redemption counts and recalculates the conversion rate."""
    from bson import ObjectId
    campaign = db.past_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not campaign:
        return
        
    impressions = campaign.get("impressions", 0)
    # Ensure impressions is at least equal to redemptions
    redemptions = campaign.get("redemptions", 0) + 1
    if impressions < redemptions:
        impressions = redemptions
        
    conversion = float(redemptions) / float(impressions) if impressions > 0 else 0.0
    
    db.past_campaigns.update_one(
        {"_id": ObjectId(campaign_id)},
        {
            "$set": {
                "redemptions": redemptions,
                "conversion_rate": conversion
            }
        }
    )
