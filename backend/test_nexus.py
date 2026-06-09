import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

# Ensure backend directory is in the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from db import db, raw_db, init_db
from seed import seed_data
from tenancy import set_current_tenant_id, get_current_tenant_id, set_global_default_tenant
from nexus_governor import predictive_inventory_shift, create_coop_deal, sentiment_vector_search

class TestNexusGovernor(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        init_db()
        
    def setUp(self):
        # Reset tenant state to default
        set_global_default_tenant("default_tenant")
        set_current_tenant_id("default_tenant")
        
        # Populate database with MetLife Semifinal baseline seed
        seed_data()

    # ==========================================
    # WORKFLOW A: PREDICTIVE B2B STOCK SHIFT
    # ==========================================
    def test_predictive_inventory_shifting(self):
        print("\n--- Testing Workflow A: Predictive B2B Stock Shifting ---")
        
        # 1. Fetch initial stocks for kiosk and warehouse
        kiosk = raw_db.tenant_inventory.find_one({"tenantId": "kiosk_sector_3_plaza_01"})
        kiosk_item = next(item for item in kiosk["items"] if item["itemId"] == "portable_fan_01")
        initial_kiosk_stock = kiosk_item["availableStock"]
        self.assertEqual(initial_kiosk_stock, 5)
        
        warehouse = raw_db.tenant_inventory.find_one({"tenantId": "warehouse_central_01"})
        wh_item = next(item for item in warehouse["items"] if item["itemId"] == "portable_fan_01")
        initial_wh_stock = wh_item["availableStock"]
        self.assertEqual(initial_wh_stock, 300)
        
        # 2. Trigger predictive shifting
        # Max deviceCount in seeded foot traffic is 350 + (9 * 15) = 485. 
        # 15% predicted conversion demand = ceil/int(485 * 0.15) = 72 units.
        # Deficit is 72 - (5 available - 2 safetyBuffer) = 69 units.
        # Shift units = min(69, 300 - 15) = 69 units.
        result = predictive_inventory_shift("zone_sector_3_plaza", "portable_fan_01")
        
        self.assertEqual(result["status"], "SHIFT_DISPATCHED")
        self.assertEqual(result["transferredUnits"], 69)
        self.assertEqual(result["fromTenant"], "warehouse_central_01")
        self.assertEqual(result["toTenant"], "kiosk_sector_3_plaza_01")
        
        # 3. Assert stock transfers were atomically committed
        kiosk_updated = raw_db.tenant_inventory.find_one({"tenantId": "kiosk_sector_3_plaza_01"})
        kiosk_item_updated = next(item for item in kiosk_updated["items"] if item["itemId"] == "portable_fan_01")
        self.assertEqual(kiosk_item_updated["availableStock"], 5 + 69)
        
        wh_updated = raw_db.tenant_inventory.find_one({"tenantId": "warehouse_central_01"})
        wh_item_updated = next(item for item in wh_updated["items"] if item["itemId"] == "portable_fan_01")
        self.assertEqual(wh_item_updated["availableStock"], 300 - 69)
        
        print("[SUCCESS] Workflow A: Predictive shifting, geospatial lookup, and B2B stock updates validated.")

    # ==========================================
    # WORKFLOW B: CO-OPETITION & DISCOUNT SCALING
    # ==========================================
    def test_coop_deal_creation_and_profit_optimization(self):
        print("\n--- Testing Workflow B: Co-Opetition Matchmaking & Discount Scaling ---")
        
        # A. Run baseline test where pricing margins are profitable at 30% discount
        # KidzToyz: basePrice=45.00, marginalCost=15.00 (Margin: 30.00)
        # FrostyShakes: basePrice=8.50, marginalCost=1.50 (Margin: 7.00)
        # Combined Margin at 30% discount: 30 * 0.7 + 7 * 0.7 = 21 + 4.9 = 25.90 > 0
        result = create_coop_deal("zone_sector_3_plaza", "families")
        
        self.assertEqual(result.discountA, 30)
        self.assertEqual(result.discountB, 30)
        self.assertEqual(result.combinedMargin, 25.90)
        
        # Verify store stock was decremented (allocated to surge)
        toy_store = raw_db.tenant_inventory.find_one({"tenantId": "kidztoyz_01"})
        toy_item = toy_store["items"][0]
        self.assertEqual(toy_item["availableStock"], 44)
        self.assertEqual(toy_item["allocatedSurgeStock"], 1)
        
        # Verify campaign document was inserted
        campaign = raw_db.co_opetition_campaigns.find_one({"campaignId": result.campaignId})
        self.assertIsNotNone(campaign)
        self.assertEqual(campaign["triggerZoneId"], "zone_sector_3_plaza")
        
        # B. Run test triggering discount scaling (simulate extremely high marginal costs)
        # Set marginalCost of board game to 44.50 and frozen yogurt to 8.00
        raw_db.tenant_inventory.update_one(
            {"tenantId": "kidztoyz_01", "items.itemId": "board_game_family_01"},
            {"$set": {"items.$.marginalCost": 44.00}}
        )
        raw_db.tenant_inventory.update_one(
            {"tenantId": "frostyshakes_01", "items.itemId": "frozen_yogurt_large"},
            {"$set": {"items.$.marginalCost": 8.00}}
        )
        # Price margins now:
        # KidzToyz: 45 - 44 = 1.00
        # FrostyShakes: 8.50 - 8.00 = 0.50
        # At 30% discount: 1 * 0.70 + 0.50 * 0.70 = 0.70 + 0.35 = 1.05 > 0 (still profitable)
        # Let's set marginalCost equal to basePrice to trigger scaling
        raw_db.tenant_inventory.update_one(
            {"tenantId": "kidztoyz_01", "items.itemId": "board_game_family_01"},
            {"$set": {"items.$.marginalCost": 45.00}} # Margin is 0.00
        )
        raw_db.tenant_inventory.update_one(
            {"tenantId": "frostyshakes_01", "items.itemId": "frozen_yogurt_large"},
            {"$set": {"items.$.marginalCost": 8.50}}  # Margin is 0.00
        )
        # Margins are 0. At 30% discounts, combined margin is 0 * 0.7 + 0 * 0.7 = 0.
        # Our loop: combined_margin <= 0.0, so it will scale discounts down to 5% and 5% (margin will still be 0.0)
        scale_result = create_coop_deal("zone_sector_3_plaza", "families")
        
        self.assertEqual(scale_result.discountA, 5)
        self.assertEqual(scale_result.discountB, 5)
        self.assertEqual(scale_result.combinedMargin, 0.0)
        
        print("[SUCCESS] Workflow B: Co-op deal matchmaking and margin scaling constraints validated.")

    # ==========================================
    # WORKFLOW C: GEOSPATIAL VECTOR SENTIMENT SEARCH
    # ==========================================
    def test_sentiment_vector_search_with_geo_filtering(self):
        print("\n--- Testing Workflow C: Sentiment Vector Search & Geo-Fencing ---")
        
        # 1. User located inside MetLife Sector 3 Plaza zone
        user_coords = [-74.0062, 40.7130]
        user_mood = "My kids are crying, they are so hot, and we need an escape from the crowd."
        
        result = sentiment_vector_search(user_mood, user_coords)
        
        self.assertEqual(result["zoneId"], "zone_sector_3_plaza")
        self.assertEqual(result["zoneName"], "MetLife Stadium Sector 3 Plaza")
        
        # Verify matched campaign is the seeded "Cool Play Family Bundle"
        self.assertEqual(result["offer"]["title"], "👪 Cool Play Family Bundle")
        
        # Verify empathetic ad copy matches crying/hot children keywords
        self.assertIn("crying", result["empatheticMessage"].lower())
        self.assertIn("hot", result["empatheticMessage"].lower())
        self.assertIn("escape", result["empatheticMessage"].lower())
        
        # 2. User located outside zone should raise ValueError
        outside_coords = [0.0, 0.0]
        with self.assertRaises(ValueError):
            sentiment_vector_search(user_mood, outside_coords)
            
        print("[SUCCESS] Workflow C: Geospatial zone resolution and vector sentiment matching validated.")

if __name__ == "__main__":
    unittest.main()
