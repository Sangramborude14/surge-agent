import os
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/surge_db")

client = MongoClient(MONGODB_URI)
db_name = MONGODB_URI.split("/")[-1].split("?")[0] or "surge_db"
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
