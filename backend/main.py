import os
import time
import random
from datetime import datetime, timezone
from typing import List, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from bson import ObjectId

from db import db, init_db
from agent import generate_promotion
from seed import seed_data

app = FastAPI(title="Tourist Surge Retail Agent Backend")

# Enable CORS for next.js app to query
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory arrays for logs and active promotions
pipeline_logs: List[Dict[str, Any]] = []
active_promotions: List[Dict[str, Any]] = []

def add_log(message: str):
    timestamp = datetime.now(timezone.utc).isoformat()
    pipeline_logs.append({"timestamp": timestamp, "message": message})
    if len(pipeline_logs) > 200:
        pipeline_logs.pop(0)
    print(f"[{timestamp}] {message}")

class SurgeRequest(BaseModel):
    coordinates: List[float] = Field(..., description="[longitude, latitude]")
    radius_meters: float = Field(..., description="Geospatial search radius in meters")

@app.on_event("startup")
async def startup_event():
    # Make sure DB is initialized and index is built on startup
    try:
        init_db()
        add_log("Application startup: Database initialized successfully.")
    except Exception as e:
        add_log(f"Application startup error initializing DB: {e}")

@app.post("/api/surge")
async def trigger_surge(request: SurgeRequest):
    if len(request.coordinates) != 2:
        raise HTTPException(status_code=400, detail="Coordinates must contain [longitude, latitude]")
    
    lng, lat = request.coordinates
    radius = request.radius_meters
    
    add_log(f"Surge Request: coordinates=[{lng}, {lat}], radius={radius} meters")
    
    triggered_promotions = []
    
    try:
        # 1. MongoDB geospatial query
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
                
                # 4. Decrement simulated stock
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
    return active_promotions

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
