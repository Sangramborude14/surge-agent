import sys
from db import db, init_db

def seed_data():
    # 1. Initialize DB and create index
    init_db()
    
    # 2. Clear existing stores
    db.stores.delete_many({})
    print("Cleared existing storefronts.")

    # 3. Define the storefront data
    # Coordinates format: [longitude, latitude]
    stores = [
        {
            "name": "World Cup Athletics",
            "location": {
                "type": "Point",
                "coordinates": [121.501, 31.240]
            },
            "item": "World Cup Jersey",
            "current_stock": 150,
            "target_stock": 20
        },
        {
            "name": "Fan Zone Goods",
            "location": {
                "type": "Point",
                "coordinates": [121.502, 31.241]
            },
            "item": "Mascot Cap",
            "current_stock": 80,
            "target_stock": 10
        },
        {
            "name": "Champions Souvenirs",
            "location": {
                "type": "Point",
                "coordinates": [121.515, 31.245]
            },
            "item": "Tournament Soccer Ball",
            "current_stock": 120,
            "target_stock": 30
        },
        {
            "name": "Stadium Snacks & Gear",
            "location": {
                "type": "Point",
                "coordinates": [121.516, 31.246]
            },
            "item": "Reusable Water Bottle",
            "current_stock": 60,
            "target_stock": 15
        }
    ]

    # 4. Insert storefronts
    result = db.stores.insert_many(stores)
    print(f"Successfully seeded {len(result.inserted_ids)} storefronts.")

if __name__ == "__main__":
    seed_data()
