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
db = client[db_name]

def init_db():
    """
    Initializes the database by ensuring the 'stores' collection exists
    and has a 2dsphere index on the 'location' field.
    """
    # Create the 2dsphere index on the location field
    db.stores.create_index([("location", "2dsphere")])
    print("Database initialized successfully with 2dsphere index on 'stores.location'.")

if __name__ == "__main__":
    init_db()
