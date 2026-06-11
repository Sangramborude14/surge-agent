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

from db import db, init_db, raw_db, client
from agent import generate_promotion
from seed import seed_data
from tenancy import set_current_tenant_id, get_current_tenant_id, set_global_default_tenant
from edge_compute import global_edge_buffer, get_zone_visitor_count, run_historical_rollup
from campaign_service import find_similar_campaigns, generate_creative_offer, create_and_save_campaign, track_campaign_impression, track_campaign_redemption
from reservation import allocate_surge_stock, claim_coupon
from nexus_governor import predictive_inventory_shift, create_coop_deal, sentiment_vector_search

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

    def rmn_flusher_loop():
        add_log("[Background Service] RMN 5s asynchronous flusher thread active.")
        from rmn_engine import flush_rmn_events
        while True:
            try:
                time.sleep(5)
                flush_rmn_events()
            except Exception as e:
                print(f"[RMN Flusher Error] {e}")

    t1 = threading.Thread(target=edge_flusher_loop, daemon=True)
    t2 = threading.Thread(target=rollup_loop, daemon=True)
    t3 = threading.Thread(target=rmn_flusher_loop, daemon=True)
    t1.start()
    t2.start()
    t3.start()


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
# 6. NEXUS RETAIL MEDIA NETWORK (NEX-RMN) ENDPOINTS
# ==========================================
class RmnEventPayload(BaseModel):
    type: str = Field(..., description="event type: search or cart_add")
    zoneId: str = Field(..., description="Zone_A or Zone_B")
    targetItemMpn: str = Field(..., description="g_mpn of the product")
    weight: int = Field(1, description="Event weight")

class RmnPurchasePayload(BaseModel):
    zoneId: str = Field(..., description="Zone_A or Zone_B")
    targetItemMpn: str = Field(..., description="g_mpn of the product")
    quantity: int = Field(1, description="Quantity to purchase")

def is_replica_set() -> bool:
    try:
        raw_db.command("replSetGetStatus")
        return True
    except Exception:
        return False

def process_rmn_purchase_or_cart_logic(zone_id: str, mpn: str, quantity: int) -> dict:
    if is_replica_set():
        with client.start_session() as session:
            with session.start_transaction():
                product = raw_db.google_shopping_products.find_one(
                    {"zoneId": zone_id, "googleMerchantFields.g_mpn": mpn},
                    session=session
                )
                if not product:
                    raise ValueError(f"Product with MPN '{mpn}' in zone '{zone_id}' not found.")
                
                avail = product["inventory_metrics"]["availableStock"]
                buffer = product["inventory_metrics"]["safetyBuffer"]
                
                if avail < quantity:
                    raise ValueError(f"Insufficient stock: {avail} available, requested {quantity}.")
                
                new_avail = avail - quantity
                new_allocated = product["inventory_metrics"].get("allocatedInCarts", 0) + quantity
                
                raw_db.google_shopping_products.update_one(
                    {"_id": product["_id"]},
                    {
                        "$set": {
                            "inventory_metrics.availableStock": new_avail,
                            "inventory_metrics.allocatedInCarts": new_allocated
                        }
                    },
                    session=session
                )
                
                return {
                    "new_availableStock": new_avail,
                    "new_allocatedInCarts": new_allocated,
                    "is_shortage": new_avail <= buffer
                }
    else:
        # Standalone fallback using single-query atomic update
        product = raw_db.google_shopping_products.find_one(
            {"zoneId": zone_id, "googleMerchantFields.g_mpn": mpn}
        )
        if not product:
            raise ValueError(f"Product with MPN '{mpn}' in zone '{zone_id}' not found.")
        
        avail = product["inventory_metrics"]["availableStock"]
        if avail < quantity:
            raise ValueError(f"Insufficient stock: {avail} available, requested {quantity}.")
            
        result = raw_db.google_shopping_products.update_one(
            {
                "zoneId": zone_id,
                "googleMerchantFields.g_mpn": mpn,
                "inventory_metrics.availableStock": {"$gte": quantity}
            },
            {
                "$inc": {
                    "inventory_metrics.availableStock": -quantity,
                    "inventory_metrics.allocatedInCarts": quantity
                }
            }
        )
        if result.modified_count == 0:
            raise ValueError("Reserve failed due to concurrency or stock conditions.")
            
        updated_prod = raw_db.google_shopping_products.find_one(
            {"zoneId": zone_id, "googleMerchantFields.g_mpn": mpn}
        )
        new_avail = updated_prod["inventory_metrics"]["availableStock"]
        buffer = updated_prod["inventory_metrics"]["safetyBuffer"]
        
        return {
            "new_availableStock": new_avail,
            "new_allocatedInCarts": updated_prod["inventory_metrics"]["allocatedInCarts"],
            "is_shortage": new_avail <= buffer
        }

