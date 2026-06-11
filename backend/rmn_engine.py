import random
from datetime import datetime, timezone
from pymongo import UpdateOne
from db import db, raw_db

def log_rmn(message: str):
    """Dynamically logs to the global main pipeline console if main is imported, else prints."""
    try:
        from main import add_log
        add_log(message)
    except Exception:
        print(f"[{datetime.now(timezone.utc).isoformat()}] [RMN Engine] {message}")

def run_rtb_auction(zone_id: str, query_text: str):
    """
    Executes a programmatic Real-Time Bidding (RTB) ad auction for a given zone and query context.
    Determines the winning campaign and the actual CPC dynamically using Google Ads Vickrey Second-Price formulas.
    """
    query_text = (query_text or "").strip().lower()
    from edge_compute import get_zone_visitor_count
    
    # Feature 3: Fetch zone visitor count from Wi-Fi sensor logs
    visitors = 0
    try:
        visitors = get_zone_visitor_count(zone_id.lower())
    except Exception as e:
        log_rmn(f"[TRAFFIC ERROR] Failed to fetch visitor count for {zone_id}: {e}")
        
    traffic_multiplier = 1.5 if visitors >= 5 else 1.0
    
    # 1. Fetch eligible campaigns for this zone with budget
    campaigns = list(raw_db.google_ads_campaigns.find({
        "targetingCriteria.targetZones": zone_id,
        "status": "ELIGIBLE",
        "remainingBudget": {"$gt": 0.0}
    }))
    
    if not campaigns:
        return None

    auction_candidates = []
    disqualified_candidates = []
    
    # 2. Score each campaign's Quality Score & calculate Ad Rank
    for camp in campaigns:
        # A. Base Quality Score
        base_qs = 5.0
        
        # B. Sentiment Fit Score (Semantic overlapping with targetingCriteria.audienceContextVectors)
        sentiment_fit = 0.0
        if query_text:
            for vector_word in camp["targetingCriteria"]["audienceContextVectors"]:
                vw = vector_word.lower()
                if vw in query_text or query_text in vw:
                    sentiment_fit = max(sentiment_fit, 4.0)
                    # Boost for direct keyword alignment
                    if query_text == vw or any(word in vw for word in query_text.split()):
                        sentiment_fit = max(sentiment_fit, 5.0)
        
        # C. Scarcity & Inventory Multiplier
        product = None
        if camp.get("isJoint"):
            # Joint campaign: verify all partner products have stock above safety buffer
            partner_tenants = camp.get("partnerTenants", [])
            multiplier = 1.0
            for pt in partner_tenants:
                prod = raw_db.google_shopping_products.find_one({
                    "tenantId": pt,
                    "zoneId": zone_id
                })
                if prod:
                    if not product:
                        product = prod
                    avail = prod["inventory_metrics"]["availableStock"]
                    buffer = prod["inventory_metrics"]["safetyBuffer"]
                    if avail <= buffer:
                        multiplier = 0.0
                        break
        else:
            product = raw_db.google_shopping_products.find_one({
                "tenantId": camp["tenantId"],
                "zoneId": zone_id
            })
            if not product:
                multiplier = 1.0
            else:
                avail = product["inventory_metrics"]["availableStock"]
                buffer = product["inventory_metrics"]["safetyBuffer"]
                
                if avail <= buffer:
                    multiplier = 0.0
                elif avail > 100:
                    multiplier = 1.2
                else:
                    multiplier = 1.0
                
        # Calculate final Quality Score
        qs = (base_qs + sentiment_fit) * multiplier
        if multiplier > 0:
            qs = max(1.0, min(10.0, qs))
        else:
            qs = 0.0
            
        # Feature 3: Calculate Ad Rank = maxBidPerClick * Quality Score * traffic_multiplier
        ad_rank = camp["maxBidPerClick"] * qs * traffic_multiplier
        
        cand_entry = {
            "campaignId": camp["campaignId"],
            "maxBidPerClick": camp["maxBidPerClick"],
            "qs": qs,
            "trafficMultiplier": traffic_multiplier,
            "adRank": round(ad_rank, 2)
        }
        
        if ad_rank > 0:
            auction_candidates.append({
                "campaign": camp,
                "qs": qs,
                "ad_rank": ad_rank,
                "product": product,
                "entry": cand_entry
            })
        else:
            cand_entry["status"] = "DISQUALIFIED_STOCK_SHORTAGE" if multiplier == 0.0 else "DISQUALIFIED_NO_RANK"
            disqualified_candidates.append(cand_entry)
            
    if not auction_candidates:
        return None
        
    # Sort candidates by Ad Rank descending
    auction_candidates.sort(key=lambda x: x["ad_rank"], reverse=True)
    winner_item = auction_candidates[0]
    winner_camp = winner_item["campaign"]
    winner_qs = winner_item["qs"]
    
    # 3. Second-Price Vickrey Billing (Winner pays minimum required to beat runner-up)
    if len(auction_candidates) > 1:
        runner_up = auction_candidates[1]
        # Billed CPC = (runner_up_Ad_Rank / (winner_QS * traffic_multiplier)) + 0.01
        actual_cpc = (runner_up["ad_rank"] / (winner_qs * traffic_multiplier)) + 0.01
        actual_cpc = max(0.05, min(winner_camp["maxBidPerClick"], actual_cpc))
    else:
        actual_cpc = max(0.05, min(winner_camp["maxBidPerClick"], 0.05))
        
    actual_cpc = round(actual_cpc, 2)
    
    # Feature 4 & Feature 1: Atomic Budget Deduction & Metrics
    if winner_camp.get("isJoint"):
        partner_tenants = winner_camp.get("partnerTenants", [])
        split_cpc = round(actual_cpc / len(partner_tenants), 2)
        for pt in partner_tenants:
            raw_db.google_ads_campaigns.update_one(
                {"tenantId": pt, "isJoint": {"$ne": True}},
                {"$inc": {"remainingBudget": -split_cpc, "impressions": 1}}
            )
        raw_db.google_ads_campaigns.update_one(
            {"campaignId": winner_camp["campaignId"]},
            {"$inc": {"remainingBudget": -actual_cpc, "impressions": 1}}
        )
    else:
        raw_db.google_ads_campaigns.update_one(
            {"campaignId": winner_camp["campaignId"]},
            {"$inc": {"remainingBudget": -actual_cpc, "impressions": 1}}
        )
        
    # Feature 2: Construct detailed candidate logs for ledger
    ledger_candidates = []
    for idx, cand in enumerate(auction_candidates):
        entry = dict(cand["entry"])
        if idx == 0:
            entry["status"] = "WINNER"
        elif idx == 1:
            entry["status"] = "RUNNER_UP"
        else:
            entry["status"] = "ELIGIBLE"
        ledger_candidates.append(entry)
        
    ledger_candidates.extend(disqualified_candidates)
    
    log_rmn(f"[AUCTION] Winner: '{winner_camp['campaignId']}' in '{zone_id}'. Bid={winner_camp['maxBidPerClick']}, QS={winner_qs:.2f}, AdRank={winner_item['ad_rank']:.2f}. Billed CPC: ${actual_cpc:.2f}. Traffic Multiplier: {traffic_multiplier}x.")
    
    return {
        "campaignId": winner_camp["campaignId"],
        "tenantId": winner_camp["tenantId"],
        "headline": winner_camp["creativeAsset"]["headline"],
        "body": winner_camp["creativeAsset"]["body"],
        "qs": winner_qs,
        "ad_rank": winner_item["ad_rank"],
        "actual_cpc": actual_cpc,
        "product": winner_item["product"],
        "ledger": ledger_candidates,
        "trafficMultiplier": traffic_multiplier,
        "zoneVisitors": visitors
    }

