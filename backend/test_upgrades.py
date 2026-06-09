import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from bson import ObjectId

# Ensure backend directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db import db, raw_db, init_db
from tenancy import set_current_tenant_id, get_current_tenant_id, set_global_default_tenant
from edge_compute import global_edge_buffer, run_historical_rollup, get_zone_visitor_count
from campaign_service import find_similar_campaigns, generate_creative_offer, create_and_save_campaign, track_campaign_impression, track_campaign_redemption, get_context_embedding
from reservation import allocate_surge_stock, claim_coupon

class TestAntigravityUpgrades(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        # 1. Initialize indices and collections
        init_db()
        
    def setUp(self):
        # Reset tenant state to default
        set_global_default_tenant("default_tenant")
        set_current_tenant_id("default_tenant")
        
        # Clear raw collections (bypassing tenancy filters) to ensure clean test runs
        raw_db.stores.delete_many({})
        raw_db.zones.delete_many({})
        raw_db.devices.delete_many({})
        raw_db.past_campaigns.delete_many({})
        raw_db.raw_spatial_logs.delete_many({})
        raw_db.historical_trends.delete_many({})

    # ==========================================
    # UPGRADE 4: MULTI-TENANT & ENCRYPTION TEST
    # ==========================================
    def test_multi_tenant_isolation_and_encryption(self):
        print("\n--- Running Upgrade 4: Multi-Tenant & Field Encryption Tests ---")
        
        # A. Verify Data Isolation
        set_current_tenant_id("tenant_nike")
        db.stores.insert_one({
            "name": "Nike Surge Outlet",
            "item": "Pegasus Running Shoes",
            "current_stock": 50,
            "target_stock": 10,
            "margin": 0.55,                # Sensitive field (to be encrypted)
            "wholesalePrice": 54.0         # Sensitive field (to be encrypted)
        })
        
        # Fetch for tenant_nike
        nike_stores = list(db.stores.find({}))
        self.assertEqual(len(nike_stores), 1)
        self.assertEqual(nike_stores[0]["name"], "Nike Surge Outlet")
        self.assertEqual(nike_stores[0]["margin"], 0.55) # Transparently decrypted
        
        # Switch tenant to tenant_adidas
        set_current_tenant_id("tenant_adidas")
        adidas_stores = list(db.stores.find({}))
        # Verify Nike's store is NOT visible to Adidas
        self.assertEqual(len(adidas_stores), 0)
        
        # B. Verify Encryption at Rest (CSFLE Fallback)
        # Query database via raw client bypassing wrappers
        raw_doc = raw_db.stores.find_one({"name": "Nike Surge Outlet"})
        self.assertIsNotNone(raw_doc)
        self.assertEqual(raw_doc["tenantId"], "tenant_nike")
        
        # Verify fields are encrypted (prefixed with "enc:")
        self.assertTrue(isinstance(raw_doc["margin"], str))
        self.assertTrue(raw_doc["margin"].startswith("enc:"))
        self.assertTrue(raw_doc["wholesalePrice"].startswith("enc:"))
        
        print("[SUCCESS] Multi-tenant data isolation and at-rest field encryption verified.")

    # ==========================================
    # UPGRADE 5: SMART INVENTORY RESERVATIONS TEST
    # ==========================================
    def test_smart_inventory_reservations(self):
        print("\n--- Running Upgrade 5: Smart Inventory Reservation Tests ---")
        set_current_tenant_id("tenant_starbucks")
        
        db.stores.insert_one({
            "name": "Starbucks Surge Hub",
            "item": "Caramel Macchiato",
            "current_stock": 100,
            "target_stock": 10,
            "surgeAllocatedStock": 0,
            "claimedBy": []
        })
        
        # A. Allocate Surge Stock
        allocate_surge_stock("Starbucks Surge Hub", "Caramel Macchiato", 20)
        
        # Verify stock decrement and allocation increment
        store = db.stores.find_one({"name": "Starbucks Surge Hub"})
        self.assertEqual(store["current_stock"], 80)
        self.assertEqual(store["surgeAllocatedStock"], 20)
        
        # B. Claim Coupon
        claim_coupon("Starbucks Surge Hub", "Caramel Macchiato", "user_marathon_runner")
        
        # Verify allocation decremented and user added to claimedBy list
        store = db.stores.find_one({"name": "Starbucks Surge Hub"})
        self.assertEqual(store["surgeAllocatedStock"], 19)
        self.assertIn("user_marathon_runner", store["claimedBy"])
        
        # C. Enforce Uniqueness: Double claim must fail
        with self.assertRaises(ValueError):
            claim_coupon("Starbucks Surge Hub", "Caramel Macchiato", "user_marathon_runner")
            
        # D. Enforce Stock Limits: Over-allocation must fail
        with self.assertRaises(ValueError):
            allocate_surge_stock("Starbucks Surge Hub", "Caramel Macchiato", 100) # Only 80 left in general stock
            
        print("[SUCCESS] ACID transaction bounds and atomic stock reservation rules verified.")

    # ==========================================
    # UPGRADE 1: EDGE COMPUTE & TIME SERIES TEST
    # ==========================================
    def test_edge_buffering_and_time_series_rollup(self):
        print("\n--- Running Upgrade 1: Edge Buffering & Rollup Tests ---")
        
        # A. Simulate Edge Ingestion
        global_edge_buffer.add_ping(
            device_id="dev_runner_1",
            gateway_id="gw_west",
            zone_id="zone_a",
            tenant_id="tenant_nike",
            signal_strength=-65.0
        )
        global_edge_buffer.add_ping(
            device_id="dev_runner_1", # Same device pinged again within window
            gateway_id="gw_west",
            zone_id="zone_a",
            tenant_id="tenant_nike",
            signal_strength=-55.0
        )
        global_edge_buffer.add_ping(
            device_id="dev_runner_2",
            gateway_id="gw_west",
            zone_id="zone_a",
            tenant_id="tenant_nike",
            signal_strength=-70.0
        )
        
        # B. Flush to Time Series logs
        flushed = global_edge_buffer.flush_aggregated_buffer()
        self.assertEqual(len(flushed), 2) # 2 unique device session keys aggregated
        
        # Check raw database Time Series logs
        logs = list(raw_db.raw_spatial_logs.find({}))
        self.assertEqual(len(logs), 2)
        
        # Clear logs to verify rollup independently and avoid updating time-series documents (which is forbidden)
        raw_db.raw_spatial_logs.delete_many({})
        
        # C. Run Historical Rollup Trend consolidation
        # Seed time-series document directly with a past timestamp
        prev_hour = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        raw_db.raw_spatial_logs.insert_many([
            {
                "timestamp": prev_hour + timedelta(minutes=10),
                "sensorMetadata": {
                    "gatewayId": "gw_west",
                    "tenantId": "tenant_nike",
                    "zoneId": "zone_a"
                },
                "anonymousHash": "anon_hash_1",
                "avgSignalStrength": -60.0,
                "pingCount": 2
            },
            {
                "timestamp": prev_hour + timedelta(minutes=15),
                "sensorMetadata": {
                    "gatewayId": "gw_west",
                    "tenantId": "tenant_nike",
                    "zoneId": "zone_a"
                },
                "anonymousHash": "anon_hash_2",
                "avgSignalStrength": -70.0,
                "pingCount": 1
            }
        ])
        
        rollup_count = run_historical_rollup(target_hour=prev_hour)
        self.assertEqual(rollup_count, 1) # Grouped into 1 consolidated zone/tenant trend document
        
        set_current_tenant_id("tenant_nike")
        trend = db.historical_trends.find_one({"zoneId": "zone_a"})
        self.assertIsNotNone(trend)
        self.assertEqual(trend["uniqueVisitorCount"], 2) # Anonymized unique user count (anon_hash_1 and anon_hash_2)
        self.assertEqual(trend["totalPings"], 3)          # Aggregated Wi-Fi pings (2 + 1)
        
        print("[SUCCESS] Time Series sliding-window logs and historical rollup aggregates verified.")

    # ==========================================
    # UPGRADE 2: GEOSPATIAL FENCING & PRIVACY TEST
    # ==========================================
    def test_geospatial_fencing_and_privacy_hashing(self):
        print("\n--- Running Upgrade 2: GeoJSON Fencing & Privacy Hashing Tests ---")
        set_current_tenant_id("tenant_apple")
        
        # A. Seed boundary polygon for Zone A (West Wing)
        db.zones.insert_one({
            "zoneId": "zone_west",
            "name": "Zone West Wing",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [10.0, 10.0],
                    [20.0, 10.0],
                    [20.0, 20.0],
                    [10.0, 20.0],
                    [10.0, 10.0]
                ]]
            }
        })
        
        # B. Insert device positions (one inside, one outside)
        anon_hash_inside = global_edge_buffer.anonymize_device_id("iphone_user_1", "tenant_apple")
        anon_hash_outside = global_edge_buffer.anonymize_device_id("iphone_user_2", "tenant_apple")
        
        db.devices.insert_many([
            {
                "anonymousHash": anon_hash_inside,
                "location": {"type": "Point", "coordinates": [15.0, 15.0]} # INSIDE
            },
            {
                "anonymousHash": anon_hash_outside,
                "location": {"type": "Point", "coordinates": [5.0, 5.0]}   # OUTSIDE
            }
        ])
        
        # C. Compute polygon containment visitor counts using geoWithin
        visitor_count = get_zone_visitor_count("zone_west")
        self.assertEqual(visitor_count, 1)
        
        print("[SUCCESS] $geoWithin polygon boundary query and cryptographic hashing privacy verified.")

    # ==========================================
    # UPGRADE 3: DYNAMIC VECTOR A/B TESTING TEST
    # ==========================================
    def test_dynamic_vector_ab_testing(self):
        print("\n--- Running Upgrade 3: Vector Search A/B Campaign & Creative Tests ---")
        set_current_tenant_id("tenant_nike")
        
        # A. Seed past campaigns database with precalculated embeddings
        ctx_rain = "Heavy pouring rain storm, tourists looking for shelter, wet weather apparel"
        ctx_sun = "Sunny hot afternoon, crowd searching for cold refreshments and t-shirts"
        
        db.past_campaigns.insert_many([
            {
                "title": "☔ Storm shelter discount",
                "copy": "Stay dry! 30% off all rain jackets inside the zone.",
                "discount_value": 30,
                "surge_context": ctx_rain,
                "context_embedding": get_context_embedding(ctx_rain),
                "impressions": 100,
                "redemptions": 30,
                "conversion_rate": 0.30
            },
            {
                "title": "☀️ Refreshment hydration pack",
                "copy": "Stay hydrated: Buy 1 get 1 free cold water and electrolytes.",
                "discount_value": 50,
                "surge_context": ctx_sun,
                "context_embedding": get_context_embedding(ctx_sun),
                "impressions": 200,
                "redemptions": 80,
                "conversion_rate": 0.40
            }
        ])
        
        # B. Run similarity query for new surge state: "Sudden thunderstorm, flooding corridors, tourists seek umbrellas"
        current_state = "Sudden thunderstorm, flooding corridors, tourists seek umbrellas"
        winners = find_similar_campaigns(current_state, limit=1)
        
        self.assertEqual(len(winners), 1)
        # Should match the rain campaign as nearest vector
        self.assertEqual(winners[0]["title"], "☔ Storm shelter discount")
        
        # C. Generate Creative Offer
        creative = generate_creative_offer(current_state, winners)
        self.assertTrue(len(creative.title) > 0)
        self.assertEqual(creative.discount_value, 30) # Derived from fallback average
        
        # D. Test Campaign Metrics Ingest & Conversion Rate Updates
        campaign = create_and_save_campaign(current_state, creative)
        campaign_id = campaign["_id"]
        
        track_campaign_impression(campaign_id)
        track_campaign_redemption(campaign_id)
        
        updated = db.past_campaigns.find_one({"_id": ObjectId(campaign_id)})
        self.assertEqual(updated["impressions"], 1)
        self.assertEqual(updated["redemptions"], 1)
        self.assertEqual(updated["conversion_rate"], 1.0)
        
        print("[SUCCESS] Vector similarity search fallback, Gemini creativity prompts, and feedback loop verified.")

    # ==========================================
    # UPGRADE FOLLOW-UP: RETAIL SIMULATOR PURCHASE TEST
    # ==========================================
    def test_purchase_item_api(self):
        print("\n--- Running Upgrade Follow-up: Purchase API Tests ---")
        import asyncio
        from main import purchase_item, PurchasePayload, active_promotions
        
        # A. Setup initial store and promotion
        set_current_tenant_id("default_tenant")
        db.stores.insert_one({
            "name": "World Cup Athletics",
            "item": "World Cup Jersey",
            "current_stock": 100,
            "target_stock": 20,
            "wholesalePrice": 45.0
        })
        
        active_promotions.clear()
        active_promotions.append({
            "id": "promo_1",
            "store_name": "World Cup Athletics",
            "item": "World Cup Jersey",
            "discount_code": "SURGE50_WORLD",
            "message": "50% off!",
            "duration_minutes": 15,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
        
        # B. Make purchase that decrements stock but keeps surplus high
        result = asyncio.run(purchase_item(PurchasePayload(
            storeName="World Cup Athletics",
            itemName="World Cup Jersey",
            quantity=10
        )))
        
        self.assertEqual(result["status"], "success")
        
        # Stock: 100 -> 90. Surplus: 90 - 20 = 70. Discount should scale to 40%
        store = db.stores.find_one({"name": "World Cup Athletics"})
        self.assertEqual(store["current_stock"], 90)
        
        self.assertEqual(len(result["promotions"]), 1)
        self.assertIn("SURGE40", result["promotions"][0]["discount_code"])
        
        # C. Make purchase that triggers promotion expiration (stock <= target_stock)
        result_exp = asyncio.run(purchase_item(PurchasePayload(
            storeName="World Cup Athletics",
            itemName="World Cup Jersey",
            quantity=70 # Stock goes to 20, which is <= target_stock (20)
        )))
        
        self.assertEqual(len(result_exp["promotions"]), 0) # Promo expired and cleared
        
        store = db.stores.find_one({"name": "World Cup Athletics"})
        self.assertEqual(store["current_stock"], 20)
        
        print("[SUCCESS] Dynamic purchase dynamic stock scaling and auto-expiration verified.")

if __name__ == "__main__":
    unittest.main()