@app.get("/api/rmn/products")
async def get_rmn_products(zoneId: str, query: str = ""):
    try:
        from rmn_engine import run_rtb_auction
        # Execute RTB auction dynamically on each request to determine sponsor/pricing
        winner = run_rtb_auction(zoneId, query)
        
        # Retrieve all products for this zone
        products = list(raw_db.google_shopping_products.find({"zoneId": zoneId}))
        
        # Serialize ObjectId to string
        for prod in products:
            prod["_id"] = str(prod["_id"])
            
        winner_data = None
        ledger = []
        traffic_multiplier = 1.0
        visitors = 0
        
        if winner:
            winner_data = dict(winner)
            if winner_data.get("product"):
                prod_copy = dict(winner_data["product"])
                prod_copy["_id"] = str(prod_copy["_id"])
                winner_data["product"] = prod_copy
            ledger = winner_data.get("ledger", [])
            traffic_multiplier = winner_data.get("trafficMultiplier", 1.0)
            visitors = winner_data.get("zoneVisitors", 0)
        else:
            from edge_compute import get_zone_visitor_count
            try:
                visitors = get_zone_visitor_count(zoneId.lower())
            except Exception:
                pass
            traffic_multiplier = 1.5 if visitors >= 5 else 1.0
                
        add_log(f"RMN Auction execution: zone={zoneId}, query='{query}', winner={winner_data.get('campaignId') if winner_data else 'None'}")
        
        return {
            "products": products,
            "sponsored": winner_data,
            "logs": pipeline_logs,
            "ledger": ledger,
            "trafficMultiplier": traffic_multiplier,
            "zoneVisitors": visitors
        }
    except Exception as e:
        add_log(f"Failed to retrieve RMN products: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rmn/event")
async def log_rmn_event(payload: RmnEventPayload):
    try:
        event_doc = {
            "timestamp": datetime.now(timezone.utc),
            "type": payload.type,
            "zoneId": payload.zoneId,
            "targetItemMpn": payload.targetItemMpn,
            "weight": payload.weight
        }
        raw_db.rmn_asynchronous_events.insert_one(event_doc)
        add_log(f"[RMN Event Logged] Type: {payload.type}, Zone: {payload.zoneId}, MPN: {payload.targetItemMpn}, Weight: {payload.weight}")
        return {"status": "success", "message": "Event successfully buffered."}
    except Exception as e:
        add_log(f"Failed to log RMN event: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rmn/purchase")