def calculate_yield_price(product: dict, search_vel: int, cart_adds: int) -> float:
    """
    Applies the High-Velocity Search Scarcity and Low-Conversion Stimulation rules
    to dynamically modulate the shopping product's sale_price.
    """
    merchant_fields = product["googleMerchantFields"]
    base_price = merchant_fields["base_price"]
    avail = product["inventory_metrics"]["availableStock"]
    buffer = product["inventory_metrics"]["safetyBuffer"]
    
    # Check if stock has reached/expired past safety buffer
    if avail <= buffer:
        return base_price
        
    # Rule A: High-Velocity Search Scarcity
    # If search spikes for an item with low stock, reduce discount (raise price)
    if search_vel >= 10 and (avail - buffer < 20):
        # Scale discount down to 5% off (protecting margin)
        sale_price = base_price * 0.95
        log_rmn(f"[YIELD SCARCITY] High searches ({search_vel}) & low stock ({avail}) detected for '{merchant_fields['title']}'. Price raised to ${sale_price:.2f}.")
        return round(sale_price, 2)
        
    # Rule B: Low-Conversion Stimulation
    # If searches spike but cart additions are zero, drop price by 30% to stimulate immediate purchases
    if search_vel >= 5 and cart_adds == 0:
        sale_price = base_price * 0.70
        log_rmn(f"[YIELD STIMULATION] High searches ({search_vel}) & 0 cart additions detected for '{merchant_fields['title']}'. Price dropped to ${sale_price:.2f}.")
        return round(sale_price, 2)
        
    # Default baseline discount: 15% off
    sale_price = base_price * 0.85
    return round(sale_price, 2)

