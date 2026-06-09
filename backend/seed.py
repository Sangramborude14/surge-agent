import sys
from datetime import datetime, timezone, timedelta
from db import db, raw_db, init_db
from campaign_service import get_deterministic_embedding

def seed_data():
    # 1. Initialize DB and create index structures
    init_db()
    
    # 2. Clear all collections (bypassing tenant filters)
    raw_db.stores.delete_many({})
    raw_db.zones.delete_many({})
    raw_db.past_campaigns.delete_many({})
    raw_db.devices.delete_many({})
    raw_db.raw_spatial_logs.delete_many({})
    raw_db.historical_trends.delete_many({})
    
    # Clear NORSG-2.0 collections
    raw_db.time_series_foot_traffic.delete_many({})
    raw_db.tenant_inventory.delete_many({})
    raw_db.co_opetition_campaigns.delete_many({})
    raw_db.user_profiles_and_sentiment.delete_many({})
    
    print("Cleared all database collections (NORSG-2.0 & legacy baseline).")

    # 3. Seed GeoJSON Zones (MetLife Sector 3 Plaza)
    # Location coordinates around MetLife Plaza e.g., longitude: -74.0060, latitude: 40.7128
    sector_3_plaza_poly = {
        "type": "Polygon",
        "coordinates": [[
            [-74.0120, 40.7080],
            [-74.0000, 40.7080],
            [-74.0000, 40.7180],
            [-74.0120, 40.7180],
            [-74.0120, 40.7080]
        ]]
    }
    
    zones = [
        {
            "zoneId": "zone_sector_3_plaza",
            "name": "MetLife Stadium Sector 3 Plaza",
            "geometry": sector_3_plaza_poly,
            "tenantId": "default_tenant"
        }
    ]
    db.zones.insert_many(zones)
    print("Successfully seeded GeoJSON zones.")

    # 4. Seed time_series_foot_traffic (density spike prior to stadium exits)
    now = datetime.now(timezone.utc)
    traffic_logs = [
        {
            "timestamp": now - timedelta(minutes=i * 2),
            "metadata": {
                "zoneId": "zone_sector_3_plaza",
                "sensorType": "wifi_beacon_density"
            },
            "deviceCount": 350 + (i * 15), # Rising density trend
            "dwellTimeAverageSeconds": 120.0 + (i * 5.0)
        } for i in range(10)
    ]
    db.time_series_foot_traffic.insert_many(traffic_logs)
    print("Successfully seeded time-series foot traffic.")

    # 5. Seed tenant_inventory (KidzToyz, FrostyShakes, and Warehouse Central)
    inventory = [
        {
            "tenantId": "kidztoyz_01",
            "name": "KidzToyz MetLife Kiosk",
            "category": "Games",
            "location": {
                "type": "Point",
                "coordinates": [-74.0061, 40.7129]
            },
            "zoneId": "zone_sector_3_plaza",
            "items": [
                {
                    "itemId": "board_game_family_01",
                    "sku": "KT-GAME-101",
                    "name": "Soccer Star Board Game",
                    "availableStock": 45,
                    "allocatedSurgeStock": 0,
                    "safetyBuffer": 5,
                    "basePrice": 45.00,
                    "marginalCost": 15.00
                }
            ]
        },
        {
            "tenantId": "frostyshakes_01",
            "name": "FrostyShakes Frozen Yogurt",
            "category": "Beverages",
            "location": {
                "type": "Point",
                "coordinates": [-74.0059, 40.7127]
            },
            "zoneId": "zone_sector_3_plaza",
            "items": [
                {
                    "itemId": "frozen_yogurt_large",
                    "sku": "FS-YOG-Venti",
                    "name": "World Cup FroYo Venti",
                    "availableStock": 120,
                    "allocatedSurgeStock": 0,
                    "safetyBuffer": 10,
                    "basePrice": 8.50,
                    "marginalCost": 1.50
                }
            ]
        },
        {
            "tenantId": "kiosk_sector_3_plaza_01",
            "name": "Sector 3 Plaza Cooling Kiosk",
            "category": "Appliances",
            "location": {
                "type": "Point",
                "coordinates": [-74.0061, 40.7129]
            },
            "zoneId": "zone_sector_3_plaza",
            "items": [
                {
                    "itemId": "portable_fan_01",
                    "sku": "KT-FAN-102",
                    "name": "Mist Cooling Portable Fan",
                    "availableStock": 5,
                    "allocatedSurgeStock": 0,
                    "safetyBuffer": 2,
                    "basePrice": 25.00,
                    "marginalCost": 8.00
                }
            ]
        },
        {
            "tenantId": "warehouse_central_01",
            "name": "Central Sports Warehouse Branch",
            "category": "Logistics",
            "location": {
                "type": "Point",
                "coordinates": [-74.0060, 40.7128]
            },
            "zoneId": "zone_logistics_hub",
            "items": [
                {
                    "itemId": "portable_fan_01",
                    "sku": "WH-FAN-099",
                    "name": "Mist Cooling Portable Fan",
                    "availableStock": 300,
                    "allocatedSurgeStock": 0,
                    "safetyBuffer": 15,
                    "basePrice": 25.00,
                    "marginalCost": 8.00
                }
            ]
        }
    ]
    # We use raw_db to insert because tenantIds are different, avoiding tenanted wrappers
    raw_db.tenant_inventory.insert_many(inventory)
    print("Successfully seeded tenant inventory details.")

    # 6. Seed past campaigns for vector searches
    campaign_1_ctx = "Rainy Saturday afternoon, high concentration of families, excess kids rain gear"
    campaign_2_ctx = "Sunny weekend crowd, heavy influx of families with children, extreme high heat index"
    campaign_3_ctx = "Evening match day crowd, heavy foot traffic near stadium entrance, excess jerseys"
    
    campaigns = [
        {
            "title": "☔ Rainy Day Umbrella Blowout",
            "copy": "Storm is here! Get 40% off all water-resistant gear at the West Wing.",
            "discount_value": 40,
            "surge_context": campaign_1_ctx,
            "context_embedding": get_deterministic_embedding(campaign_1_ctx),
            "impressions": 1000,
            "redemptions": 420,
            "conversion_rate": 0.42,
            "tenantId": "default_tenant"
        },
        {
            "title": "👪 Cool Play Family Bundle",
            "copy": "Escape the heat inside KidzToyz and grab a skip-the-line frozen yogurt pass!",
            "discount_value": 30,
            "surge_context": campaign_2_ctx,
            "context_embedding": get_deterministic_embedding(campaign_2_ctx),
            "impressions": 500,
            "redemptions": 150,
            "conversion_rate": 0.30,
            "tenantId": "default_tenant"
        },
        {
            "title": "🔥 Heavy Surge Jersey Sale",
            "copy": "Stadium is packed! Enjoy 30% off all jerseys at World Cup Athletics.",
            "discount_value": 30,
            "surge_context": campaign_3_ctx,
            "context_embedding": get_deterministic_embedding(campaign_3_ctx),
            "impressions": 800,
            "redemptions": 320,
            "conversion_rate": 0.40,
            "tenantId": "default_tenant"
        }
    ]
    db.past_campaigns.insert_many(campaigns)
    print("Successfully seeded past campaigns for vector searches.")

if __name__ == "__main__":
    seed_data()
