import os
import time
import hashlib
import threading
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from db import db, raw_db

# EDGE COMPUTE SIMULATOR BUFFER
class EdgePingBuffer:
    def __init__(self):
        self.lock = threading.Lock()
        # Key: (gatewayId, zoneId, tenantId, anonymousHash) -> List of timestamps & signal strengths
        self.buffer: Dict[tuple, List[Dict[str, Any]]] = {}

    def add_ping(self, device_id: str, gateway_id: str, zone_id: str, tenant_id: str, signal_strength: float):
        """Buffers raw Wi-Fi/spatial pings. Anonymizes user identifiers immediately at the edge."""
        # 1. Anonymize user identifier at the edge (privacy-first GDPR/CCPA compliance)
        anon_hash = self.anonymize_device_id(device_id, tenant_id)
        
        key = (gateway_id, zone_id, tenant_id, anon_hash)
        ping_entry = {
            "timestamp": datetime.now(timezone.utc),
            "signal_strength": signal_strength
        }
        
        with self.lock:
            if key not in self.buffer:
                self.buffer[key] = []
            self.buffer[key].append(ping_entry)

    def anonymize_device_id(self, device_id: str, tenant_id: str) -> str:
        """Helper to generate cryptographic, daily-salted SHA-256 hashes of device IDs."""
        salt_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Anonymization salt from environment configuration
        salt = os.getenv("ANONYMIZATION_SALT", "default_secret_salt_2026")
        payload = f"{device_id}:{salt_date}:{tenant_id}:{salt}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def flush_aggregated_buffer(self) -> List[Dict[str, Any]]:
        """
        Groups individual pings over the sliding 10-second window.
        Flushes and pushes aggregated logs into the MongoDB Time Series collection.
        """
        with self.lock:
            temp_buffer = self.buffer
            self.buffer = {}

        flushed_logs = []
        now = datetime.now(timezone.utc)
        
        for (gateway_id, zone_id, tenant_id, anon_hash), pings in temp_buffer.items():
            if not pings:
                continue
            
            # Aggregate pings over the sliding window
            avg_signal = sum(p["signal_strength"] for p in pings) / len(pings)
            
            # We record a Time Series log entry representing this device session
            log_entry = {
                "timestamp": now,
                "sensorMetadata": {
                    "gatewayId": gateway_id,
                    "tenantId": tenant_id,
                    "zoneId": zone_id
                },
                "anonymousHash": anon_hash,
                "avgSignalStrength": avg_signal,
                "pingCount": len(pings)
            }
            flushed_logs.append(log_entry)

        if flushed_logs:
            # We bypass the tenanted wrapper for system edge pushes as it already includes tenantId explicitly
            raw_db.raw_spatial_logs.insert_many(flushed_logs)
            print(f"[Edge Buffer] Flushed {len(flushed_logs)} aggregated time-series entries to MongoDB.")
            
        return flushed_logs


# Instantiate global edge buffer
global_edge_buffer = EdgePingBuffer()


# HISTORICAL ROLLUP BACKGROUND JOB
def run_historical_rollup(target_hour: Optional[datetime] = None) -> int:
    """
    Scheduled job that aggregates raw logs into a hourly/daily historical trends collection
    before the Time Series records expire from the 24-hour TTL index.
    """
    # If no target hour is provided, aggregate the previous hour
    if target_hour is None:
        now = datetime.now(timezone.utc)
        target_hour = (now - timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
        
    start_time = target_hour
    end_time = target_hour + timedelta(hours=1)
    
    print(f"[Rollup Job] Running hourly trends consolidation for period: {start_time.isoformat()} to {end_time.isoformat()}")

    # Aggregation pipeline using raw_db to process multi-tenant rollups in a single job
    pipeline = [
        {
            "$match": {
                "timestamp": {
                    "$gte": start_time,
                    "$lt": end_time
                }
            }
        },
        {
            "$project": {
                "hour": {
                    "$dateTrunc": {
                        "date": "$timestamp",
                        "unit": "hour"
                    }
                },
                "zoneId": "$sensorMetadata.zoneId",
                "tenantId": "$sensorMetadata.tenantId",
                "anonymousHash": "$anonymousHash",
                "pingCount": 1
            }
        },
        {
            "$group": {
                "_id": {
                    "hour": "$hour",
                    "zoneId": "$zoneId",
                    "tenantId": "$tenantId"
                },
                "uniqueDevices": {"$addToSet": "$anonymousHash"},
                "totalPings": {"$sum": {"$ifNull": ["$pingCount", 1]}}
            }
        },
        {
            "$project": {
                "_id": 0,
                "hour": "$_id.hour",
                "zoneId": "$_id.zoneId",
                "tenantId": "$_id.tenantId",
                "uniqueVisitorCount": {"$size": "$uniqueDevices"},
                "totalPings": "$totalPings"
            }
        },
        {
            # Merges aggregates into the historical_trends collection, matching on compound unique indexes
            "$merge": {
                "into": "historical_trends",
                "on": ["hour", "zoneId", "tenantId"],
                "whenMatched": "replace",
                "whenNotMatched": "insert"
            }
        }
    ]
    
    # Run aggregation on the Time Series collection
    raw_db.raw_spatial_logs.aggregate(pipeline)
    
    # Query merged results count
    rollup_count = raw_db.historical_trends.count_documents({
        "hour": start_time
    })
    print(f"[Rollup Job] Completed! Consolidated {rollup_count} unique tenant-zone trend records.")
    return rollup_count


# GEOSPATIAL FENCING & POLYGON AGGREGATION
def get_zone_visitor_count(zone_id: str) -> int:
    """
    Computes aggregate visitor counts in a GeoJSON polygon zone.
    Enforces multi-tenant data isolation transparently using the tenanted collection wrapper.
    """
    # 1. Fetch the zone boundary (polygonal shape) from the zones collection
    zone = db.zones.find_one({"zoneId": zone_id})
    if not zone:
        raise ValueError(f"Zone '{zone_id}' not found.")
        
    zone_polygon = zone["geometry"]
    
    # 2. Query devices currently inside the zone using $geoWithin
    # We do NOT use $near/$nearSphere to avoid expensive continuous point-to-point tracking.
    pipeline = [
        {
            "$match": {
                "location": {
                    "$geoWithin": {
                        "$geometry": zone_polygon
                    }
                }
            }
        },
        {
            "$group": {
                "_id": "$tenantId",
                "uniqueDevices": {
                    "$addToSet": "$anonymousHash"
                }
            }
        },
        {
            "$project": {
                "_id": 0,
                "visitorCount": {"$size": "$uniqueDevices"}
            }
        }
    ]
    
    # Because db.devices is wrapped, the aggregation automatically filters by current tenantId.
    results = list(db.devices.aggregate(pipeline))
    if results:
        return results[0]["visitorCount"]
    return 0
