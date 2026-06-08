from typing import Optional
from db import db, client
from tenancy import get_current_tenant_id

def is_replica_set() -> bool:
    """Checks if the MongoDB instance is configured as a replica set (required for ACID transactions)."""
    try:
        status = db.command("replSetGetStatus")
        return True
    except Exception:
        # Standalone local deployment
        return False

def allocate_surge_stock(store_name: str, item_name: str, n_allocated: int) -> bool:
    """
    Atomically allocates stock from general inventory into a surge bucket.
    Prevents overselling during high concurrent surge event launches.
    """
    tenant_id = get_current_tenant_id()
    
    # 1. Check if the database supports transactions
    if is_replica_set():
        try:
            with client.start_session() as session:
                with session.start_transaction():
                    # We look up the store inside the transaction session
                    # db.stores is tenanted, so it automatically filters by tenantId
                    store = db.stores.find_one(
                        {"name": store_name, "item": item_name},
                        session=session
                    )
                    if not store:
                        raise ValueError(f"Store '{store_name}' with item '{item_name}' not found.")
                        
                    current_stock = store.get("current_stock", 0)
                    if current_stock < n_allocated:
                        raise ValueError(f"Insufficient stock ({current_stock}) to allocate {n_allocated} units.")
                        
                    # Perform updates inside transaction
                    db.stores.update_one(
                        {"_id": store["_id"]},
                        {
                            "$inc": {
                                "current_stock": -n_allocated,
                                "surgeAllocatedStock": n_allocated
                            }
                        },
                        session=session
                    )
                    print(f"[ACID Transaction] Allocated {n_allocated} units for '{store_name}'.")
                    return True
        except Exception as e:
            print(f"[ACID Transaction Error] Allocation transaction aborted: {e}")
            raise
    else:
        # 2. Local Standalone Fallback: Use single-query atomic update matching condition
        result = db.stores.update_one(
            {
                "name": store_name,
                "item": item_name,
                "current_stock": {"$gte": n_allocated}
            },
            {
                "$inc": {
                    "current_stock": -n_allocated,
                    "surgeAllocatedStock": n_allocated
                }
            }
        )
        if result.modified_count == 0:
            # Let's double check if store exists or if it was a stock issue
            store = db.stores.find_one({"name": store_name, "item": item_name})
            if not store:
                raise ValueError(f"Store '{store_name}' with item '{item_name}' not found.")
            curr_stock = store.get("current_stock", 0)
            raise ValueError(f"Insufficient stock ({curr_stock}) to allocate {n_allocated} units (Standalone Fallback).")
            
        print(f"[Atomic Ingest Fallback] Allocated {n_allocated} units for '{store_name}'.")
        return True

def claim_coupon(store_name: str, item_name: str, user_id: str) -> bool:
    """
    Atomically claims a coupon for a single user from the allocated surge inventory.
    Guarantees user uniqueness via claimedBy array filter checks.
    """
    tenant_id = get_current_tenant_id()
    
    # 1. Check if the database supports transactions
    if is_replica_set():
        try:
            with client.start_session() as session:
                with session.start_transaction():
                    store = db.stores.find_one(
                        {"name": store_name, "item": item_name},
                        session=session
                    )
                    if not store:
                        raise ValueError(f"Store '{store_name}' not found.")
                        
                    allocated = store.get("surgeAllocatedStock", 0)
                    if allocated <= 0:
                        raise ValueError("Surge stock is fully claimed.")
                        
                    claimed_by = store.get("claimedBy", [])
                    if user_id in claimed_by:
                        raise ValueError(f"User '{user_id}' has already claimed a coupon from this store.")
                        
                    # Decrement allocated stock and append user to claimedBy array
                    db.stores.update_one(
                        {"_id": store["_id"]},
                        {
                            "$inc": {"surgeAllocatedStock": -1},
                            "$push": {"claimedBy": user_id}
                        },
                        session=session
                    )
                    print(f"[ACID Transaction] Coupon claimed successfully for user '{user_id}'.")
                    return True
        except Exception as e:
            print(f"[ACID Transaction Error] Claim transaction aborted: {e}")
            raise
    else:
        # 2. Local Standalone Fallback: Use single-query atomic conditional update
        # Ensures atomic check and push: user is only pushed if they aren't in claimedBy list,
        # and there is surge allocated stock remaining.
        result = db.stores.update_one(
            {
                "name": store_name,
                "item": item_name,
                "claimedBy": {"$ne": user_id},
                "surgeAllocatedStock": {"$gt": 0}
            },
            {
                "$inc": {"surgeAllocatedStock": -1},
                "$push": {"claimedBy": user_id}
            }
        )
        if result.modified_count == 0:
            # Audit the failure reason
            store = db.stores.find_one({"name": store_name, "item": item_name})
            if not store:
                raise ValueError(f"Store '{store_name}' not found.")
            
            claimed_by = store.get("claimedBy", [])
            if user_id in claimed_by:
                raise ValueError(f"User '{user_id}' has already claimed a coupon from this store.")
                
            allocated = store.get("surgeAllocatedStock", 0)
            if allocated <= 0:
                raise ValueError("Surge stock is fully claimed.")
                
            raise ValueError("Claim failed due to concurrency or stock conditions.")
            
        print(f"[Atomic Ingest Fallback] Coupon claimed successfully for user '{user_id}'.")
        return True
