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
    
    # Clear NEX-RMN collections
    raw_db.google_shopping_products.delete_many({})
    raw_db.google_ads_campaigns.delete_many({})
    raw_db.rmn_asynchronous_events.delete_many({})
    
    print("Cleared all database collections (NORSG-2.0, RMN & legacy baseline).")

    # 3. Seed GeoJSON Zones
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
    # MetLife Stadium Sector 3 Plaza Polygon
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
        },
        {
            "zoneId": "zone_sector_3_plaza",
            "name": "MetLife Stadium Sector 3 Plaza",
            "geometry": sector_3_plaza_poly,
            "tenantId": "default_tenant"
        }
    ]
    db.zones.insert_many(zones)
    print("Successfully seeded GeoJSON zones.")

    # 3.5 Seed storefronts (for legacy dashboard promotions signage)
    stores = [
        # WORLD CUP ATHLETICS (Zone A)
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
            "margin": 0.45,
            "wholesalePrice": 45.0,
            "category": "Apparel",
            "brand": "Adidas",
            "sales": 120,
            "tenantId": "default_tenant"
        },
        {
            "name": "World Cup Athletics",
            "location": {
                "type": "Point",
                "coordinates": [121.501, 31.240]
            },
            "item": "Retro Germany Jersey",
            "current_stock": 110,
            "target_stock": 15,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.40,
            "wholesalePrice": 40.0,
            "category": "Apparel",
            "brand": "Adidas",
            "sales": 85,
            "tenantId": "default_tenant"
        },
        {
            "name": "World Cup Athletics",
            "location": {
                "type": "Point",
                "coordinates": [121.501, 31.240]
            },
            "item": "Running Sneakers",
            "current_stock": 90,
            "target_stock": 20,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.50,
            "wholesalePrice": 60.0,
            "category": "Apparel",
            "brand": "Nike",
            "sales": 40,
            "tenantId": "default_tenant"
        },

        # FAN ZONE GOODS (Zone A)
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
            "category": "Accessories",
            "brand": "Puma",
            "sales": 45,
            "tenantId": "default_tenant"
        },
        {
            "name": "Fan Zone Goods",
            "location": {
                "type": "Point",
                "coordinates": [121.502, 31.241]
            },
            "item": "Mascot Plush Toy",
            "current_stock": 75,
            "target_stock": 12,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.55,
            "wholesalePrice": 10.0,
            "category": "Accessories",
            "brand": "Puma",
            "sales": 15,
            "tenantId": "default_tenant"
        },
        {
            "name": "Fan Zone Goods",
            "location": {
                "type": "Point",
                "coordinates": [121.502, 31.241]
            },
            "item": "Team Scarf",
            "current_stock": 120,
            "target_stock": 25,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.45,
            "wholesalePrice": 15.0,
            "category": "Accessories",
            "brand": "Nike",
            "sales": 95,
            "tenantId": "default_tenant"
        },

        # CHAMPIONS SOUVENIRS (Zone B)
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
            "category": "Equipment",
            "brand": "Adidas",
            "sales": 70,
            "tenantId": "default_tenant"
        },
        {
            "name": "Champions Souvenirs",
            "location": {
                "type": "Point",
                "coordinates": [121.515, 31.245]
            },
            "item": "Futsal Ball",
            "current_stock": 80,
            "target_stock": 15,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.45,
            "wholesalePrice": 22.0,
            "category": "Equipment",
            "brand": "Adidas",
            "sales": 30,
            "tenantId": "default_tenant"
        },
        {
            "name": "Champions Souvenirs",
            "location": {
                "type": "Point",
                "coordinates": [121.515, 31.245]
            },
            "item": "Goalkeeper Gloves",
            "current_stock": 65,
            "target_stock": 10,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.50,
            "wholesalePrice": 25.0,
            "category": "Equipment",
            "brand": "Puma",
            "sales": 12,
            "tenantId": "default_tenant"
        },

        # STADIUM SNACKS & GEAR (Zone B)
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
            "category": "Refreshments",
            "brand": "Nike",
            "sales": 35,
            "tenantId": "default_tenant"
        },
        {
            "name": "Stadium Snacks & Gear",
            "location": {
                "type": "Point",
                "coordinates": [121.516, 31.246]
            },
            "item": "Isotonic Energy Drink",
            "current_stock": 200,
            "target_stock": 40,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.70,
            "wholesalePrice": 3.00,
            "category": "Refreshments",
            "brand": "Coca-Cola",
            "sales": 250,
            "tenantId": "default_tenant"
        },
        {
            "name": "Stadium Snacks & Gear",
            "location": {
                "type": "Point",
                "coordinates": [121.516, 31.246]
            },
            "item": "Organic Protein Yogurt",
            "current_stock": 50,
            "target_stock": 10,
            "surgeAllocatedStock": 0,
            "claimedBy": [],
            "margin": 0.65,
            "wholesalePrice": 5.00,
            "category": "Refreshments",
            "brand": "Under Armour",
            "sales": 8,
            "tenantId": "default_tenant"
        }
    ]
    db.stores.insert_many(stores)
    print("Successfully seeded storefronts.")

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

    # 7. Seed NEX-RMN google_shopping_products
    shopping_products = [
        {
            "tenantId": "nike_official",
            "zoneId": "Zone_A",
            "googleMerchantFields": {
                "title": "USA 2026 Match Jersey",
                "description": "Official breathable national team kit",
                "g_mpn": "US-JER-2026",
                "base_price": 120.00,
                "sale_price": 120.00
            },
            "inventory_metrics": {
                "availableStock": 150,
                "allocatedInCarts": 0,
                "safetyBuffer": 20
            },
            "realtime_demand": {
                "searchVelocity30s": 0,
                "cartAdditions30s": 0
            }
        },
        {
            "tenantId": "nike_official",
            "zoneId": "Zone_A",
            "googleMerchantFields": {
                "title": "Rain Poncho Premium",
                "description": "Full coverage water resistant match day poncho",
                "g_mpn": "US-PONCHO-01",
                "base_price": 45.00,
                "sale_price": 45.00
            },
            "inventory_metrics": {
                "availableStock": 500,
                "allocatedInCarts": 0,
                "safetyBuffer": 20
            },
            "realtime_demand": {
                "searchVelocity30s": 0,
                "cartAdditions30s": 0
            }
        },
        {
            "tenantId": "starbucks_official",
            "zoneId": "Zone_B",
            "googleMerchantFields": {
                "title": "Starbucks Reserve Cold Brew",
                "description": "Nitro cold brew iced coffee cup",
                "g_mpn": "SBX-COLDBREW",
                "base_price": 7.50,
                "sale_price": 7.50
            },
            "inventory_metrics": {
                "availableStock": 8,  # 3 units above safety buffer (5)
                "allocatedInCarts": 0,
                "safetyBuffer": 5
            },
            "realtime_demand": {
                "searchVelocity30s": 0,
                "cartAdditions30s": 0
            }
        },
        {
            "tenantId": "redbull_official",
            "zoneId": "Zone_B",
            "googleMerchantFields": {
                "title": "Red Bull Energy Can",
                "description": "Ice cold classic Red Bull 12oz",
                "g_mpn": "RED-BULL-01",
                "base_price": 4.50,
                "sale_price": 4.50
            },
            "inventory_metrics": {
                "availableStock": 100,
                "allocatedInCarts": 0,
                "safetyBuffer": 10
            },
            "realtime_demand": {
                "searchVelocity30s": 0,
                "cartAdditions30s": 0
            }
        },
        {
            "tenantId": "fifa_souvenirs",
            "zoneId": "Zone_A",
            "googleMerchantFields": {
                "title": "FIFA Mascot Plush Toy",
                "description": "Official 2026 mascot collectible plush",
                "g_mpn": "FIFA-MASCOT",
                "base_price": 25.00,
                "sale_price": 25.00
            },
            "inventory_metrics": {
                "availableStock": 80,
                "allocatedInCarts": 0,
                "safetyBuffer": 10
            },
            "realtime_demand": {
                "searchVelocity30s": 0,
                "cartAdditions30s": 0
            }
        }
    ]
    raw_db.google_shopping_products.insert_many(shopping_products)
    print("Successfully seeded google_shopping_products.")

    # 8. Seed NEX-RMN google_ads_campaigns
    ads_campaigns = [
        {
            "campaignId": "camp_nike_poncho",
            "tenantId": "nike_official",
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": 1.80,
            "dailyBudget": 500.00,
            "remainingBudget": 450.00,
            "status": "ELIGIBLE",
            "targetingCriteria": {
                "targetZones": ["Zone_A"],
                "audienceContextVectors": ["excited", "rain poncho", "rainy weather", "looking for team gear"]
            },
            "creativeAsset": {
                "headline": "Stay Dry, Cheer Loud!",
                "body": "Grab your official USA Rain Poncho in Zone A."
            },
            "impressions": 0,
            "clicks": 0
        },
        {
            "campaignId": "camp_nike_jersey",
            "tenantId": "nike_official",
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": 1.50,
            "dailyBudget": 1000.00,
            "remainingBudget": 845.50,
            "status": "ELIGIBLE",
            "targetingCriteria": {
                "targetZones": ["Zone_A"],
                "audienceContextVectors": ["excited", "match jersey", "athletics", "team gear"]
            },
            "creativeAsset": {
                "headline": "Celebrate the Win in Style!",
                "body": "Get your official match kit now. Instant pick-up in Zone A."
            },
            "impressions": 0,
            "clicks": 0
        },
        {
            "campaignId": "camp_starbucks_coldbrew",
            "tenantId": "starbucks_official",
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": 1.20,
            "dailyBudget": 400.00,
            "remainingBudget": 320.00,
            "status": "ELIGIBLE",
            "targetingCriteria": {
                "targetZones": ["Zone_B"],
                "audienceContextVectors": ["exhausted", "hot weather", "cold brew coffee", "tired"]
            },
            "creativeAsset": {
                "headline": "Chill Out with Cold Brew",
                "body": "Cool down instantly in Zone B. 3 units above buffer left!"
            },
            "impressions": 0,
            "clicks": 0
        },
        {
            "campaignId": "camp_redbull_energy",
            "tenantId": "redbull_official",
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": 1.60,
            "dailyBudget": 600.00,
            "remainingBudget": 510.00,
            "status": "ELIGIBLE",
            "targetingCriteria": {
                "targetZones": ["Zone_B"],
                "audienceContextVectors": ["exhausted", "need energy", "active", "hot weather"]
            },
            "creativeAsset": {
                "headline": "Gives You Wings!",
                "body": "Re-energize with ice-cold Red Bull in Zone B now."
            },
            "impressions": 0,
            "clicks": 0
        },
        {
            "campaignId": "camp_fifa_mascot",
            "tenantId": "fifa_souvenirs",
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": 1.00,
            "dailyBudget": 300.00,
            "remainingBudget": 240.00,
            "status": "ELIGIBLE",
            "targetingCriteria": {
                "targetZones": ["Zone_A"],
                "audienceContextVectors": ["kids", "toy", "mascot", "fun"]
            },
            "creativeAsset": {
                "headline": "Take the Mascot Home!",
                "body": "Official 2026 World Cup Mascot plush toys in Zone A."
            },
            "impressions": 0,
            "clicks": 0
        },
        {
            "campaignId": "camp_coop_starbucks_redbull",
            "tenantId": "coop_partnership",
            "isJoint": True,
            "partnerTenants": ["starbucks_official", "redbull_official"],
            "biddingStrategy": "Target_ROAS",
            "maxBidPerClick": 2.00,
            "dailyBudget": 800.00,
            "remainingBudget": 700.00,
            "status": "ELIGIBLE",
            "targetingCriteria": {
                "targetZones": ["Zone_B"],
                "audienceContextVectors": ["exhausted", "cold brew", "energy can", "need energy"]
            },
            "creativeAsset": {
                "headline": "Double the Energy Bundle!",
                "body": "Grab a Starbucks Reserve Cold Brew & Red Bull Can deal in Zone B!"
            },
            "impressions": 0,
            "clicks": 0
        }
    ]
    raw_db.google_ads_campaigns.insert_many(ads_campaigns)
    print("Successfully seeded google_ads_campaigns.")

if __name__ == "__main__":
    seed_data()
