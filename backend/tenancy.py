import os
import threading
import hashlib
import base64
from typing import Any, Dict, List, Optional
from cryptography.fernet import Fernet

# Thread-local storage to maintain active tenant context
_tenant_context = threading.local()

_global_default_tenant = "default_tenant"

def set_global_default_tenant(tenant_id: str):
    """Sets the global fallback tenant ID."""
    global _global_default_tenant
    _global_default_tenant = tenant_id

def get_global_default_tenant() -> str:
    """Gets the global fallback tenant ID."""
    return _global_default_tenant

def set_current_tenant_id(tenant_id: str):
    """Sets the active tenant ID for the current execution thread."""
    _tenant_context.tenant_id = tenant_id

def get_current_tenant_id() -> str:
    """Gets the active tenant ID. Defaults to global_default_tenant if not set."""
    return getattr(_tenant_context, "tenant_id", _global_default_tenant)


# CRYPTOGRAPHIC CLIENT-SIDE FIELD-LEVEL ENCRYPTION (CSFLE) FALLBACK
SENSITIVE_FIELDS = {"margin", "wholesalePrice", "customerEmail"}

def get_tenant_encryption_key(tenant_id: str) -> bytes:
    """
    Derives a deterministic 32-byte key for symmetric encryption (Fernet)
    using the tenant ID combined with a master secret key.
    """
    master_secret = os.getenv("MASTER_ENCRYPTION_SECRET", "master-secret-key-placeholder-32bytes-long!")
    # Produce a 32-byte hash block
    derived = hashlib.sha256(f"{tenant_id}:{master_secret}".encode("utf-8")).digest()
    return base64.urlsafe_b64encode(derived)

def encrypt_value(tenant_id: str, value: Any) -> Any:
    """Encrypts a value and prepends type metadata for strict reconstruction."""
    if value is None:
        return None
    # Don't re-encrypt already encrypted string structure
    if isinstance(value, str) and value.startswith("enc:"):
        return value
        
    if isinstance(value, int):
        payload = f"int:{value}"
    elif isinstance(value, float):
        payload = f"float:{value}"
    else:
        payload = f"str:{value}"
        
    key = get_tenant_encryption_key(tenant_id)
    f = Fernet(key)
    encrypted_bytes = f.encrypt(payload.encode("utf-8"))
    return "enc:" + encrypted_bytes.decode("utf-8")

def decrypt_value(tenant_id: str, value: Any) -> Any:
    """Decrypts an encrypted value and reconstructs its native python type."""
    if not isinstance(value, str) or not value.startswith("enc:"):
        return value
    try:
        encrypted_str = value[4:]  # Strip "enc:" prefix
        key = get_tenant_encryption_key(tenant_id)
        f = Fernet(key)
        decrypted_str = f.decrypt(encrypted_str.encode("utf-8")).decode("utf-8")
        if ":" in decrypted_str:
            type_prefix, val = decrypted_str.split(":", 1)
            if type_prefix == "int":
                return int(val)
            elif type_prefix == "float":
                return float(val)
            elif type_prefix == "str":
                return val
        return decrypted_str
    except Exception as e:
        # Decryption failed (e.g. key mismatch or corruption), return as-is
        print(f"[Tenancy Encryption] Decryption failed for tenant {tenant_id}: {e}")
        return value


