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
    
    # 7. time_series_foot_traffic - MongoDB Time Series Collection (New)
    if "time_series_foot_traffic" not in col_names:
        try:
            raw_db.create_collection(
                "time_series_foot_traffic",
                timeseries={
                    "timeField": "timestamp",
                    "metaField": "metadata",
                    "granularity": "seconds"
                }
            )
            print("Successfully created 'time_series_foot_traffic' as a Time Series collection.")
        except Exception as e:
            print(f"Error creating time_series_foot_traffic collection: {e}")
            
    # Configure 30-day TTL index on foot traffic Time Series
    db.time_series_foot_traffic.create_index(
        [("timestamp", 1)],
        expireAfterSeconds=2592000,
        partialFilterExpression={"metadata": {"$exists": True}}
    )
    
    # 8. tenant_inventory Geospatial Index (New)
    db.tenant_inventory.create_index([("location", "2dsphere")])
    db.tenant_inventory.create_index([("tenantId", 1)])
    
    # 9. co_opetition_campaigns Lookup Indexes (New)
    db.co_opetition_campaigns.create_index([("campaignId", 1)], unique=True)
    db.co_opetition_campaigns.create_index([("triggerZoneId", 1)])
    
    # 10. user_profiles_and_sentiment Indexes (New)
    db.user_profiles_and_sentiment.create_index([("userId", 1)], unique=True)
    db.user_profiles_and_sentiment.create_index([("location", "2dsphere")])
    
    # 11. NEX-RMN google_shopping_products Indexes
    db.google_shopping_products.create_index([("tenantId", 1)])
    db.google_shopping_products.create_index([("zoneId", 1)])
    db.google_shopping_products.create_index([("googleMerchantFields.g_mpn", 1)], unique=True)
    
    # 12. NEX-RMN google_ads_campaigns Indexes
    db.google_ads_campaigns.create_index([("campaignId", 1)], unique=True)
    db.google_ads_campaigns.create_index([("tenantId", 1)])
    db.google_ads_campaigns.create_index([("targetingCriteria.targetZones", 1)])
    
    # 13. NEX-RMN rmn_asynchronous_events Indexes
    db.rmn_asynchronous_events.create_index([("timestamp", 1)])
    db.rmn_asynchronous_events.create_index([("batchId", 1)])
    
    print("Database initialized successfully with Time Series, 2dsphere indexes, RMN collections, and rollup constraints.")


if __name__ == "__main__":
    init_db()
