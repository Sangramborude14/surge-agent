import sys
from db import db, init_db
from campaign_service import get_deterministic_embedding

def seed_data():
    # 1. Initialize DB and create index structures
    init_db()
    
    # 2. Clear existing collections
    db.stores.delete_many({})
    db.zones.delete_many({})
    db.past_campaigns.delete_many({})
    db.devices.delete_many({})
    db.raw_spatial_logs.delete_many({})
    db.historical_trends.delete_many({})
    print("Cleared existing database collections (stores, zones, past_campaigns, devices, logs, trends).")

    # 3. Seed storefront data (Default Tenant: "default_tenant")
    stores = [
        {
            "name": "World Cup Athletics",
            "location": {
                "type": "Point",
                "coordinates": [121.501, 31.240]
            },
            "item": "World Cup Jersey",
            "current_stock": 150,
            "target_stock": 20,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.45,            # Sensitive financial field (will be encrypted at rest)
            "wholesalePrice": 45.0,     # Sensitive financial field (will be encrypted at rest)
            "tenantId": "default_tenant"
        },
        {
            "name": "Fan Zone Goods",
            "location": {
                "type": "Point",
                "coordinates": [121.502, 31.241]
            },
            "item": "Mascot Cap",
            "current_stock": 80,
            "target_stock": 10,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.50,
            "wholesalePrice": 12.0,
            "tenantId": "default_tenant"
        },
        {
            "name": "Champions Souvenirs",
            "location": {
                "type": "Point",
                "coordinates": [121.515, 31.245]
            },
            "item": "Tournament Soccer Ball",
            "current_stock": 120,
            "target_stock": 30,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.40,
            "wholesalePrice": 18.0,
            "tenantId": "default_tenant"
        },
        {
            "name": "Stadium Snacks & Gear",
            "location": {
                "type": "Point",
                "coordinates": [121.516, 31.246]
            },
            "item": "Reusable Water Bottle",
            "current_stock": 60,
            "target_stock": 15,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.60,
            "wholesalePrice": 4.50,
            "tenantId": "default_tenant"
        }
    ]
    db.stores.insert_many(stores)
    print("Successfully seeded storefronts.")

    # 4. Seed GeoJSON Zones
    # Zone A (West Wing) Polygon
    zone_a_poly = {
        "type": "Polygon",
        "coordinates": [[
            [121.498, 31.238],
            [121.505, 31.238],
            [121.505, 31.243],
            [121.498, 31.243],
            [121.498, 31.238]
        ]]
    }
    # Zone B (East Wing) Polygon
    zone_b_poly = {
        "type": "Polygon",
        "coordinates": [[
            [121.512, 31.243],
            [121.518, 31.243],
            [121.518, 31.248],
            [121.512, 31.248],
            [121.512, 31.243]
        ]]
    }
    
    zones = [
        {
            "zoneId": "zone_a",
            "name": "Zone A // West Wing",
            "geometry": zone_a_poly,
            "tenantId": "default_tenant"
        },
        {
            "zoneId": "zone_b",
            "name": "Zone B // East Wing",
            "geometry": zone_b_poly,
            "tenantId": "default_tenant"
        }
    ]
    db.zones.insert_many(zones)
    print("Successfully seeded GeoJSON zones.")

    # 5. Seed Historical Campaigns (for A/B Vector Searches)
    campaign_1_ctx = "Rainy Saturday afternoon, high concentration of families, excess kids rain gear"
    campaign_2_ctx = "Sunny weekend crowd, heavy influx of families with children"
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
            "title": "👪 Family Fan Pack Deal",
            "copy": "Take 25% off family packages and youth size apparel at Fan Zone Goods.",
            "discount_value": 25,
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
    print("Successfully seeded historical campaigns (A/B testing vectors).")

if __name__ == "__main__":
    seed_data()
