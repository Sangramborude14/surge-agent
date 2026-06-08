import os
import time
import random
import threading
from datetime import datetime, timezone
from typing import List, Dict, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from bson import ObjectId

from db import db, init_db, raw_db
from agent import generate_promotion
from seed import seed_data
from tenancy import set_current_tenant_id, get_current_tenant_id, set_global_default_tenant
from edge_compute import global_edge_buffer, get_zone_visitor_count, run_historical_rollup
from campaign_service import find_similar_campaigns, generate_creative_offer, create_and_save_campaign, track_campaign_impression, track_campaign_redemption
from reservation import allocate_surge_stock, claim_coupon

app = FastAPI(title="Tourist Surge Retail Agent Backend 2.0")

# Enable CORS for next.js app to query
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Multi-Tenant Interceptor Middleware
@app.middleware("http")
async def tenant_context_middleware(request: Request, call_next):
    # Enforce database isolation by intercepting header and binding to thread storage
    tenant_id = request.headers.get("X-Tenant-ID", get_current_tenant_id())
    set_current_tenant_id(tenant_id)
    response = await call_next(request)
    return response

# In-memory arrays for logs and active promotions
pipeline_logs: List[Dict[str, Any]] = []
active_promotions: List[Dict[str, Any]] = []

def add_log(message: str):
    timestamp = datetime.now(timezone.utc).isoformat()
    pipeline_logs.append({"timestamp": timestamp, "message": message})
    if len(pipeline_logs) > 200:
        pipeline_logs.pop(0)
    print(f"[{timestamp}] [Tenant: {get_current_tenant_id()}] {message}")

class SurgeRequest(BaseModel):
    coordinates: List[float] = Field(..., description="[longitude, latitude]")
    radius_meters: float = Field(..., description="Geospatial search radius in meters")

@app.on_event("startup")
async def startup_event():
    # Make sure DB is initialized and index is built on startup
    try:
        init_db()
        add_log("Application startup: Database initialized successfully.")
        
        # Start background threads for Edge Flusher & Historical Rollups
        start_background_jobs()
    except Exception as e:
        add_log(f"Application startup error initializing DB: {e}")

def start_background_jobs():
    def edge_flusher_loop():
        add_log("[Background Service] Sliding 10s edge flusher thread active.")
        while True:
            try:
                time.sleep(10)
                global_edge_buffer.flush_aggregated_buffer()
            except Exception as e:
                print(f"[Edge Flusher Error] {e}")

    def rollup_loop():
        add_log("[Background Service] Hourly historical trends rollup thread active.")
        while True:
            try:
                # In production, this runs hourly/daily. For demo and tests, we run it every 60s
                time.sleep(60)
                run_historical_rollup()
            except Exception as e:
                print(f"[Rollup Job Error] {e}")

    t1 = threading.Thread(target=edge_flusher_loop, daemon=True)
    t2 = threading.Thread(target=rollup_loop, daemon=True)
    t1.start()
    t2.start()


# ==========================================
# 1. EDGE-COMPUTE STREAM INGESTION ENDPOINT
# ==========================================
class EdgePingPayload(BaseModel):
    deviceId: str = Field(..., description="The unique hardware device address")
    gatewayId: str = Field(..., description="Identifier of the receiving Wi-Fi node")
    zoneId: str = Field(..., description="Mall zone identifier")
    tenantId: str = Field(..., description="Active tenant segment")
    signalStrength: float = Field(..., description="RSSI signal level in dBm")

