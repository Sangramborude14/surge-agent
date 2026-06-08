import time
import json
import urllib.request
import urllib.error

# Coordinates for Zone A and Zone B
ZONE_A = [121.501, 31.240]
ZONE_B = [121.515, 31.245]

import os

API_URL = os.getenv("API_URL", "https://surge-agent.onrender.com/api/surge")

def run_simulation():
    print("Starting background crowd simulator polling...")
    print(f"Targeting: {API_URL} every 10 seconds")
    
    zones = [
        {"name": "Zone A", "coords": ZONE_A},
        {"name": "Zone B", "coords": ZONE_B}
    ]
    
    index = 0
    while True:
        zone = zones[index]
        payload = {
            "coordinates": zone["coords"],
            "radius_meters": 500.0
        }
        
        print(f"\n[Simulator] Simulating tourist surge in {zone['name']} at coordinates {zone['coords']}...")
        
        # Prepare request
        req = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                response_data = json.loads(response.read().decode("utf-8"))
                promotions = response_data.get("triggered_promotions", [])
                print(f"[Simulator] Successfully sent surge update. Triggered {len(promotions)} promotions:")
                for promo in promotions:
                    print(f"  - {promo['store_name']}: {promo['discount_code']} - {promo['message']}")
        except urllib.error.URLError as e:
            print(f"[Simulator] API server error/unavailable (is uvicorn running?): {e}")
        except Exception as e:
            print(f"[Simulator] Unexpected error: {e}")
            
        # Alternate between Zone A and Zone B
        index = (index + 1) % len(zones)
        
        # Poll every 10 seconds
        time.sleep(10)

if __name__ == "__main__":
    run_simulation()