async def process_rmn_purchase(payload: RmnPurchasePayload):
    try:
        result = process_rmn_purchase_or_cart_logic(payload.zoneId, payload.targetItemMpn, payload.quantity)
        
        # Buffer a cart_add event in parallel for weight metrics
        raw_db.rmn_asynchronous_events.insert_one({
            "timestamp": datetime.now(timezone.utc),
            "type": "cart_add",
            "zoneId": payload.zoneId,
            "targetItemMpn": payload.targetItemMpn,
            "weight": 5 * payload.quantity
        })
        
        if result["is_shortage"]:
            # Localized shortage: broadcast to drop Quality Score to 0
            product = raw_db.google_shopping_products.find_one(
                {"zoneId": payload.zoneId, "googleMerchantFields.g_mpn": payload.targetItemMpn}
            )
            buffer = product["inventory_metrics"]["safetyBuffer"]
            add_log(
                f"[BROADCAST INSTRUCTION] Inventory shortage detected for item '{payload.targetItemMpn}' in '{payload.zoneId}' "
                f"(Available: {result['new_availableStock']} <= Buffer: {buffer}). "
                f"Setting Quality Score multiplier to 0.0 network-wide."
            )
        else:
            add_log(f"RMN purchase executed successfully for '{payload.targetItemMpn}' in '{payload.zoneId}' (Qty: {payload.quantity}).")
            
        return {
            "status": "success",
            "message": "Transaction completed successfully.",
            "data": result
        }
    except ValueError as ve:
        add_log(f"RMN purchase rejected: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        add_log(f"Internal error executing RMN purchase: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rmn/flush")
async def trigger_rmn_flush():
    try:
        from rmn_engine import flush_rmn_events
        flush_rmn_events()
        add_log("Manual trigger: RMN Event Flusher run.")
        return {"status": "success", "message": "RMN event buffer successfully flushed."}
    except Exception as e:
        add_log(f"Manual RMN flush failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class RmnCampaignUpdatePayload(BaseModel):
    campaignId: str
    maxBidPerClick: float
    dailyBudget: float
    targetingCriteria: Dict[str, Any]
    creativeAsset: Dict[str, Any]
    status: str

class RmnClickPayload(BaseModel):
    campaignId: str

class RmnJointCampaignPayload(BaseModel):
    campaignId: str
    partnerTenants: List[str]
    maxBidPerClick: float
    dailyBudget: float
    targetingCriteria: Dict[str, Any]
    creativeAsset: Dict[str, Any]

@app.get("/api/rmn/campaigns")
async def get_rmn_campaigns(tenantId: str = ""):
    try:
        query = {}
        if tenantId:
            # Handle co-op/joint campaign fetches too
            if tenantId == "coop_partnership":
                query["isJoint"] = True
            else:
                query["$or"] = [
                    {"tenantId": tenantId},
                    {"partnerTenants": tenantId}
                ]
        camps = list(raw_db.google_ads_campaigns.find(query))
        for c in camps:
            c["_id"] = str(c["_id"])
        return camps
    except Exception as e:
        add_log(f"Failed to fetch RMN campaigns: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rmn/campaigns/update")
async def update_rmn_campaign(payload: RmnCampaignUpdatePayload):
    try:
        result = raw_db.google_ads_campaigns.update_one(
            {"campaignId": payload.campaignId},
            {"$set": {
                "maxBidPerClick": payload.maxBidPerClick,
                "dailyBudget": payload.dailyBudget,
                "targetingCriteria": payload.targetingCriteria,
                "creativeAsset": payload.creativeAsset,
                "status": payload.status
            }}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Campaign not found")
        add_log(f"[RMN Campaign Update] Campaign '{payload.campaignId}' modified successfully.")
        return {"status": "success", "message": "Campaign updated successfully."}
    except Exception as e:
        add_log(f"Failed to update RMN campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rmn/click")
async def log_rmn_click(payload: RmnClickPayload):
    try:
        # Increment click on the winning campaign
        raw_db.google_ads_campaigns.update_one(
            {"campaignId": payload.campaignId},
            {"$inc": {"clicks": 1}}
        )
        # Also increment click on any partner campaigns if it is a joint campaign
        winner_camp = raw_db.google_ads_campaigns.find_one({"campaignId": payload.campaignId})
        if winner_camp and winner_camp.get("isJoint"):
            partner_tenants = winner_camp.get("partnerTenants", [])
            for pt in partner_tenants:
                raw_db.google_ads_campaigns.update_one(
                    {"tenantId": pt, "isJoint": {"$ne": True}},
                    {"$inc": {"clicks": 1}}
                )
        add_log(f"[RMN Click Logged] Clicks incremented for campaign '{payload.campaignId}'")
        return {"status": "success", "message": "Click registered."}
    except Exception as e:
        add_log(f"Failed to register click: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/rmn/campaigns/create-joint")
async def create_rmn_joint_campaign(payload: RmnJointCampaignPayload):
    try:
        doc = {
            "campaignId": payload.campaignId,
            "tenantId": "coop_partnership",
            "isJoint": True,
            "partnerTenants": payload.partnerTenants,
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": payload.maxBidPerClick,
            "dailyBudget": payload.dailyBudget,
            "remainingBudget": payload.dailyBudget,
            "status": "ELIGIBLE",
            "targetingCriteria": payload.targetingCriteria,
            "creativeAsset": payload.creativeAsset,
            "impressions": 0,
            "clicks": 0
        }
        raw_db.google_ads_campaigns.insert_one(doc)
        add_log(f"[RMN Joint Campaign Created] Partnership: {payload.partnerTenants}, Bid: {payload.maxBidPerClick}")
        return {"status": "success", "message": "Joint campaign created successfully."}
    except Exception as e:
        add_log(f"Failed to create joint campaign: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class RmnSimulateTrafficPayload(BaseModel):
    zoneId: str
    count: int

@app.post("/api/rmn/simulate-traffic")
async def simulate_rmn_traffic(payload: RmnSimulateTrafficPayload):
    try:
        zone_id = payload.zoneId.lower()
        # Remove existing dummy devices for this zone to avoid duplicate build-up
        raw_db.devices.delete_many({"dummy_zone": zone_id})
        
        # Coordinates inside the seeded polygons
        if zone_id == "zone_a":
            coords = [121.501, 31.240]
        elif zone_id == "zone_b":
            coords = [121.515, 31.245]
        else:
            coords = [121.500, 31.240]
            
        if payload.count > 0:
            devices_to_insert = []
            for i in range(payload.count):
                devices_to_insert.append({
                    "anonymousHash": f"dummy_device_{zone_id}_{i}",
                    "location": {
                        "type": "Point",
                        "coordinates": [coords[0] + (i * 0.0001), coords[1] + (i * 0.0001)]
                    },
                    "tenantId": "default_tenant", # fallback context
                    "dummy_zone": zone_id
                })
            raw_db.devices.insert_many(devices_to_insert)
            
        add_log(f"[RMN Traffic Simulator] Set {payload.count} visitors in zone {zone_id}")
        return {"status": "success", "visitorCount": payload.count}
    except Exception as e:
        add_log(f"Failed to simulate RMN traffic: {e}")
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
# 5. NORSG-2.0 GOVERNOR CORE WORKFLOW ENDPOINTS
# ==========================================
class ShiftInventoryPayload(BaseModel):
    zoneId: str = Field(..., description="Target zone to evaluate demand")
    itemId: str = Field(..., description="The surplus product ID to shift")

class CoopDealPayload(BaseModel):
    zoneId: str = Field(..., description="Active zone for campaign trigger")
    buyerProfile: str = Field(..., description="Target buyer profile (e.g., families, fans)")

class SentimentSearchPayload(BaseModel):
    queryText: str = Field(..., description="Raw sentiment text from the customer")
    location: List[float] = Field(..., description="Customer current location coordinates: [longitude, latitude]")

@app.post("/api/nexus/shift-inventory")
async def api_shift_inventory(payload: ShiftInventoryPayload):
    try:
        result = predictive_inventory_shift(payload.zoneId, payload.itemId)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/nexus/coop-deal")
async def api_create_coop_deal(payload: CoopDealPayload):
    try:
        result = create_coop_deal(payload.zoneId, payload.buyerProfile)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/nexus/sentiment-search")
async def api_sentiment_search(payload: SentimentSearchPayload):
    try:
        result = sentiment_vector_search(payload.queryText, payload.location)
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class PurchasePayload(BaseModel):
    storeName: str = Field(..., description="Store name where item is purchased")
    itemName: str = Field(..., description="Item being purchased")
    quantity: int = Field(1, description="Quantity to purchase")

@app.post("/api/purchase")
async def purchase_item(payload: PurchasePayload):
    try:
        store = db.stores.find_one({"name": payload.storeName, "item": payload.itemName})
        if not store:
            raise HTTPException(status_code=404, detail="Store/item not found")
        
        curr_stock = store.get("current_stock", 0)
        target_stock = store.get("target_stock", 0)
        
        if curr_stock < payload.quantity:
            raise HTTPException(status_code=400, detail="Insufficient stock")
            
        new_stock = curr_stock - payload.quantity
        
        # Update database: decrement stock and increment sales
        db.stores.update_one(
            {"name": payload.storeName, "item": payload.itemName},
            {
                "$set": {"current_stock": new_stock},
                "$inc": {"sales": payload.quantity}
            }
        )
        add_log(f"Purchase: {payload.quantity}x '{payload.itemName}' from '{payload.storeName}'. Stock: {curr_stock} -> {new_stock}")
        
        # Readjust discount dynamically in active promotions
        surplus = new_stock - target_stock
        
        # We loop through a copy of active_promotions to safely modify it
        for promo in list(active_promotions):
            if promo["store_name"].lower() == payload.storeName.lower() and promo["item"].lower() == payload.itemName.lower():
                if surplus <= 0:
                    active_promotions.remove(promo)
                    add_log(f"Promotion expired for '{payload.storeName}' - '{payload.itemName}' because stock reached target threshold.")
                else:
                    # Scale discount based on surplus
                    if surplus >= 100:
                        discount = 50
                    elif surplus >= 70:
                        discount = 40
                    elif surplus >= 40:
                        discount = 30
                    elif surplus >= 20:
                        discount = 20
                    else:
                        discount = 10
                        
                    promo["discount_code"] = f"SURGE{discount}_{payload.storeName.replace(' ', '')[:5].upper()}"
                    promo["message"] = f"Tourist Surge Alert! Get {discount}% off on '{payload.itemName}' at {payload.storeName}! Hurry, offer valid for a limited time."
                    add_log(f"Discount readjusted for '{payload.storeName}' - '{payload.itemName}': {discount}% off (Surplus: {surplus})")
                break
                
        # Trigger dynamic promotion on category/brand sibling with least sales
        category = store.get("category")
        brand = store.get("brand")
        
        low_sales_item = None
        or_filters = []
        if category:
            or_filters.append({"category": category})
        if brand:
            or_filters.append({"brand": brand})
            
        if or_filters:
            siblings = list(db.stores.find({"$or": or_filters}))
            other_siblings = [s for s in siblings if not (s["name"] == payload.storeName and s["item"] == payload.itemName)]
            candidates = other_siblings if other_siblings else siblings
            if candidates:
                candidates.sort(key=lambda x: x.get("sales", 0))
                low_sales_item = candidates[0]
                
        if low_sales_item:
            low_store_name = low_sales_item["name"]
            low_item_name = low_sales_item["item"]
            low_sales_count = low_sales_item.get("sales", 0)
            
            # Check if this low sales item already has an active promotion
            existing_low_promo = None
            for promo in active_promotions:
                if promo["store_name"].lower() == low_store_name.lower() and promo["item"].lower() == low_item_name.lower():
                    existing_low_promo = promo
                    break
                    
            discount = 40
            if existing_low_promo:
                existing_low_promo["discount_code"] = f"BOOST{discount}_{low_store_name.replace(' ', '')[:5].upper()}"
                existing_low_promo["message"] = f"🔥 LOW SALES FOCUS! Enjoy {discount}% OFF '{low_item_name}' at {low_store_name}! Limited sales priority deal."
                add_log(f"Dynamic promotion boosted for low-sales sibling '{low_store_name}' - '{low_item_name}' (Sales: {low_sales_count})")
            else:
                new_promo = {
                    "id": f"low_sales_{random.randint(1000, 9999)}",
                    "store_name": low_store_name,
                    "item": low_item_name,
                    "discount_code": f"BOOST{discount}_{low_store_name.replace(' ', '')[:5].upper()}",
                    "message": f"🔥 LOW SALES PRIORITY! Take {discount}% OFF '{low_item_name}' at {low_store_name}! Grab this category deal.",
                    "duration_minutes": 15,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                active_promotions.append(new_promo)
                add_log(f"Launched dynamic low-sales promotion for sibling '{low_store_name}' - '{low_item_name}' (Sales: {low_sales_count})")
                
        # Return updated stores and active promotions
        updated_stores = list(db.stores.find({}))
        for s in updated_stores:
            s["_id"] = str(s["_id"])
            
        tenant_stores = {s["name"].lower() for s in updated_stores}
        filtered_promos = [p for p in active_promotions if p["store_name"].lower() in tenant_stores]
        
        return {
            "status": "success",
            "stores": updated_stores,
            "promotions": filtered_promos
        }
    except Exception as e:
        add_log(f"Purchase failed: {e}")
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