@app.post("/api/edge/ingest")
async def ingest_edge_ping(payload: EdgePingPayload):
    try:
        global_edge_buffer.add_ping(
            device_id=payload.deviceId,
            gateway_id=payload.gatewayId,
            zone_id=payload.zoneId,
            tenant_id=payload.tenantId,
            signal_strength=payload.signalStrength
        )
        return {"status": "buffered", "deviceIdHash": global_edge_buffer.anonymize_device_id(payload.deviceId, payload.tenantId)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Edge buffering failed: {e}")


# ==========================================
# 2. GEMINI-DRIVEN VECTOR A/B TESTING ENDPOINT
# ==========================================
class CreateCampaignPayload(BaseModel):
    surgeContext: str = Field(..., description="State context representation (e.g., weather, time, crowds)")
    storeName: str = Field(..., description="Target retail store name")
    itemName: str = Field(..., description="Retail surplus item category")
    allocatedSurgeUnits: int = Field(..., description="Number of units reserved for flash promotion")

@app.post("/api/campaigns/create")
async def create_vector_campaign(payload: CreateCampaignPayload):
    tenant_id = get_current_tenant_id()
    add_log(f"Initiating A/B Campaign Creative Loop: '{payload.surgeContext}' for store '{payload.storeName}'")
    
    try:
        # Step A: MongoDB Atlas Vector Search for historical successful campaigns
        winners = find_similar_campaigns(payload.surgeContext, limit=3)
        add_log(f"Vector search matched {len(winners)} past successful campaigns.")
        
        # Step B: LLM Creative Generation using Gemini
        creative = generate_creative_offer(payload.surgeContext, winners)
        add_log(f"Gemini output - Title: '{creative.title}', Discount: {creative.discount_value}%")
        
        # Step C: Transactional Smart Inventory Reservation
        allocate_surge_stock(payload.storeName, payload.itemName, payload.allocatedSurgeUnits)
        add_log(f"Smart Reservation: Locked {payload.allocatedSurgeUnits} units of '{payload.itemName}' in transaction.")
        
        # Step D: Save newly created campaign document to historical database
        campaign = create_and_save_campaign(payload.surgeContext, creative)
        
        # Deploy campaign directly to active promotions signage deck
        discount_code = f"SURGE{creative.discount_value}_{payload.storeName.replace(' ', '')[:5].upper()}"
        promo_entry = {
            "id": campaign["_id"],
            "store_name": payload.storeName,
            "item": payload.itemName,
            "discount_code": discount_code,
            "message": f"⚡ {creative.title}: {creative.copy_text}",
            "duration_minutes": 30,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        active_promotions.append(promo_entry)
        track_campaign_impression(campaign["_id"])  # Register initial impression
        
        return {
            "status": "success",
            "campaign": campaign,
            "promotion": promo_entry
        }
    except Exception as e:
        add_log(f"A/B Campaign generation failure: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# 3. TRANSACTIONAL COUPON CLAIM ENDPOINT
# ==========================================
class ClaimCouponPayload(BaseModel):
    storeName: str = Field(..., description="Target retail store name")
    itemName: str = Field(..., description="Retail surplus item category")
    userId: str = Field(..., description="The claiming user identifier")
    campaignId: str = Field(..., description="The originating campaign identifier")

@app.post("/api/coupons/claim")
async def process_coupon_claim(payload: ClaimCouponPayload):
    add_log(f"Claim requested: User '{payload.userId}' for store '{payload.storeName}'")
    try:
        # Atomic inventory claiming transaction
        claim_coupon(payload.storeName, payload.itemName, payload.userId)
        
        # Track redemption conversion rates
        track_campaign_redemption(payload.campaignId)
        add_log(f"Redemption logged for campaign '{payload.campaignId}'")
        
        return {"status": "success", "message": "Coupon claimed and stock updated."}
    except ValueError as ve:
        add_log(f"Coupon claim rejected: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        add_log(f"Internal error processing claim: {e}")
        raise HTTPException(status_code=500, detail="Transaction claim failed.")


# ==========================================
# 4. MULTI-TENANT SWITCH CONTEXT ENDPOINT
# ==========================================
class SwitchTenantPayload(BaseModel):
    tenantId: str = Field(..., description="Target tenant code to switch context")

@app.post("/api/tenant/switch")
async def switch_tenant(payload: SwitchTenantPayload):
    try:
        set_global_default_tenant(payload.tenantId)
        set_current_tenant_id(payload.tenantId)
        add_log(f"Global tenant context switched successfully to '{payload.tenantId}'.")
        return {"status": "success", "currentTenantId": get_current_tenant_id()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==========================================
# EXISTING LEGACY COMPATIBILITY ENDPOINTS
# ==========================================
@app.post("/api/surge")
async def trigger_surge(request: SurgeRequest):
    if len(request.coordinates) != 2:
        raise HTTPException(status_code=400, detail="Coordinates must contain [longitude, latitude]")
    
    lng, lat = request.coordinates
    radius = request.radius_meters
    
    add_log(f"Surge Request: coordinates=[{lng}, {lat}], radius={radius} meters")
    triggered_promotions = []
    
    try:
        # 1. MongoDB geospatial query (uses Tenanted Wrapper, automatic isolation)
        t0 = time.time()
        query = {
            "location": {
                "$near": {
                    "$geometry": {
                        "type": "Point",
                        "coordinates": [lng, lat]
                    },
                    "$maxDistance": radius
                }
            }
        }
        nearby_stores = list(db.stores.find(query))
        t_query = time.time() - t0
        
        add_log(f"Geospatial Query: found {len(nearby_stores)} stores near [{lng}, {lat}] in {t_query:.4f}s")
        
        for store in nearby_stores:
            store_name = store["name"]
            item_name = store["item"]
            curr_stock = store["current_stock"]
            target_stock = store["target_stock"]
            
            # 2. Inventory evaluation
            if curr_stock > target_stock:
                add_log(f"Store '{store_name}' surplus detected: stock={curr_stock}, target={target_stock}")
                
                # 3. Invoke agent to generate promotion
                t_agent_start = time.time()
                promo = await generate_promotion(store_name, item_name, curr_stock, target_stock)
                t_agent = time.time() - t_agent_start
                
                add_log(f"Agent promotion generated for '{store_name}' in {t_agent:.4f}s: code={promo.discount_code}")
                
                # 4. Decrement simulated stock (legacy logic - updates store directly)
                decrement = random.randint(5, 10)
                new_stock = max(0, curr_stock - decrement)
                db.stores.update_one(
                    {"_id": store["_id"]},
                    {"$set": {"current_stock": new_stock}}
                )
                add_log(f"Stock decremented for '{store_name}': {curr_stock} -> {new_stock} (-{decrement})")
                
                # 5. Add to active promotions list
                promo_entry = {
                    "id": str(ObjectId()),
                    "store_name": store_name,
                    "item": item_name,
                    "discount_code": promo.discount_code,
                    "message": promo.message,
                    "duration_minutes": promo.duration_minutes,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                active_promotions.append(promo_entry)
                triggered_promotions.append(promo_entry)
            else:
                add_log(f"Store '{store_name}' has no surplus: stock={curr_stock}, target={target_stock}")
                
    except Exception as e:
        add_log(f"Error processing surge event: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process surge: {str(e)}")
        
    return {
        "triggered_promotions": triggered_promotions,
        "logs": pipeline_logs
    }

@app.get("/api/stores")
async def get_stores():
    try:
        # Fetches only stores matching current tenantId automatically
        stores = list(db.stores.find({}))
        # Serialize ObjectIds
        for store in stores:
            store["_id"] = str(store["_id"])
        return stores
    except Exception as e:
        add_log(f"Error fetching stores: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/promotions")
async def get_promotions():
    # Promotions list filter by tenantId (for security)
    tenant_id = get_current_tenant_id()
    # Simple list filtering based on matching coupon naming prefix or stored fields
    # For active promotions in memory, filter by store names belonging to the active tenant
    tenant_stores = {s["name"].lower() for s in db.stores.find({})}
    filtered = [p for p in active_promotions if p["store_name"].lower() in tenant_stores]
    return filtered

@app.get("/api/logs")
async def get_logs():
    return pipeline_logs

@app.post("/api/seed")
async def trigger_seed():
    try:
        seed_data()
        add_log("Database successfully re-seeded via API.")
        return {"status": "success", "message": "Database successfully re-seeded."}
    except Exception as e:
        add_log(f"Error seeding database via API: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
