import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/surge_db")

import certifi

if "mongodb+srv://" in MONGODB_URI:
    client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where())
else:
    client = MongoClient(MONGODB_URI)
    
db_name = MONGODB_URI.split("/")[-1].split("?")[0] or "surge_db"
# Clear parameters out of database name if it was parsed from the root connection path
if "?" in db_name:
    db_name = db_name.split("?")[0]
from tenancy import TenantedDatabase

raw_db = client[db_name]
db = TenantedDatabase(raw_db)

def init_db():
    """
    Initializes the database by ensuring the required collections exist,
    building necessary geospatial indexes, configuring Time Series metrics,
    and creating unique rollup constraints.
    """
    # 1. Storefronts Geospatial Index (Existing)
    db.stores.create_index([("location", "2dsphere")])
    
    # 2. Zones Geospatial Index (New)
    db.zones.create_index([("geometry", "2dsphere")])
    
    # 3. Devices Telemetry Geospatial Index (New)
    db.devices.create_index([("location", "2dsphere")])
    
    # 4. raw_spatial_logs - MongoDB Time Series Collection
    col_names = raw_db.list_collection_names()
    if "raw_spatial_logs" not in col_names:
        try:
            raw_db.create_collection(
                "raw_spatial_logs",
                timeseries={
                    "timeField": "timestamp",
                    "metaField": "sensorMetadata",
                    "granularity": "seconds"
                }
            )
            print("Successfully created 'raw_spatial_logs' as a Time Series collection.")
        except Exception as e:
            print(f"Error creating raw_spatial_logs collection: {e}")
            
    # Configure 24-hour TTL (Time-To-Live) index on Time Series
    db.raw_spatial_logs.create_index(
        [("timestamp", 1)],
        expireAfterSeconds=86400,
        partialFilterExpression={"sensorMetadata": {"$exists": True}}
    )
    
    # 5. historical_trends Rollup Index (Required for $merge stage matching)
    db.historical_trends.create_index(
        [("hour", 1), ("zoneId", 1), ("tenantId", 1)],
        unique=True
    )
    
    # 6. past_campaigns Index for local fallback query searches
    db.past_campaigns.create_index([("tenantId", 1)])
    
    print("Database initialized successfully with Time Series, 2dsphere indexes, and rollup constraints.")


if __name__ == "__main__":
    init_db()