# DATABASE WRAPPER CLASSES FOR AUTOMATIC TENANT ISOLATION
class TenantedCollection:
    def __init__(self, raw_collection):
        self._collection = raw_collection

    def _inject_tenant(self, filter_dict: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Ensures that the current tenant ID is injected into the query filter."""
        if filter_dict is None:
            filter_dict = {}
        new_filter = dict(filter_dict)
        new_filter["tenantId"] = get_current_tenant_id()
        return new_filter

    def _encrypt_doc(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        """Encrypts sensitive fields inside a document before DB ingestion."""
        if not doc:
            return doc
        tenant_id = get_current_tenant_id()
        new_doc = dict(doc)
        new_doc["tenantId"] = tenant_id
        for key in SENSITIVE_FIELDS:
            if key in new_doc:
                new_doc[key] = encrypt_value(tenant_id, new_doc[key])
        return new_doc

    def _decrypt_doc(self, doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Decrypts sensitive fields inside a document after DB retrieval."""
        if not doc:
            return doc
        tenant_id = doc.get("tenantId", get_current_tenant_id())
        new_doc = dict(doc)
        for key in SENSITIVE_FIELDS:
            if key in new_doc:
                new_doc[key] = decrypt_value(tenant_id, new_doc[key])
        return new_doc

    def find(self, filter=None, *args, **kwargs):
        filter = self._inject_tenant(filter)
        cursor = self._collection.find(filter, *args, **kwargs)
        # Wrap cursor to decrypt documents on iteration
        for doc in cursor:
            yield self._decrypt_doc(doc)

    def find_one(self, filter=None, *args, **kwargs):
        filter = self._inject_tenant(filter)
        doc = self._collection.find_one(filter, *args, **kwargs)
        return self._decrypt_doc(doc)

    def insert_one(self, document, *args, **kwargs):
        encrypted_doc = self._encrypt_doc(document)
        return self._collection.insert_one(encrypted_doc, *args, **kwargs)

    def insert_many(self, documents, *args, **kwargs):
        encrypted_docs = [self._encrypt_doc(doc) for doc in documents]
        return self._collection.insert_many(encrypted_docs, *args, **kwargs)

    def update_one(self, filter, update, *args, **kwargs):
        filter = self._inject_tenant(filter)
        # Encrypt set values in the update statement if modifying sensitive fields
        if "$set" in update:
            tenant_id = get_current_tenant_id()
            new_set = dict(update["$set"])
            for key in SENSITIVE_FIELDS:
                if key in new_set:
                    new_set[key] = encrypt_value(tenant_id, new_set[key])
            update = dict(update)
            update["$set"] = new_set
        return self._collection.update_one(filter, update, *args, **kwargs)

    def update_many(self, filter, update, *args, **kwargs):
        filter = self._inject_tenant(filter)
        if "$set" in update:
            tenant_id = get_current_tenant_id()
            new_set = dict(update["$set"])
            for key in SENSITIVE_FIELDS:
                if key in new_set:
                    new_set[key] = encrypt_value(tenant_id, new_set[key])
            update = dict(update)
            update["$set"] = new_set
        return self._collection.update_many(filter, update, *args, **kwargs)

    def delete_one(self, filter, *args, **kwargs):
        filter = self._inject_tenant(filter)
        return self._collection.delete_one(filter, *args, **kwargs)

    def delete_many(self, filter, *args, **kwargs):
        filter = self._inject_tenant(filter)
        return self._collection.delete_many(filter, *args, **kwargs)

    def aggregate(self, pipeline, *args, **kwargs):
        # Enforce tenant isolation in pipelines by prepending a $match stage
        match_stage = {"$match": {"tenantId": get_current_tenant_id()}}
        new_pipeline = [match_stage] + list(pipeline)
        cursor = self._collection.aggregate(new_pipeline, *args, **kwargs)
        for doc in cursor:
            yield self._decrypt_doc(doc)

    def count_documents(self, filter, *args, **kwargs):
        filter = self._inject_tenant(filter)
        return self._collection.count_documents(filter, *args, **kwargs)

    def find_one_and_update(self, filter, update, *args, **kwargs):
        filter = self._inject_tenant(filter)
        if "$set" in update:
            tenant_id = get_current_tenant_id()
            new_set = dict(update["$set"])
            for key in SENSITIVE_FIELDS:
                if key in new_set:
                    new_set[key] = encrypt_value(tenant_id, new_set[key])
            update = dict(update)
            update["$set"] = new_set
        doc = self._collection.find_one_and_update(filter, update, *args, **kwargs)
        return self._decrypt_doc(doc)

    def __getattr__(self, name):
        return getattr(self._collection, name)


class TenantedDatabase:
    def __init__(self, raw_database):
        self._database = raw_database
        self._collections = {}

    def __getattr__(self, name: str) -> TenantedCollection:
        if name.startswith("_"):
            return getattr(self._database, name)
        if name not in self._collections:
            self._collections[name] = TenantedCollection(self._database[name])
        return self._collections[name]

    def __getitem__(self, name: str) -> TenantedCollection:
        return self.__getattr__(name)

    def list_collection_names(self, *args, **kwargs):
        return self._database.list_collection_names(*args, **kwargs)

    def command(self, *args, **kwargs):
        return self._database.command(*args, **kwargs)

    def create_collection(self, name, *args, **kwargs):
        return self._database.create_collection(name, *args, **kwargs)