def flush_rmn_events():
    """
    Flushes asynchronous user events from rmn_asynchronous_events,
    aggregates metrics, bulk writes updates to google_shopping_products,
    and updates dynamic product prices.
    """
    try:
        # Read and delete events atomically in a batch (simulate a queue read)
        events = list(raw_db.rmn_asynchronous_events.find({}))
        if not events:
            return
            
        # Delete the processed events from the buffer
        event_ids = [e["_id"] for e in events]
        raw_db.rmn_asynchronous_events.delete_many({"_id": {"$in": event_ids}})
        
        # Aggregate search and cart counts by item MPN and Zone
        aggregates = {}
        for event in events:
            key = (event["zoneId"], event["targetItemMpn"])
            if key not in aggregates:
                aggregates[key] = {"search": 0, "cart_add": 0}
            
            if event["type"] == "search":
                aggregates[key]["search"] += event.get("weight", 1)
            elif event["type"] == "cart_add":
                aggregates[key]["cart_add"] += event.get("weight", 5)
                
        # Perform Bulk Write to update realtime demand metrics
        ops = []
        for (zone_id, mpn), counts in aggregates.items():
            ops.append(UpdateOne(
                {"zoneId": zone_id, "googleMerchantFields.g_mpn": mpn},
                {
                    "$inc": {
                        "realtime_demand.searchVelocity30s": counts["search"],
                        "realtime_demand.cartAdditions30s": counts["cart_add"]
                    }
                }
            ))
            
        if ops:
            raw_db.google_shopping_products.bulk_write(ops)
            
        # Re-price all items dynamically based on the updated metrics
        products = list(raw_db.google_shopping_products.find({}))
        for prod in products:
            search_vel = prod["realtime_demand"].get("searchVelocity30s", 0)
            cart_adds = prod["realtime_demand"].get("cartAdditions30s", 0)
            
            new_sale_price = calculate_yield_price(prod, search_vel, cart_adds)
            
            raw_db.google_shopping_products.update_one(
                {"_id": prod["_id"]},
                {"$set": {"googleMerchantFields.sale_price": new_sale_price}}
            )
            
        log_rmn(f"[FLUSHER] Flushed {len(events)} asynchronous RMN events to Google Shopping Products. Prices updated dynamically.")
    except Exception as e:
        log_rmn(f"[FLUSHER ERROR] Failed to flush events: {e}")
