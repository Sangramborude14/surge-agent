"use client";

import { useState, useEffect, useRef, useMemo } from "react";

// Types matching backend models
interface Store {
  _id?: string;
  name: string;
  location: {
    type: string;
    coordinates: [number, number];
  };
  item: string;
  current_stock: number;
  target_stock: number;
  wholesalePrice?: number;
  category?: string;
  brand?: string;
  sales?: number;
}

interface Promotion {
  id: string;
  store_name: string;
  item: string;
  discount_code: string;
  message: string;
  duration_minutes: number;
  timestamp: string;
}

interface LogEntry {
  timestamp: string;
  message: string;
}

const API_BASE = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:8000"
  : (process.env.NEXT_PUBLIC_API_URL || "https://surge-agent.onrender.com");

const parseTimestamp = (ts: string) => {
  if (ts && ts.includes("T") && !/[Zz]|[+-]\d{2}(?::?\d{2})?$/.test(ts)) {
    return ts + "Z";
  }
  return ts;
};

// Mock data for offline mode
const INITIAL_MOCK_STORES: Store[] = [
  // WORLD CUP ATHLETICS (Zone A)
  {
    name: "World Cup Athletics",
    location: { type: "Point", coordinates: [121.501, 31.240] },
    item: "World Cup Jersey",
    current_stock: 150,
    target_stock: 20,
    wholesalePrice: 45.0,
    category: "Apparel",
    brand: "Adidas",
    sales: 120
  },
  {
    name: "World Cup Athletics",
    location: { type: "Point", coordinates: [121.501, 31.240] },
    item: "Retro Germany Jersey",
    current_stock: 110,
    target_stock: 15,
    wholesalePrice: 40.0,
    category: "Apparel",
    brand: "Adidas",
    sales: 85
  },
  {
    name: "World Cup Athletics",
    location: { type: "Point", coordinates: [121.501, 31.240] },
    item: "Running Sneakers",
    current_stock: 90,
    target_stock: 20,
    wholesalePrice: 60.0,
    category: "Apparel",
    brand: "Nike",
    sales: 40
  },

  // FAN ZONE GOODS (Zone A)
  {
    name: "Fan Zone Goods",
    location: { type: "Point", coordinates: [121.502, 31.241] },
    item: "Mascot Cap",
    current_stock: 80,
    target_stock: 10,
    wholesalePrice: 12.0,
    category: "Accessories",
    brand: "Puma",
    sales: 45
  },
  {
    name: "Fan Zone Goods",
    location: { type: "Point", coordinates: [121.502, 31.241] },
    item: "Mascot Plush Toy",
    current_stock: 75,
    target_stock: 12,
    wholesalePrice: 10.0,
    category: "Accessories",
    brand: "Puma",
    sales: 15
  },
  {
    name: "Fan Zone Goods",
    location: { type: "Point", coordinates: [121.502, 31.241] },
    item: "Team Scarf",
    current_stock: 120,
    target_stock: 25,
    wholesalePrice: 15.0,
    category: "Accessories",
    brand: "Nike",
    sales: 95
  },

  // CHAMPIONS SOUVENIRS (Zone B)
  {
    name: "Champions Souvenirs",
    location: { type: "Point", coordinates: [121.515, 31.245] },
    item: "Tournament Soccer Ball",
    current_stock: 120,
    target_stock: 30,
    wholesalePrice: 18.0,
    category: "Equipment",
    brand: "Adidas",
    sales: 70
  },
  {
    name: "Champions Souvenirs",
    location: { type: "Point", coordinates: [121.515, 31.245] },
    item: "Futsal Ball",
    current_stock: 80,
    target_stock: 15,
    wholesalePrice: 22.0,
    category: "Equipment",
    brand: "Adidas",
    sales: 30
  },
  {
    name: "Champions Souvenirs",
    location: { type: "Point", coordinates: [121.515, 31.245] },
    item: "Goalkeeper Gloves",
    current_stock: 65,
    target_stock: 10,
    wholesalePrice: 25.0,
    category: "Equipment",
    brand: "Puma",
    sales: 12
  },

  // STADIUM SNACKS & GEAR (Zone B)
  {
    name: "Stadium Snacks & Gear",
    location: { type: "Point", coordinates: [121.516, 31.246] },
    item: "Reusable Water Bottle",
    current_stock: 60,
    target_stock: 15,
    wholesalePrice: 4.5,
    category: "Refreshments",
    brand: "Nike",
    sales: 35
  },
  {
    name: "Stadium Snacks & Gear",
    location: { type: "Point", coordinates: [121.516, 31.246] },
    item: "Isotonic Energy Drink",
    current_stock: 200,
    target_stock: 40,
    wholesalePrice: 3.0,
    category: "Refreshments",
    brand: "Coca-Cola",
    sales: 250
  },
  {
    name: "Stadium Snacks & Gear",
    location: { type: "Point", coordinates: [121.516, 31.246] },
    item: "Organic Protein Yogurt",
    current_stock: 50,
    target_stock: 10,
    wholesalePrice: 5.0,
    category: "Refreshments",
    brand: "Under Armour",
    sales: 8
  }
];

export default function Home() {
  // Application State
  const [stores, setStores] = useState<Store[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [backendOnline, setBackendOnline] = useState<boolean>(true);
  
  // Simulation State
  const [activeZone, setActiveZone] = useState<"A" | "B" | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [lastScanCoords, setLastScanCoords] = useState<[number, number] | null>(null);
  const [tick, setTick] = useState<number>(0);
  const [logFilter, setLogFilter] = useState<string>("");
  const [systemTime, setSystemTime] = useState<string>("");

  // New Tab & Simulator States
  const [activeTab, setActiveTab] = useState<'operations' | 'shopping' | 'merchant'>('operations');
  const [searchZoneA, setSearchZoneA] = useState<string>("");
  const [searchZoneB, setSearchZoneB] = useState<string>("");
  const [searchFilterA, setSearchFilterA] = useState<string>("");
  const [searchFilterB, setSearchFilterB] = useState<string>("");
  const [rmnProductsA, setRmnProductsA] = useState<any[]>([]);
  const [rmnProductsB, setRmnProductsB] = useState<any[]>([]);
  const [rmnSponsoredA, setRmnSponsoredA] = useState<any>(null);
  const [rmnSponsoredB, setRmnSponsoredB] = useState<any>(null);
  const [sentimentResultA, setSentimentResultA] = useState<any>(null);
  const [sentimentResultB, setSentimentResultB] = useState<any>(null);
  const [isSearchingA, setIsSearchingA] = useState<boolean>(false);
  const [isSearchingB, setIsSearchingB] = useState<boolean>(false);

  // Advanced NEX-RMN state hooks
  const [rmnLedgerA, setRmnLedgerA] = useState<any[]>([]);
  const [rmnLedgerB, setRmnLedgerB] = useState<any[]>([]);
  const [rmnMultiplierA, setRmnMultiplierA] = useState<number>(1.0);
  const [rmnMultiplierB, setRmnMultiplierB] = useState<number>(1.0);
  const [rmnVisitorsA, setRmnVisitorsA] = useState<number>(0);
  const [rmnVisitorsB, setRmnVisitorsB] = useState<number>(0);

  // Merchant Portal states
  const [merchantTenant, setMerchantTenant] = useState<string>("nike_official");
  const [merchantCampaigns, setMerchantCampaigns] = useState<any[]>([]);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [editMaxBid, setEditMaxBid] = useState<number>(0);
  const [editDailyBudget, setEditDailyBudget] = useState<number>(0);
  const [editHeadline, setEditHeadline] = useState<string>("");
  const [editBody, setEditBody] = useState<string>("");
  const [editStatus, setEditStatus] = useState<string>("ELIGIBLE");
  const [editZones, setEditZones] = useState<string>("");
  const [editKeywords, setEditKeywords] = useState<string>("");

  // Joint Campaign Creation states
  const [jointCampaignId, setJointCampaignId] = useState<string>("");
  const [jointPartners, setJointPartners] = useState<string[]>([]);
  const [jointMaxBid, setJointMaxBid] = useState<number>(1.5);
  const [jointDailyBudget, setJointDailyBudget] = useState<number>(500);
  const [jointHeadline, setJointHeadline] = useState<string>("");
  const [jointBody, setJointBody] = useState<string>("");
  const [jointZones, setJointZones] = useState<string>("Zone_A");
  const [jointKeywords, setJointKeywords] = useState<string>("");

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // local mock DB for offline fallback
  const mockStoresRef = useRef<Store[]>(JSON.parse(JSON.stringify(INITIAL_MOCK_STORES)));
  const mockPromotionsRef = useRef<Promotion[]>([]);
  const mockLogsRef = useRef<LogEntry[]>([
    {
      timestamp: new Date().toISOString(),
      message: "SYSTEM INIT: Sleek dashboard initialized. Ready for simulation scans."
    }
  ]);

  // Update clock
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
      setSystemTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Scroll terminal
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Main Fetch Loop
  useEffect(() => {
    let active = true;

    async function syncData() {
      try {
        const resStores = await fetch(`${API_BASE}/api/stores`);
        if (!resStores.ok) throw new Error("Stores API failed");
        const storesData = await resStores.json();

        const resPromos = await fetch(`${API_BASE}/api/promotions`);
        if (!resPromos.ok) throw new Error("Promotions API failed");
        const promosData = await resPromos.json();

        const resLogs = await fetch(`${API_BASE}/api/logs`);
        if (!resLogs.ok) throw new Error("Logs API failed");
        const logsData = await resLogs.json();

        if (active) {
          setStores(storesData);
          setPromotions(promosData);
          setLogs(logsData);
          setBackendOnline(true);
        }
      } catch (err) {
        if (active) {
          setBackendOnline(false);
          setStores([...mockStoresRef.current]);
          
          const now = Date.now();
          const filteredPromos = mockPromotionsRef.current.filter(promo => {
            const start = new Date(parseTimestamp(promo.timestamp)).getTime();
            const durationMs = promo.duration_minutes * 60 * 1000;
            return now - start < durationMs;
          });
          mockPromotionsRef.current = filteredPromos;
          setPromotions(filteredPromos);
          setLogs([...mockLogsRef.current]);
        }
      }
    }

    syncData();
    const interval = setInterval(syncData, 2000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [tick]);

  // NEX-RMN Sync Loop
  useEffect(() => {
    if (activeTab !== 'shopping' || !backendOnline) return;

    let active = true;
    async function syncRmnData() {
      try {
        const queryA = searchFilterA;
        const queryB = searchFilterB;
        
        const resA = await fetch(`${API_BASE}/api/rmn/products?zoneId=Zone_A&query=${encodeURIComponent(queryA)}`);
        const dataA = resA.ok ? await resA.json() : null;
        
        const resB = await fetch(`${API_BASE}/api/rmn/products?zoneId=Zone_B&query=${encodeURIComponent(queryB)}`);
        const dataB = resB.ok ? await resB.json() : null;
        
        if (active) {
          if (dataA) {
            setRmnProductsA(dataA.products || []);
            setRmnSponsoredA(dataA.sponsored || null);
            setRmnLedgerA(dataA.ledger || []);
            setRmnMultiplierA(dataA.trafficMultiplier || 1.0);
            setRmnVisitorsA(dataA.zoneVisitors || 0);
          }
          if (dataB) {
            setRmnProductsB(dataB.products || []);
            setRmnSponsoredB(dataB.sponsored || null);
            setRmnLedgerB(dataB.ledger || []);
            setRmnMultiplierB(dataB.trafficMultiplier || 1.0);
            setRmnVisitorsB(dataB.zoneVisitors || 0);
          }
          if (dataA?.logs) {
            setLogs(dataA.logs);
          }
        }
      } catch (err) {
        console.error("RMN sync failed:", err);
      }
    }

    syncRmnData();
    const interval = setInterval(syncRmnData, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeTab, searchFilterA, searchFilterB, backendOnline]);

  // Merchant Campaigns Sync Loop
  useEffect(() => {
    if (activeTab !== 'merchant' || !backendOnline) return;

    let active = true;
    const fetchCampaigns = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/rmn/campaigns?tenantId=${merchantTenant}`);
        if (res.ok && active) {
          const data = await res.json();
          setMerchantCampaigns(data);
        }
      } catch (err) {
        console.error("Failed to sync merchant campaigns:", err);
      }
    };

    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeTab, merchantTenant, backendOnline]);

  // Trigger surge simulation
  const handleSimulateSurge = async (zone: "A" | "B") => {
    if (isSimulating) return;
    
    setIsSimulating(true);
    setActiveZone(zone);
    const coords: [number, number] = zone === "A" ? [121.501, 31.240] : [121.515, 31.245];
    setLastScanCoords(coords);

    const addLocalLog = (msg: string) => {
      const entry = { timestamp: new Date().toISOString(), message: msg };
      mockLogsRef.current.push(entry);
      if (mockLogsRef.current.length > 200) mockLogsRef.current.shift();
      setLogs([...mockLogsRef.current]);
    };

    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/surge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coordinates: coords,
            radius_meters: 500.0
          })
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        
        const data = await response.json();
        setPromotions(data.triggered_promotions);
        setLogs(data.logs);
      } catch (err: any) {
        console.error("Failed to post surge event:", err);
        addLocalLog(`[ERROR] Direct surge POST failed: ${err.message}. Reverting to local simulation.`);
      }
    } else {
      // Execute offline simulation behavior
      addLocalLog(`[SURGE_REQ] Manual surge triggered for Zone ${zone} at [${coords[0]}, ${coords[1]}]`);
      addLocalLog(`[GEOSPATIAL] Geospatial Query: searching within 500m of [${coords[0]}, ${coords[1]}]`);

      const matchingStores = mockStoresRef.current.filter(store => {
        if (zone === "A") {
          return store.name === "World Cup Athletics" || store.name === "Fan Zone Goods";
        } else {
          return store.name === "Champions Souvenirs" || store.name === "Stadium Snacks & Gear";
        }
      });

      addLocalLog(`[GEOSPATIAL] Geospatial Query: found ${matchingStores.length} stores inside boundaries`);

      let mockPromoAdded = false;

      matchingStores.forEach(store => {
        if (store.current_stock > store.target_stock) {
          addLocalLog(`[INVENTORY] Store '${store.name}' surplus detected: stock=${store.current_stock}, target=${store.target_stock}`);
          
          const discount = [15, 20, 25, 30, 40, 50][Math.floor(Math.random() * 6)];
          const cleanName = store.name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
          const discountCode = `MOCK-SURGE-${discount}-${cleanName.substring(0, 4)}`;
          const promoMsg = `⚡ FLASH SALE: Take ${discount}% OFF all '${store.item}' at ${store.name}! Limited stock!`;
          const duration = 15;
          
          addLocalLog(`[AGENT] Invoke agent: Generating promotion for ${store.name}...`);
          addLocalLog(`[AGENT] Promotion generated in 0.4281s: code=${discountCode}`);

          const dec = Math.floor(Math.random() * 6) + 5;
          const oldStock = store.current_stock;
          store.current_stock = Math.max(0, store.current_stock - dec);
          
          addLocalLog(`[ACTION] Stock decremented for '${store.name}': ${oldStock} -> ${store.current_stock} (-${dec})`);

          const newPromo: Promotion = {
            id: Math.random().toString(36).substring(2, 9),
            store_name: store.name,
            item: store.item,
            discount_code: discountCode,
            message: promoMsg,
            duration_minutes: duration,
            timestamp: new Date().toISOString()
          };

          mockPromotionsRef.current.push(newPromo);
          mockPromoAdded = true;
        } else {
          addLocalLog(`[INVENTORY] Store '${store.name}' has no surplus. Stock levels within safe targets.`);
        }
      });

      if (mockPromoAdded) {
        setPromotions([...mockPromotionsRef.current]);
      }
    }

    setTimeout(() => {
      setIsSimulating(false);
      setActiveZone(null);
    }, 3500);
  };

  // Re-seed DB
  const handleSeedDB = async () => {
    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/seed`, {
          method: "POST"
        });
        if (response.ok) {
          const resStores = await fetch(`${API_BASE}/api/stores`);
          const storesData = await resStores.json();
          setStores(storesData);
        }
      } catch (err) {
        console.error("Failed to seed database:", err);
      }
    } else {
      mockStoresRef.current = JSON.parse(JSON.stringify(INITIAL_MOCK_STORES));
      mockPromotionsRef.current = [];
      mockLogsRef.current.push({
        timestamp: new Date().toISOString(),
        message: "[SYSTEM] Mock Database successfully re-seeded and active promotions cleared."
      });
      setStores([...mockStoresRef.current]);
      setPromotions([]);
      setLogs([...mockLogsRef.current]);
    }
  };

  const getBaseDiscount = (storeName: string) => {
    const promo = promotions.find(p => p.store_name.toLowerCase() === storeName.toLowerCase());
    if (!promo) return 0;
    const match = promo.discount_code.match(/SURGE(\d+)/i);
    return match ? parseInt(match[1]) : 10;
  };

  const getCalculatedDiscount = (storeName: string, itemName: string, zone: "A" | "B") => {
    const baseDiscount = getBaseDiscount(storeName);
    const query = zone === "A" ? searchZoneA : searchZoneB;
    const sentimentResult = zone === "A" ? sentimentResultA : sentimentResultB;
    
    let keywordBoost = 0;
    if (query.trim().length >= 2 && itemName.toLowerCase().includes(query.trim().toLowerCase())) {
      keywordBoost = 10;
    }
    
    let sentimentBoost = 0;
    if (sentimentResult) {
      const msg = sentimentResult.empatheticMessage.toLowerCase();
      const q = query.toLowerCase();
      
      if (itemName.toLowerCase().includes("jersey") || itemName.toLowerCase().includes("cap")) {
        if (q.includes("fan") || q.includes("match") || q.includes("wear") || q.includes("shirt") || msg.includes("jersey") || msg.includes("apparel") || msg.includes("athletics")) {
          sentimentBoost = 15;
        }
      }
      if (itemName.toLowerCase().includes("ball") || itemName.toLowerCase().includes("toy") || itemName.toLowerCase().includes("game")) {
        if (q.includes("kid") || q.includes("child") || q.includes("cry") || msg.includes("kids") || msg.includes("crying") || msg.includes("play")) {
          sentimentBoost = 15;
        }
      }
      if (itemName.toLowerCase().includes("bottle") || itemName.toLowerCase().includes("water") || itemName.toLowerCase().includes("snack") || itemName.toLowerCase().includes("fan") || itemName.toLowerCase().includes("yogurt")) {
        if (q.includes("hot") || q.includes("heat") || q.includes("sun") || q.includes("thirsty") || msg.includes("heat") || msg.includes("hot") || msg.includes("cool")) {
          sentimentBoost = 15;
        }
      }
    }

    let leastSalesBoost = 0;
    const currentStoresList = stores.length > 0 ? stores : INITIAL_MOCK_STORES;
    const currentStoreItem = currentStoresList.find(s => s.name === storeName && s.item === itemName);
    if (currentStoreItem && query.trim().length >= 2) {
      const q = query.trim().toLowerCase();
      const isSearchMatch = 
        currentStoreItem.item.toLowerCase().includes(q) ||
        currentStoreItem.name.toLowerCase().includes(q) ||
        (currentStoreItem.category && currentStoreItem.category.toLowerCase().includes(q)) ||
        (currentStoreItem.brand && currentStoreItem.brand.toLowerCase().includes(q));
      
      if (isSearchMatch) {
        const siblings = currentStoresList.filter(s => 
          (currentStoreItem.category && s.category === currentStoreItem.category) ||
          (currentStoreItem.brand && s.brand === currentStoreItem.brand)
        );
        if (siblings.length > 0) {
          const minSales = Math.min(...siblings.map(s => s.sales ?? 0));
          if ((currentStoreItem.sales ?? 0) === minSales) {
            leastSalesBoost = 15;
          }
        }
      }
    }
    
    return {
      base: baseDiscount,
      keywordBoost,
      sentimentBoost,
      leastSalesBoost,
      total: Math.min(90, baseDiscount + keywordBoost + sentimentBoost + leastSalesBoost)
    };
  };

  const filterStoreByQuery = (store: Store, query: string) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const itemName = store.item || "";
    const name = store.name || "";
    const category = store.category || "";
    const brand = store.brand || "";
    return itemName.toLowerCase().includes(q) || name.toLowerCase().includes(q) || category.toLowerCase().includes(q) || brand.toLowerCase().includes(q);
  };

  const handleSearchSentiment = async (zone: "A" | "B") => {
    const query = zone === "A" ? searchZoneA : searchZoneB;
    if (!query.trim()) return;

    if (zone === "A") {
      setIsSearchingA(true);
      setSentimentResultA(null);
    } else {
      setIsSearchingB(true);
      setSentimentResultB(null);
    }

    const coords = zone === "A" ? [121.501, 31.240] : [121.515, 31.245];

    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/nexus/sentiment-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queryText: query,
            location: coords
          })
        });
        if (response.ok) {
          const data = await response.json();
          if (zone === "A") {
            setSentimentResultA(data);
          } else {
            setSentimentResultB(data);
          }
          const msg = `[SENTIMENT] Search resolved user mood to zone '${data.zoneName}'. Campaign: '${data.offer.title}'`;
          setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: msg }]);
        } else {
          throw new Error("Sentiment search failed");
        }
      } catch (err: any) {
        console.error("Sentiment search error:", err);
      } finally {
        if (zone === "A") {
          setIsSearchingA(false);
        } else {
          setIsSearchingB(false);
        }
      }
    } else {
      setTimeout(() => {
        const mockResult = {
          zoneName: zone === "A" ? "Zone A // West Wing" : "Zone B // East Wing",
          empatheticMessage: query.toLowerCase().includes("hot") || query.toLowerCase().includes("tired")
            ? "We see you are feeling hot and exhausted. Take a breather! Enjoy our cooling specials at a discounted price near you."
            : "We matched your request! Enjoy this custom localized promotion designed just for your visit today.",
          offer: {
            title: "👪 Cool Play Family Bundle",
            description: "Special dynamic mock discount applied to your matches!"
          }
        };
        if (zone === "A") {
          setSentimentResultA(mockResult);
          setIsSearchingA(false);
        } else {
          setSentimentResultB(mockResult);
          setIsSearchingB(false);
        }
      }, 500);
    }
  };

  const fetchRmnZoneData = async (zone: "Zone_A" | "Zone_B", query = "") => {
    try {
      const response = await fetch(`${API_BASE}/api/rmn/products?zoneId=${zone}&query=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = await response.json();
        if (zone === "Zone_A") {
          setRmnProductsA(data.products || []);
          setRmnSponsoredA(data.sponsored || null);
        } else {
          setRmnProductsB(data.products || []);
          setRmnSponsoredB(data.sponsored || null);
        }
        if (data.logs) {
          setLogs(data.logs);
        }
      }
    } catch (err) {
      console.error(`Error fetching RMN products for ${zone}:`, err);
    }
  };

  const handleRmnSearch = async (zone: "Zone_A" | "Zone_B") => {
    const query = zone === "Zone_A" ? searchZoneA : searchZoneB;
    if (zone === "Zone_A") {
      setSearchFilterA(query);
    } else {
      setSearchFilterB(query);
    }
    
    const lowerQuery = query.toLowerCase();
    let mpn = "";
    if (lowerQuery.includes("poncho")) {
      mpn = "US-PONCHO-01";
    } else if (lowerQuery.includes("jersey")) {
      mpn = "US-JER-2026";
    } else if (lowerQuery.includes("mascot") || lowerQuery.includes("toy") || lowerQuery.includes("plush")) {
      mpn = "FIFA-MASCOT";
    } else if (lowerQuery.includes("brew") || lowerQuery.includes("coffee") || lowerQuery.includes("cold")) {
      mpn = "SBX-COLDBREW";
    } else if (lowerQuery.includes("red") || lowerQuery.includes("bull") || lowerQuery.includes("energy")) {
      mpn = "RED-BULL-01";
    }
    
    if (mpn) {
      try {
        await fetch(`${API_BASE}/api/rmn/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "search",
            zoneId: zone,
            targetItemMpn: mpn,
            weight: 10
          })
        });
        
        await fetch(`${API_BASE}/api/rmn/flush`, { method: "POST" });
      } catch (err) {
        console.error("Error logging search event:", err);
      }
    }
    
    await fetchRmnZoneData(zone, query);
  };

  const handleRmnBuy = async (zone: "Zone_A" | "Zone_B", mpn: string) => {
    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/rmn/purchase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zoneId: zone,
            targetItemMpn: mpn,
            quantity: 1
          })
        });
        if (response.ok) {
          const res = await response.json();
          await fetch(`${API_BASE}/api/rmn/flush`, { method: "POST" });
          
          await fetchRmnZoneData("Zone_A", searchFilterA);
          await fetchRmnZoneData("Zone_B", searchFilterB);
          
          const msg = `[RMN Purchase] Bought item with MPN '${mpn}' in '${zone}'. Dynamic stock updated.`;
          setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: msg }]);
        } else {
          const errData = await response.json();
          alert(`Purchase failed: ${errData.detail}`);
        }
      } catch (err: any) {
        console.error("RMN Purchase error:", err);
      }
    } else {
      alert("Offline demo mode for RMN requires active API connection.");
    }
  };

  const handleRmnClick = async (campaignId: string) => {
    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/rmn/click`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId })
        });
        if (response.ok) {
          const msg = `[RMN Click] Programmatic click registered for campaign '${campaignId}'`;
          setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: msg }]);
        }
      } catch (err) {
        console.error("Failed to register RMN click:", err);
      }
    }
  };

  const startEditingCampaign = (camp: any) => {
    setEditingCampaignId(camp.campaignId);
    setEditMaxBid(camp.maxBidPerClick);
    setEditDailyBudget(camp.dailyBudget);
    setEditHeadline(camp.creativeAsset.headline);
    setEditBody(camp.creativeAsset.body);
    setEditStatus(camp.status || "ELIGIBLE");
    setEditZones((camp.targetingCriteria.targetZones || []).join(", "));
    setEditKeywords((camp.targetingCriteria.audienceContextVectors || []).join(", "));
  };

  const handleCampaignUpdate = async (campaignId: string) => {
    if (backendOnline) {
      try {
        const payload = {
          campaignId,
          maxBidPerClick: editMaxBid,
          dailyBudget: editDailyBudget,
          targetingCriteria: {
            targetZones: editZones.split(",").map(z => z.trim()),
            audienceContextVectors: editKeywords.split(",").map(k => k.trim())
          },
          creativeAsset: {
            headline: editHeadline,
            body: editBody
          },
          status: editStatus
        };
        const response = await fetch(`${API_BASE}/api/rmn/campaigns/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          setEditingCampaignId(null);
          const msg = `[RMN Merchant] Campaign '${campaignId}' parameters updated successfully.`;
          setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: msg }]);
          // Refresh
          const res = await fetch(`${API_BASE}/api/rmn/campaigns?tenantId=${merchantTenant}`);
          if (res.ok) {
            const data = await res.json();
            setMerchantCampaigns(data);
          }
        } else {
          const errData = await response.json();
          alert(`Failed to update campaign: ${errData.detail}`);
        }
      } catch (err) {
        console.error("Failed to update campaign:", err);
      }
    }
  };

  const handleCreateJointCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jointCampaignId || jointPartners.length < 2 || !jointHeadline || !jointBody) {
      alert("Please fill in all joint campaign fields and select at least 2 partner tenants.");
      return;
    }
    if (backendOnline) {
      try {
        const payload = {
          campaignId: jointCampaignId,
          partnerTenants: jointPartners,
          maxBidPerClick: jointMaxBid,
          dailyBudget: jointDailyBudget,
          targetingCriteria: {
            targetZones: jointZones.split(",").map(z => z.trim()),
            audienceContextVectors: jointKeywords.split(",").map(k => k.trim())
          },
          creativeAsset: {
            headline: jointHeadline,
            body: jointBody
          }
        };
        const response = await fetch(`${API_BASE}/api/rmn/campaigns/create-joint`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (response.ok) {
          setJointCampaignId("");
          setJointHeadline("");
          setJointBody("");
          setJointKeywords("");
          setJointPartners([]);
          const msg = `[RMN Merchant] Joint Co-Opetition campaign '${payload.campaignId}' created successfully between ${payload.partnerTenants.join(" & ")}.`;
          setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: msg }]);
          // Refresh
          const res = await fetch(`${API_BASE}/api/rmn/campaigns?tenantId=${merchantTenant}`);
          if (res.ok) {
            const data = await res.json();
            setMerchantCampaigns(data);
          }
        } else {
          const errData = await response.json();
          alert(`Failed to create joint campaign: ${errData.detail}`);
        }
      } catch (err) {
        console.error("Failed to create joint campaign:", err);
      }
    }
  };

  const handleRmnSimulateTraffic = async (zoneId: string, count: number) => {
    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/rmn/simulate-traffic`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zoneId, count })
        });
        if (response.ok) {
          const data = await response.json();
          if (zoneId.toLowerCase() === "zone_a") {
            setRmnVisitorsA(data.visitorCount);
          } else {
            setRmnVisitorsB(data.visitorCount);
          }
          // Immediately refresh products/auction
          await fetchRmnZoneData("Zone_A", searchFilterA);
          await fetchRmnZoneData("Zone_B", searchFilterB);
        }
      } catch (err) {
        console.error("Failed to simulate traffic:", err);
      }
    }
  };

  const handleBuyItem = async (storeName: string, itemName: string) => {
    if (backendOnline) {
      try {
        const response = await fetch(`${API_BASE}/api/purchase`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeName,
            itemName,
            quantity: 1
          })
        });
        if (response.ok) {
          const data = await response.json();
          setStores(data.stores);
          setPromotions(data.promotions);
          
          const msg = `[PURCHASE] 1x '${itemName}' bought from '${storeName}'. Database stock updated and discount readjusted.`;
          setLogs(prev => [...prev, { timestamp: new Date().toISOString(), message: msg }]);
        } else {
          const errData = await response.json();
          alert(`Purchase failed: ${errData.detail}`);
        }
      } catch (err: any) {
        console.error("Purchase error:", err);
      }
    } else {
      const updated = mockStoresRef.current.map(store => {
        if (store.name.toLowerCase() === storeName.toLowerCase()) {
          const new_stock = Math.max(0, store.current_stock - 1);
          const target = store.target_stock;
          const surplus = new_stock - target;
          
          mockPromotionsRef.current = mockPromotionsRef.current.map(promo => {
            if (promo.store_name.toLowerCase() === storeName.toLowerCase()) {
              if (surplus <= 0) {
                return null;
              } else {
                let discount = 10;
                if (surplus >= 100) discount = 50;
                else if (surplus >= 70) discount = 40;
                else if (surplus >= 40) discount = 30;
                else if (surplus >= 20) discount = 20;
                
                return {
                  ...promo,
                  discount_code: `SURGE${discount}_${storeName.replace(' ', '').slice(0, 5).toUpperCase()}`,
                  message: `Tourist Surge Alert! Get ${discount}% off on '${itemName}' at ${storeName}! Hurry, offer valid for a limited time.`
                };
              }
            }
            return promo;
          }).filter(Boolean) as Promotion[];
          
          setPromotions([...mockPromotionsRef.current]);
          
          return {
            ...store,
            current_stock: new_stock
          };
        }
        return store;
      });
      
      mockStoresRef.current = updated;
      setStores(updated);
      
      const msg = `[MOCK PURCHASE] 1x '${itemName}' bought from '${storeName}'. Local stock updated and discount readjusted.`;
      mockLogsRef.current.push({ timestamp: new Date().toISOString(), message: msg });
      setLogs([...mockLogsRef.current]);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter(l => l.message.toLowerCase().includes(q) || l.timestamp.includes(q));
  }, [logs, logFilter]);

  const renderLogLine = (log: LogEntry, index: number) => {
    let content = log.message;
    let badge = null;
    let badgeColor = "bg-zinc-800 text-zinc-400";

    const regex = /^\[([A-Z_]+)\]\s*(.*)$/;
    const match = content.match(regex);

    if (match) {
      const type = match[1];
      content = match[2];
      badge = type;

      switch (type) {
        case "SURGE_REQ":
          badgeColor = "bg-sky-950/60 text-sky-400 border border-sky-800/30";
          break;
        case "GEOSPATIAL":
          badgeColor = "bg-violet-950/60 text-violet-400 border border-violet-800/30";
          break;
        case "INVENTORY":
          badgeColor = "bg-amber-950/60 text-amber-400 border border-amber-800/30";
          break;
        case "AGENT":
          badgeColor = "bg-emerald-950/60 text-emerald-400 border border-emerald-800/30";
          break;
        case "ACTION":
          badgeColor = "bg-rose-950/60 text-rose-400 border border-rose-800/30";
          break;
        case "SYSTEM":
        case "ERROR":
          badgeColor = "bg-zinc-900 text-zinc-400 border border-zinc-700/30";
          break;
      }
    } else {
      if (content.includes("Surge Request:")) {
        badge = "SURGE_REQ";
        badgeColor = "bg-sky-950/60 text-sky-400 border border-sky-800/30";
      } else if (content.includes("Geospatial Query:")) {
        badge = "GEOSPATIAL";
        badgeColor = "bg-violet-950/60 text-violet-400 border border-violet-800/30";
      } else if (content.includes("surplus detected:")) {
        badge = "INVENTORY";
        badgeColor = "bg-amber-950/60 text-amber-400 border border-amber-800/30";
      } else if (content.includes("Agent promotion generated")) {
        badge = "AGENT";
        badgeColor = "bg-emerald-950/60 text-emerald-400 border border-emerald-800/30";
      } else if (content.includes("Stock decremented")) {
        badge = "ACTION";
        badgeColor = "bg-rose-950/60 text-rose-400 border border-rose-800/30";
      } else if (content.includes("Database") || content.includes("startup")) {
        badge = "SYSTEM";
        badgeColor = "bg-zinc-900 text-zinc-400 border border-zinc-800/50";
      }
    }

    const timeStr = new Date(parseTimestamp(log.timestamp)).toLocaleTimeString([], { hour12: false });

    return (
      <div key={index} className="py-1.5 border-b border-zinc-900/60 hover:bg-zinc-900/20 transition-colors flex items-start gap-2.5 text-[11px] font-mono leading-relaxed">
        <span className="text-zinc-500 shrink-0 select-none">{timeStr}</span>
        {badge && (
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 tracking-wider uppercase ${badgeColor}`}>
            {badge}
          </span>
        )}
        <span className="text-zinc-300 break-words flex-1">{content}</span>
      </div>
    );
  };

  const getStoreForPromo = (promo: Promotion) => {
    return stores.find(s => s.name.toLowerCase() === promo.store_name.toLowerCase());
  };

  const getRemainingSeconds = (promo: Promotion) => {
    const start = new Date(parseTimestamp(promo.timestamp)).getTime();
    const durationMs = promo.duration_minutes * 60 * 1000;
    const elapsed = Date.now() - start;
    return Math.max(0, Math.floor((durationMs - elapsed) / 1000));
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 overflow-hidden font-sans antialiased selection:bg-zinc-800 selection:text-white">
      
      {/* HEADER */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-900 bg-zinc-900/40 backdrop-blur-md px-6 py-4">
        <div>
          <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Tourist Surge retail agent
          </h1>
          <p className="text-[11px] text-zinc-500 mt-0.5 uppercase tracking-wider font-mono">
            World Cup 2026 // Real-time dispatcher
          </p>
        </div>

        {/* Dynamic Tab Switcher */}
        <div className="flex bg-zinc-950/60 p-1 rounded-md border border-zinc-900">
          <button 
            onClick={() => setActiveTab('operations')}
            className={`px-4 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer select-none ${
              activeTab === 'operations' 
                ? "bg-zinc-900/80 text-emerald-400 font-bold border border-zinc-800/40 shadow-sm" 
                : "text-zinc-500 hover:text-zinc-400"
            }`}
          >
            Operations
          </button>
          <button 
            onClick={() => setActiveTab('shopping')}
            className={`px-4 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer select-none ${
              activeTab === 'shopping' 
                ? "bg-zinc-900/80 text-emerald-400 font-bold border border-zinc-800/40 shadow-sm" 
                : "text-zinc-500 hover:text-zinc-400"
            }`}
          >
            Shopping Simulator
          </button>
          <button 
            onClick={() => setActiveTab('merchant')}
            className={`px-4 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer select-none ${
              activeTab === 'merchant' 
                ? "bg-zinc-900/80 text-emerald-400 font-bold border border-zinc-800/40 shadow-sm" 
                : "text-zinc-500 hover:text-zinc-400"
            }`}
          >
            Merchant Portal
          </button>
        </div>

        <div className="flex items-center space-x-3 font-mono text-[11px]">
          <div className={`flex items-center space-x-2 px-3 py-1 rounded border transition-colors ${
            backendOnline 
              ? "bg-zinc-900/60 border-emerald-500/20 text-emerald-400" 
              : "bg-zinc-900/60 border-amber-500/20 text-amber-400"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${backendOnline ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`} />
            <span>{backendOnline ? "API CONNECTED" : "OFFLINE DEMO EMULATION"}</span>
          </div>

          <div className="hidden sm:block px-3 py-1 border border-zinc-900 bg-zinc-900/30 rounded text-zinc-400">
            {systemTime || "00:00:00"}
          </div>
        </div>
      </header>

      {/* DASHBOARD GRID */}
      {activeTab === 'operations' && (
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-5 p-5 overflow-hidden">
          
          {/* LEFT COLUMN: MALL MAP & CONTROLS */}
          <section className="flex flex-col border border-zinc-900 bg-zinc-900/20 rounded-lg overflow-hidden relative">
            <div className="shrink-0 bg-zinc-900/40 border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Mall Map & Radar
              </h2>
              {isSimulating && (
                <span className="text-[10px] text-zinc-400 font-mono tracking-wider animate-pulse">
                  SCANNING...
                </span>
              )}
            </div>

            <div className="flex-1 p-5 flex flex-col justify-between overflow-y-auto">
              {/* Interactive Grid Map */}
              <div className="relative border border-zinc-900 rounded bg-zinc-950/40 p-2 flex items-center justify-center aspect-[4/3] max-h-[300px]">
                
                {/* Radar waves */}
                {isSimulating && activeZone === "A" && (
                  <div className="absolute left-[25%] top-[50%] -translate-x-1/2 -translate-y-1/2 w-40 h-40 pointer-events-none">
                    <div className="absolute inset-0 rounded-full border border-emerald-500/20 animate-[ping_1.6s_infinite]" />
                    <div className="absolute inset-8 rounded-full border border-emerald-500/10 animate-[ping_2s_infinite]" />
                  </div>
                )}

                {isSimulating && activeZone === "B" && (
                  <div className="absolute left-[75%] top-[55%] -translate-x-1/2 -translate-y-1/2 w-40 h-40 pointer-events-none">
                    <div className="absolute inset-0 rounded-full border border-emerald-500/20 animate-[ping_1.6s_infinite]" />
                    <div className="absolute inset-8 rounded-full border border-emerald-500/10 animate-[ping_2s_infinite]" />
                  </div>
                )}

                {/* Mall Layout SVG */}
                <svg className="w-full h-full text-zinc-700" viewBox="0 0 400 300">
                  <defs>
                    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(63, 63, 70, 0.15)" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="400" height="300" fill="url(#grid)" />

                  {/* Walkways */}
                  <rect x="20" y="120" width="360" height="60" rx="2" fill="rgba(24, 24, 27, 0.4)" stroke="#27272a" strokeWidth="0.5" />
                  <rect x="180" y="30" width="40" height="240" rx="2" fill="rgba(24, 24, 27, 0.4)" stroke="#27272a" strokeWidth="0.5" />

                  {/* ZONE A (West Wing) */}
                  <rect 
                    x="25" y="45" width="135" height="210" 
                    fill="none" 
                    stroke={activeZone === "A" ? "#10b981" : "#27272a"} 
                    strokeWidth={activeZone === "A" ? "1.5" : "1"} 
                    strokeDasharray="3,3"
                    className="transition-colors duration-300"
                  />
                  <text x="92" y="245" fontSize="9" fill={activeZone === "A" ? "#34d399" : "#52525b"} textAnchor="middle" fontWeight="bold">ZONE A // WEST WING</text>

                  {/* ZONE A - World Cup Athletics */}
                  <g onClick={() => handleSimulateSurge("A")} className="cursor-pointer">
                    <rect x="35" y="60" width="55" height="40" rx="2" fill="#09090b" stroke="#3f3f46" strokeWidth="1" className="hover:stroke-zinc-400 transition-colors" />
                    <text x="62.5" y="82" fontSize="7" fill="#f4f4f5" textAnchor="middle" fontWeight="medium">Athletics</text>
                    <circle cx="62.5" cy="92" r="2" fill="#ef4444" />
                  </g>

                  {/* ZONE A - Fan Zone Goods */}
                  <g onClick={() => handleSimulateSurge("A")} className="cursor-pointer">
                    <rect x="95" y="60" width="55" height="40" rx="2" fill="#09090b" stroke="#3f3f46" strokeWidth="1" className="hover:stroke-zinc-400 transition-colors" />
                    <text x="122.5" y="82" fontSize="7" fill="#f4f4f5" textAnchor="middle" fontWeight="medium">Fan Zone</text>
                    <circle cx="122.5" cy="92" r="2" fill="#ef4444" />
                  </g>

                  {/* ZONE B (East Wing) */}
                  <rect 
                    x="240" y="45" width="135" height="210" 
                    fill="none" 
                    stroke={activeZone === "B" ? "#10b981" : "#27272a"} 
                    strokeWidth={activeZone === "B" ? "1.5" : "1"} 
                    strokeDasharray="3,3"
                    className="transition-colors duration-300"
                  />
                  <text x="307" y="245" fontSize="9" fill={activeZone === "B" ? "#34d399" : "#52525b"} textAnchor="middle" fontWeight="bold">ZONE B // EAST WING</text>

                  {/* ZONE B - Champions Souvenirs */}
                  <g onClick={() => handleSimulateSurge("B")} className="cursor-pointer">
                    <rect x="250" y="190" width="55" height="40" rx="2" fill="#09090b" stroke="#3f3f46" strokeWidth="1" className="hover:stroke-zinc-400 transition-colors" />
                    <text x="277.5" y="212" fontSize="7" fill="#f4f4f5" textAnchor="middle" fontWeight="medium">Champions</text>
                    <circle cx="277.5" cy="222" r="2" fill="#ef4444" />
                  </g>

                  {/* ZONE B - Stadium Snacks & Gear */}
                  <g onClick={() => handleSimulateSurge("B")} className="cursor-pointer">
                    <rect x="310" y="190" width="55" height="40" rx="2" fill="#09090b" stroke="#3f3f46" strokeWidth="1" className="hover:stroke-zinc-400 transition-colors" />
                    <text x="337.5" y="212" fontSize="7" fill="#f4f4f5" textAnchor="middle" fontWeight="medium">Stadium</text>
                    <circle cx="337.5" cy="222" r="2" fill="#ef4444" />
                  </g>
                </svg>
              </div>

              {/* Metrics */}
              <div className="mt-4 border border-zinc-900 bg-zinc-950/40 rounded p-3 text-[11px] font-mono space-y-2">
                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">GEOSPATIAL METRICS</div>
                <div className="grid grid-cols-2 gap-2 text-zinc-300">
                  <div>Zone scan: <span className="text-zinc-100 font-bold">{activeZone ? `Zone ${activeZone}` : "Standby"}</span></div>
                  <div>Range: <span className="text-zinc-100 font-bold">{activeZone ? "500m" : "0m"}</span></div>
                  <div className="col-span-2">Coordinates: <span className="text-zinc-100 font-bold">{lastScanCoords ? `${lastScanCoords[0].toFixed(3)}, ${lastScanCoords[1].toFixed(3)}` : "Standby"}</span></div>
                </div>
              </div>

              {/* Simulated Triggers */}
              <div className="mt-4 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleSimulateSurge("A")}
                    disabled={isSimulating}
                    className="py-2 px-3 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-200 text-[11px] rounded transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                  >
                    SURGE ZONE A
                  </button>
                  <button
                    onClick={() => handleSimulateSurge("B")}
                    disabled={isSimulating}
                    className="py-2 px-3 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-200 text-[11px] rounded transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                  >
                    SURGE ZONE B
                  </button>
                </div>

                <button
                  onClick={handleSeedDB}
                  className="w-full flex items-center justify-center space-x-2 py-2 px-3 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 hover:bg-zinc-900/60 text-zinc-400 hover:text-zinc-300 text-[11px] rounded transition-all cursor-pointer select-none active:scale-[0.98]"
                >
                  <span>RESET STOCKS & CODES</span>
                </button>
              </div>
            </div>
          </section>

          {/* CENTER COLUMN: SYSTEM TERMINAL */}
          <section className="flex flex-col border border-zinc-900 bg-zinc-900/20 rounded-lg overflow-hidden">
            <div className="shrink-0 bg-zinc-900/40 border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                System Console Logs
              </h2>
              <div className="flex space-x-1">
                <span className="w-2 h-2 rounded-full bg-zinc-800" />
                <span className="w-2 h-2 rounded-full bg-zinc-800" />
                <span className="w-2 h-2 rounded-full bg-zinc-800" />
              </div>
            </div>

            <div className="p-4 border-b border-zinc-900 bg-zinc-950/20">
              <input 
                type="text"
                placeholder="grep -i filter..."
                value={logFilter}
                onChange={e => setLogFilter(e.target.value)}
                className="w-full px-3 py-1.5 rounded bg-zinc-900/50 border border-zinc-800 focus:outline-none focus:border-zinc-700 text-[11px] text-zinc-300 font-mono placeholder:text-zinc-650 transition-colors"
              />
            </div>

            <div className="flex-1 p-4 overflow-y-auto bg-black/60 flex flex-col justify-start">
              <div className="space-y-0.5 font-mono">
                {filteredLogs.length === 0 ? (
                  <div className="text-zinc-700 text-[11px] italic p-2 text-center">
                    No log entries available.
                  </div>
                ) : (
                  filteredLogs.map((log, idx) => renderLogLine(log, idx))
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          </section>

          {/* RIGHT COLUMN: DIGITAL SIGNAGE DECK */}
          <section className="flex flex-col border border-zinc-900 bg-zinc-900/20 rounded-lg overflow-hidden">
            <div className="shrink-0 bg-zinc-900/40 border-b border-zinc-900 px-4 py-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Active Promotions Signage
              </h2>
              <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900/60 px-2 py-0.5 rounded border border-zinc-800">
                ACTIVE: {promotions.length}
              </span>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              {promotions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-zinc-900 rounded bg-zinc-950/10">
                  <svg className="h-8 w-8 text-zinc-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                  <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
                    No Active Promotions
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1 max-w-[200px]">
                    Surge A or B scan sweeps will deploy retail agent flash code sales here.
                  </p>
                </div>
              ) : (
                [...promotions].reverse().map(promo => {
                  const store = getStoreForPromo(promo);
                  const currentStock = store ? store.current_stock : 100;
                  const targetStock = store ? store.target_stock : 20;
                  const initialStock = store ? (store.name.includes("World Cup") ? 150 : store.name.includes("Champions") ? 120 : store.name.includes("Fan") ? 80 : 60) : 150;
                  const safetyThresholdPercent = (targetStock / initialStock) * 100;
                  const currentStockPercent = Math.min(100, (currentStock / initialStock) * 100);

                  const remainingSeconds = getRemainingSeconds(promo);
                  const isExpired = remainingSeconds <= 0;

                  if (isExpired) return null;

                  const isCritical = currentStock <= targetStock;
                  const stockBarColor = isCritical 
                    ? "bg-rose-500/80" 
                    : currentStock <= targetStock + 20 
                      ? "bg-amber-500/80" 
                      : "bg-emerald-500/80";

                  return (
                    <div 
                      key={promo.id} 
                      className="relative border border-zinc-900 bg-zinc-950/70 hover:border-zinc-800 rounded-md p-4 transition-all flex flex-col justify-between"
                    >
                      {/* Top indicator bar */}
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-zinc-800" />
                      
                      {/* Store Title */}
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-xs font-bold text-white tracking-tight leading-tight">{promo.store_name}</h3>
                          <p className="text-[10px] text-zinc-400 mt-0.5">Surplus item: {promo.item}</p>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[9px] px-1.5 py-0.5 font-bold tracking-widest bg-zinc-900 border border-zinc-800 text-zinc-300 rounded font-mono">
                            FLASH CODE
                          </span>
                          
                          {/* Countdown */}
                          <div className="flex items-center space-x-1 mt-1 text-[10px] font-mono text-zinc-400 font-bold">
                            <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                            <span>{formatCountdown(remainingSeconds)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Message */}
                      <div className="my-3 px-3 py-2 border-l border-zinc-700 bg-zinc-900/30 text-[11px] text-zinc-300 italic leading-relaxed">
                        "{promo.message}"
                      </div>

                      {/* Stock level indicators */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] text-zinc-500 font-mono">
                          <span>STOCK STATUS</span>
                          <span className={isCritical ? "text-rose-400 font-bold" : "text-zinc-355"}>
                            {isCritical ? "CRITICAL MINIMUM" : "ADEQUATE"} ({currentStock} / {initialStock})
                          </span>
                        </div>

                        {/* Progress Bar Container */}
                        <div className="relative w-full h-3 bg-zinc-950 border border-zinc-900 rounded overflow-hidden p-[2px]">
                          {/* Stock progress */}
                          <div 
                            className={`h-full ${stockBarColor} rounded-sm transition-all duration-500`}
                            style={{ width: `${currentStockPercent}%` }}
                          />
                          {/* Safety line indicator */}
                          <div 
                            className="absolute top-0 bottom-0 w-[1.5px] bg-amber-500/80 border-r border-zinc-950"
                            style={{ left: `${safetyThresholdPercent}%` }}
                            title={`Safety Target Threshold: ${targetStock} units`}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[8px] text-zinc-650 font-mono pt-0.5">
                          <span>MIN SECURE TARGET: {targetStock} units</span>
                          <span>MAX CAP: {initialStock} units</span>
                        </div>
                      </div>

                      {/* Coupon */}
                      <div className="mt-3 relative border border-dashed border-zinc-800 bg-zinc-900/20 rounded py-2 flex flex-col items-center justify-center">
                        <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider font-mono">REDEMPTION CODE</div>
                        <div className="text-xs font-bold font-mono text-zinc-100 tracking-wider mt-0.5 select-all">
                          {promo.discount_code}
                        </div>
                      </div>

                      {/* Barcode representation */}
                      <div className="flex items-center justify-between h-5 bg-zinc-900/30 px-2 rounded mt-3 border border-zinc-900/50">
                        <div className="flex h-3 items-stretch space-x-[1px]">
                          {[1, 2, 1, 3, 2, 1, 3, 1, 4, 1, 2, 3, 1, 2, 4, 1].map((w, i) => (
                            <span key={i} className="bg-zinc-700" style={{ width: `${w}px` }} />
                          ))}
                        </div>
                        <span className="font-mono text-[8px] text-zinc-500 tracking-wider">
                          ID: {promo.id.toUpperCase()}
                        </span>
                      </div>

                    </div>
                  );
                })
              )}
            </div>
          </section>

        </main>
      )}

      {activeTab === 'shopping' && (
        <main className="flex-1 flex flex-col p-5 overflow-y-auto space-y-5">
          {/* Main Simulator Header */}
          <div className="shrink-0 flex items-center justify-between border-b border-zinc-900 pb-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
                Nexus Retail Media Network Exchange Simulator (NEX-RMN)
              </h2>
              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                Simulate consumer experience across Zone A and Zone B. Search logs trigger yield adjustments, and purchases run ACID inventory transactions.
              </p>
            </div>
            {backendOnline && (
              <span className="text-[10px] font-mono text-emerald-400 bg-zinc-900/40 px-2 py-0.5 rounded border border-emerald-950/20">
                LIVE DB RTB AUCTION & ASYNC LOOP ACTIVE
              </span>
            )}
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[500px]">
            {/* COLUMN 1: ZONE A SHOPPING (WEST WING) */}
            <div className="flex flex-col border border-zinc-900 bg-zinc-900/10 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2 flex-wrap gap-2">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                    Zone A Shopping // West Wing
                  </h3>
                </div>
                
                {/* Traffic Density Controller */}
                <div className="flex items-center space-x-2 text-[10px] bg-zinc-950/60 border border-zinc-900 rounded px-2 py-1">
                  <span className="font-mono text-zinc-400">Visitors:</span>
                  <button
                    onClick={() => handleRmnSimulateTraffic("Zone_A", Math.max(0, rmnVisitorsA - 1))}
                    className="w-4 h-4 flex items-center justify-center border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded cursor-pointer select-none"
                  >
                    -
                  </button>
                  <span className="w-4 text-center font-bold text-zinc-200 font-mono">{rmnVisitorsA}</span>
                  <button
                    onClick={() => handleRmnSimulateTraffic("Zone_A", rmnVisitorsA + 1)}
                    className="w-4 h-4 flex items-center justify-center border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded cursor-pointer select-none"
                  >
                    +
                  </button>
                  {rmnVisitorsA >= 5 && (
                    <span className="animate-pulse bg-amber-500/10 text-amber-400 border border-amber-800/30 px-1 py-0.5 rounded text-[8px] font-extrabold tracking-wider font-mono">
                      🔥 SURGE (1.5x)
                    </span>
                  )}
                </div>
              </div>

              {/* Search input Zone A */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Search Zone A (e.g. 'Rain Poncho' or 'Match Jersey')" 
                    value={searchZoneA}
                    onChange={e => setSearchZoneA(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleRmnSearch("Zone_A")}
                    className="w-full px-3 py-2 text-xs rounded bg-zinc-950/70 border border-zinc-850 focus:outline-none focus:border-zinc-750 text-zinc-300 placeholder:text-zinc-650"
                  />
                  {searchZoneA && (
                    <button 
                      onClick={() => { setSearchZoneA(""); setSearchFilterA(""); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => handleRmnSearch("Zone_A")}
                  className="px-4 py-2 border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-205 text-xs font-semibold rounded cursor-pointer transition-all active:scale-[0.98]"
                >
                  Search
                </button>
              </div>

              {/* Sponsored Card Zone A */}
              {rmnSponsoredA && (
                <div 
                  onClick={() => handleRmnClick(rmnSponsoredA.campaignId)}
                  className={`relative border-2 rounded-lg p-4 shadow-lg overflow-hidden backdrop-blur-md cursor-pointer transition-all ${
                    rmnSponsoredA.tenantId === "coop_partnership"
                      ? "border-violet-500/40 bg-zinc-950/65 hover:border-violet-400"
                      : "border-indigo-500/40 bg-zinc-950/65 hover:border-indigo-400"
                  }`}
                >
                  <div className="absolute -right-10 -top-10 w-24 h-24 rounded-full bg-violet-650/10 blur-xl pointer-events-none" />
                  <div className="flex items-center justify-between mb-2">
                    <span className="bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wider shadow-sm font-mono">
                      {rmnSponsoredA.tenantId === "coop_partnership" ? "★ CO-OP PARTNERSHIP // AD WINNER" : "★ Sponsored // Ad Auction Winner"}
                    </span>
                    <span className="text-[8px] text-zinc-500 font-mono">
                      CPC: ${rmnSponsoredA.actual_cpc.toFixed(2)} | Ad Rank: {rmnSponsoredA.ad_rank.toFixed(1)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-violet-300 leading-snug">
                      {rmnSponsoredA.headline}
                    </h4>
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      {rmnSponsoredA.body}
                    </p>
                  </div>
                  {rmnSponsoredA.product && (
                    <div className="mt-3 bg-zinc-900/40 border border-zinc-800/40 rounded p-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-[9px] uppercase tracking-wider text-zinc-555 font-mono">
                          {rmnSponsoredA.tenantId === "coop_partnership" 
                            ? "JOINT DEAL"
                            : rmnSponsoredA.product.tenantId.replace('_official', '').toUpperCase()
                          }
                        </div>
                        <div className="text-xs font-bold text-zinc-200 mt-0.5">
                          {rmnSponsoredA.product.googleMerchantFields.title}
                        </div>
                        <div className="mt-1 flex items-baseline space-x-1.5">
                          <span className="text-xs font-extrabold text-white">
                            ${rmnSponsoredA.product.googleMerchantFields.sale_price.toFixed(2)}
                          </span>
                          {rmnSponsoredA.product.googleMerchantFields.sale_price < rmnSponsoredA.product.googleMerchantFields.base_price && (
                            <span className="text-[9px] text-zinc-650 line-through">
                              ${rmnSponsoredA.product.googleMerchantFields.base_price.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation(); // prevent double click firing of card onClick
                          handleRmnClick(rmnSponsoredA.campaignId);
                          handleRmnBuy("Zone_A", rmnSponsoredA.product.googleMerchantFields.g_mpn);
                        }}
                        disabled={rmnSponsoredA.product.inventory_metrics.availableStock <= 0}
                        className="shrink-0 py-1 px-3 border border-violet-650 hover:border-violet-500 bg-violet-600/10 hover:bg-violet-600/25 text-violet-300 text-[10px] font-bold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                      >
                        {rmnSponsoredA.product.inventory_metrics.availableStock <= 0 ? "OUT OF STOCK" : "BUY OFFER"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Shopping Cards Zone A */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {rmnProductsA
                  .filter(p => !rmnSponsoredA || p.googleMerchantFields.g_mpn !== rmnSponsoredA.product?.googleMerchantFields.g_mpn)
                  .map(product => {
                    const originalPrice = product.googleMerchantFields.base_price;
                    const salePrice = product.googleMerchantFields.sale_price;
                    const isDiscounted = salePrice < originalPrice;
                    const discountPercentage = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
                    const avail = product.inventory_metrics.availableStock;
                    const buffer = product.inventory_metrics.safetyBuffer;
                    const isCritical = avail <= buffer;
                    const searchVelocity = product.realtime_demand?.searchVelocity30s || 0;
                    const cartAdditions = product.realtime_demand?.cartAdditions30s || 0;

                    return (
                      <div 
                        key={product.googleMerchantFields.g_mpn} 
                        className="border border-zinc-900 bg-zinc-950/40 hover:border-zinc-850 p-4 rounded-md transition-all flex flex-col justify-between relative overflow-hidden"
                      >
                        {isDiscounted && (
                          <div className="absolute top-2 right-2 bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10 font-mono">
                            {discountPercentage}% OFF
                          </div>
                        )}
                        
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase tracking-wider text-zinc-555 font-mono">
                            {product.tenantId.replace('_official', '').toUpperCase()}
                          </span>
                          <h4 className="text-xs font-bold text-zinc-200">{product.googleMerchantFields.title}</h4>
                          <p className="text-[9px] text-zinc-500 line-clamp-1">{product.googleMerchantFields.description}</p>
                        </div>

                        {/* Real-time demand indicators */}
                        {(searchVelocity > 0 || cartAdditions > 0) && (
                          <div className="mt-2 flex gap-1.5 text-[8px] font-mono">
                            {searchVelocity > 0 && (
                              <span className="text-sky-400 bg-sky-950/30 px-1 py-0.5 rounded border border-sky-950/20">
                                🔍 Search Vel: {searchVelocity}
                              </span>
                            )}
                            {cartAdditions > 0 && (
                              <span className="text-emerald-400 bg-emerald-950/30 px-1 py-0.5 rounded border border-emerald-950/20">
                                🛒 Cart Adds: {cartAdditions}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex items-baseline space-x-2">
                          <span className="text-sm font-extrabold text-white">
                            ${salePrice.toFixed(2)}
                          </span>
                          {isDiscounted && (
                            <span className="text-[10px] text-zinc-650 line-through">
                              ${originalPrice.toFixed(2)}
                            </span>
                          )}
                        </div>

                        <div className="mt-4 space-y-1">
                          <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                            <span>STOCK STATUS</span>
                            <span className={isCritical ? "text-rose-400 font-semibold" : "text-zinc-350"}>
                              {avail} (Buffer: {buffer})
                            </span>
                          </div>
                          <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${isCritical ? "bg-rose-500/80" : "bg-emerald-500/80"} transition-all duration-300`} 
                              style={{ width: `${Math.min(100, (avail / (avail + 20)) * 100)}%` }}
                            />
                          </div>
                        </div>

                        <button 
                          onClick={() => handleRmnBuy("Zone_A", product.googleMerchantFields.g_mpn)}
                          disabled={avail <= 0}
                          className="mt-4 w-full py-1.5 px-3 border border-zinc-805 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-850 text-zinc-200 text-[10px] font-semibold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                        >
                          {avail <= 0 ? "OUT OF STOCK" : "BUY ITEM / ADD TO CART"}
                        </button>
                      </div>
                    );
                  })}
              </div>

              {/* LIVE AUCTION LEDGER TERMINAL ZONE A */}
              <div className="border border-zinc-900 bg-black/85 rounded-md overflow-hidden font-mono mt-2">
                <div className="bg-zinc-900/60 border-b border-zinc-900 px-3 py-2 flex items-center justify-between">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                    ⌨ Zone A programmatic RTB auction ledger
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="p-3 text-[10px] text-zinc-300 space-y-2 max-h-[190px] overflow-y-auto leading-relaxed">
                  {rmnLedgerA.length === 0 ? (
                    <div className="text-zinc-650 italic">No auctions executed yet. Run a search to trigger.</div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-zinc-500 border-b border-zinc-900/50 pb-1 text-[9px]">
                        Formula: Ad Rank = CPC Bid * QS * Multiplier ({rmnMultiplierA}x)
                      </div>
                      {rmnLedgerA.map((cand) => {
                        const isWinner = cand.status === "WINNER";
                        const isRunnerUp = cand.status === "RUNNER_UP";
                        const isDisqualified = (cand.status || "").startsWith("DISQUALIFIED");
                        
                        return (
                          <div key={cand.campaignId} className="flex flex-col border-b border-zinc-900/30 pb-1.5 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between">
                              <span className={`${isWinner ? "text-violet-300 font-extrabold" : "text-zinc-455 font-bold"}`}>
                                {cand.campaignId}
                              </span>
                              <span className={`px-1 rounded text-[8px] font-bold tracking-wider ${
                                isWinner ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/30" : 
                                isRunnerUp ? "bg-amber-950/60 text-amber-400 border border-amber-800/30" : 
                                isDisqualified ? "bg-rose-950/30 text-rose-500/70 border border-rose-900/10" : "bg-zinc-900 text-zinc-400"
                              }`}>
                                {cand.status}
                              </span>
                            </div>
                            {!isDisqualified ? (
                              <div className="text-zinc-400 mt-0.5 text-[9px]">
                                Bid: <span className="text-zinc-200 font-bold">${cand.maxBidPerClick.toFixed(2)}</span> | 
                                QS: <span className="text-zinc-200 font-bold">{cand.qs.toFixed(1)}</span> | 
                                Ad Rank: <span className="text-zinc-200 font-bold">{cand.adRank.toFixed(2)}</span>
                              </div>
                            ) : (
                              <div className="text-rose-500/60 italic mt-0.5 text-[9px]">
                                Disqualified: {cand.status === "DISQUALIFIED_STOCK_SHORTAGE" ? "Out of Stock (Safety Buffer)" : "No Rank"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {/* Winner calculations */}
                      {(() => {
                        const winner = rmnLedgerA.find(c => c.status === "WINNER");
                        const runnerUp = rmnLedgerA.find(c => c.status === "RUNNER_UP");
                        if (winner) {
                          const billedCpc = rmnSponsoredA ? rmnSponsoredA.actual_cpc : 0.05;
                          return (
                            <div className="mt-2 pt-2 border-t border-zinc-800/60 text-[8px] text-zinc-500 space-y-1 bg-zinc-950/30 p-2 rounded">
                              <div className="text-zinc-400 font-bold uppercase tracking-wider text-[8px]">Programmatic Settlement (Vickrey):</div>
                              {runnerUp ? (
                                <div>
                                  CPC = (Runner Up Ad Rank / (Winner QS * Multiplier)) + $0.01 <br />
                                  CPC = ({runnerUp.adRank.toFixed(2)} / ({winner.qs.toFixed(1)} * {rmnMultiplierA})) + $0.01 = <span className="text-emerald-400 font-extrabold">${billedCpc.toFixed(2)}</span>
                                </div>
                              ) : (
                                <div>
                                  CPC = Max Bid or Default Flat Minimum = <span className="text-emerald-400 font-extrabold">${billedCpc.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* COLUMN 2: ZONE B SHOPPING (EAST WING) */}
            <div className="flex flex-col border border-zinc-900 bg-zinc-900/10 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2 flex-wrap gap-2">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                    Zone B Shopping // East Wing
                  </h3>
                </div>
                
                {/* Traffic Density Controller */}
                <div className="flex items-center space-x-2 text-[10px] bg-zinc-950/60 border border-zinc-900 rounded px-2 py-1">
                  <span className="font-mono text-zinc-400">Visitors:</span>
                  <button
                    onClick={() => handleRmnSimulateTraffic("Zone_B", Math.max(0, rmnVisitorsB - 1))}
                    className="w-4 h-4 flex items-center justify-center border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded cursor-pointer select-none"
                  >
                    -
                  </button>
                  <span className="w-4 text-center font-bold text-zinc-200 font-mono">{rmnVisitorsB}</span>
                  <button
                    onClick={() => handleRmnSimulateTraffic("Zone_B", rmnVisitorsB + 1)}
                    className="w-4 h-4 flex items-center justify-center border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded cursor-pointer select-none"
                  >
                    +
                  </button>
                  {rmnVisitorsB >= 5 && (
                    <span className="animate-pulse bg-amber-500/10 text-amber-400 border border-amber-800/30 px-1 py-0.5 rounded text-[8px] font-extrabold tracking-wider font-mono">
                      🔥 SURGE (1.5x)
                    </span>
                  )}
                </div>
              </div>

              {/* Search input Zone B */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Search Zone B (e.g. 'Cold Brew' or 'Red Bull')" 
                    value={searchZoneB}
                    onChange={e => setSearchZoneB(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleRmnSearch("Zone_B")}
                    className="w-full px-3 py-2 text-xs rounded bg-zinc-950/70 border border-zinc-855 focus:outline-none focus:border-zinc-755 text-zinc-300 placeholder:text-zinc-650"
                  />
                  {searchZoneB && (
                    <button 
                      onClick={() => { setSearchZoneB(""); setSearchFilterB(""); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => handleRmnSearch("Zone_B")}
                  className="px-4 py-2 border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-850 text-zinc-205 text-xs font-semibold rounded cursor-pointer transition-all active:scale-[0.98]"
                >
                  Search
                </button>
              </div>

              {/* Sponsored Card Zone B */}
              {rmnSponsoredB && (
                <div 
                  onClick={() => handleRmnClick(rmnSponsoredB.campaignId)}
                  className={`relative border-2 rounded-lg p-4 shadow-lg overflow-hidden backdrop-blur-md cursor-pointer transition-all ${
                    rmnSponsoredB.tenantId === "coop_partnership"
                      ? "border-violet-500/40 bg-zinc-950/65 hover:border-violet-400"
                      : "border-indigo-500/40 bg-zinc-950/65 hover:border-indigo-400"
                  }`}
                >
                  <div className="absolute -right-10 -top-10 w-24 h-24 rounded-full bg-violet-650/10 blur-xl pointer-events-none" />
                  <div className="flex items-center justify-between mb-2">
                    <span className="bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wider shadow-sm font-mono">
                      {rmnSponsoredB.tenantId === "coop_partnership" ? "★ CO-OP PARTNERSHIP // AD WINNER" : "★ Sponsored // Ad Auction Winner"}
                    </span>
                    <span className="text-[8px] text-zinc-500 font-mono">
                      CPC: ${rmnSponsoredB.actual_cpc.toFixed(2)} | Ad Rank: {rmnSponsoredB.ad_rank.toFixed(1)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-violet-300 leading-snug">
                      {rmnSponsoredB.headline}
                    </h4>
                    <p className="text-[10px] text-zinc-400 leading-normal">
                      {rmnSponsoredB.body}
                    </p>
                  </div>
                  {rmnSponsoredB.product && (
                    <div className="mt-3 bg-zinc-900/40 border border-zinc-800/40 rounded p-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-[9px] uppercase tracking-wider text-zinc-555 font-mono">
                          {rmnSponsoredB.tenantId === "coop_partnership" 
                            ? "JOINT DEAL"
                            : rmnSponsoredB.product.tenantId.replace('_official', '').toUpperCase()
                          }
                        </div>
                        <div className="text-xs font-bold text-zinc-200 mt-0.5">
                          {rmnSponsoredB.product.googleMerchantFields.title}
                        </div>
                        <div className="mt-1 flex items-baseline space-x-1.5">
                          <span className="text-xs font-extrabold text-white">
                            ${rmnSponsoredB.product.googleMerchantFields.sale_price.toFixed(2)}
                          </span>
                          {rmnSponsoredB.product.googleMerchantFields.sale_price < rmnSponsoredB.product.googleMerchantFields.base_price && (
                            <span className="text-[9px] text-zinc-650 line-through">
                              ${rmnSponsoredB.product.googleMerchantFields.base_price.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation(); // prevent double click firing of card onClick
                          handleRmnClick(rmnSponsoredB.campaignId);
                          handleRmnBuy("Zone_B", rmnSponsoredB.product.googleMerchantFields.g_mpn);
                        }}
                        disabled={rmnSponsoredB.product.inventory_metrics.availableStock <= 0}
                        className="shrink-0 py-1 px-3 border border-violet-650 hover:border-violet-500 bg-violet-600/10 hover:bg-violet-600/25 text-violet-300 text-[10px] font-bold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                      >
                        {rmnSponsoredB.product.inventory_metrics.availableStock <= 0 ? "OUT OF STOCK" : "BUY OFFER"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Shopping Cards Zone B */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {rmnProductsB
                  .filter(p => !rmnSponsoredB || p.googleMerchantFields.g_mpn !== rmnSponsoredB.product?.googleMerchantFields.g_mpn)
                  .map(product => {
                    const originalPrice = product.googleMerchantFields.base_price;
                    const salePrice = product.googleMerchantFields.sale_price;
                    const isDiscounted = salePrice < originalPrice;
                    const discountPercentage = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
                    const avail = product.inventory_metrics.availableStock;
                    const buffer = product.inventory_metrics.safetyBuffer;
                    const isCritical = avail <= buffer;
                    const searchVelocity = product.realtime_demand?.searchVelocity30s || 0;
                    const cartAdditions = product.realtime_demand?.cartAdditions30s || 0;

                    return (
                      <div 
                        key={product.googleMerchantFields.g_mpn} 
                        className="border border-zinc-900 bg-zinc-950/40 hover:border-zinc-855 p-4 rounded-md transition-all flex flex-col justify-between relative overflow-hidden"
                      >
                        {isDiscounted && (
                          <div className="absolute top-2 right-2 bg-rose-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10 font-mono">
                            {discountPercentage}% OFF
                          </div>
                        )}
                        
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase tracking-wider text-zinc-555 font-mono">
                            {product.tenantId.replace('_official', '').toUpperCase()}
                          </span>
                          <h4 className="text-xs font-bold text-zinc-200">{product.googleMerchantFields.title}</h4>
                          <p className="text-[9px] text-zinc-500 line-clamp-1">{product.googleMerchantFields.description}</p>
                        </div>

                        {/* Real-time demand indicators */}
                        {(searchVelocity > 0 || cartAdditions > 0) && (
                          <div className="mt-2 flex gap-1.5 text-[8px] font-mono">
                            {searchVelocity > 0 && (
                              <span className="text-sky-400 bg-sky-950/30 px-1 py-0.5 rounded border border-sky-950/20">
                                🔍 Search Vel: {searchVelocity}
                              </span>
                            )}
                            {cartAdditions > 0 && (
                              <span className="text-emerald-400 bg-emerald-950/30 px-1 py-0.5 rounded border border-emerald-950/20">
                                🛒 Cart Adds: {cartAdditions}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex items-baseline space-x-2">
                          <span className="text-sm font-extrabold text-white">
                            ${salePrice.toFixed(2)}
                          </span>
                          {isDiscounted && (
                            <span className="text-[10px] text-zinc-655 line-through">
                              ${originalPrice.toFixed(2)}
                            </span>
                          )}
                        </div>

                        <div className="mt-4 space-y-1">
                          <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                            <span>STOCK STATUS</span>
                            <span className={isCritical ? "text-rose-400 font-semibold" : "text-zinc-350"}>
                              {avail} (Buffer: {buffer})
                            </span>
                          </div>
                          <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${isCritical ? "bg-rose-500/80" : "bg-emerald-500/80"} transition-all duration-300`} 
                              style={{ width: `${Math.min(100, (avail / (avail + 20)) * 100)}%` }}
                            />
                          </div>
                        </div>

                        <button 
                          onClick={() => handleRmnBuy("Zone_B", product.googleMerchantFields.g_mpn)}
                          disabled={avail <= 0}
                          className="mt-4 w-full py-1.5 px-3 border border-zinc-805 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-850 text-zinc-200 text-[10px] font-semibold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                        >
                          {avail <= 0 ? "OUT OF STOCK" : "BUY ITEM / ADD TO CART"}
                        </button>
                      </div>
                    );
                  })}
              </div>

              {/* LIVE AUCTION LEDGER TERMINAL ZONE B */}
              <div className="border border-zinc-900 bg-black/85 rounded-md overflow-hidden font-mono mt-2">
                <div className="bg-zinc-900/60 border-b border-zinc-900 px-3 py-2 flex items-center justify-between">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                    ⌨ Zone B programmatic RTB auction ledger
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                </div>
                <div className="p-3 text-[10px] text-zinc-300 space-y-2 max-h-[190px] overflow-y-auto leading-relaxed">
                  {rmnLedgerB.length === 0 ? (
                    <div className="text-zinc-650 italic">No auctions executed yet. Run a search to trigger.</div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-zinc-500 border-b border-zinc-900/50 pb-1 text-[9px]">
                        Formula: Ad Rank = CPC Bid * QS * Multiplier ({rmnMultiplierB}x)
                      </div>
                      {rmnLedgerB.map((cand) => {
                        const isWinner = cand.status === "WINNER";
                        const isRunnerUp = cand.status === "RUNNER_UP";
                        const isDisqualified = (cand.status || "").startsWith("DISQUALIFIED");
                        
                        return (
                          <div key={cand.campaignId} className="flex flex-col border-b border-zinc-900/30 pb-1.5 last:border-0 last:pb-0">
                            <div className="flex items-center justify-between">
                              <span className={`${isWinner ? "text-violet-300 font-extrabold" : "text-zinc-455 font-bold"}`}>
                                {cand.campaignId}
                              </span>
                              <span className={`px-1 rounded text-[8px] font-bold tracking-wider ${
                                isWinner ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/30" : 
                                isRunnerUp ? "bg-amber-950/60 text-amber-400 border border-amber-800/30" : 
                                isDisqualified ? "bg-rose-950/30 text-rose-500/70 border border-rose-900/10" : "bg-zinc-900 text-zinc-400"
                              }`}>
                                {cand.status}
                              </span>
                            </div>
                            {!isDisqualified ? (
                              <div className="text-zinc-400 mt-0.5 text-[9px]">
                                Bid: <span className="text-zinc-200 font-bold">${cand.maxBidPerClick.toFixed(2)}</span> | 
                                QS: <span className="text-zinc-200 font-bold">{cand.qs.toFixed(1)}</span> | 
                                Ad Rank: <span className="text-zinc-200 font-bold">{cand.adRank.toFixed(2)}</span>
                              </div>
                            ) : (
                              <div className="text-rose-500/60 italic mt-0.5 text-[9px]">
                                Disqualified: {cand.status === "DISQUALIFIED_STOCK_SHORTAGE" ? "Out of Stock (Safety Buffer)" : "No Rank"}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      
                      {/* Winner calculations */}
                      {(() => {
                        const winner = rmnLedgerB.find(c => c.status === "WINNER");
                        const runnerUp = rmnLedgerB.find(c => c.status === "RUNNER_UP");
                        if (winner) {
                          const billedCpc = rmnSponsoredB ? rmnSponsoredB.actual_cpc : 0.05;
                          return (
                            <div className="mt-2 pt-2 border-t border-zinc-800/60 text-[8px] text-zinc-500 space-y-1 bg-zinc-950/30 p-2 rounded">
                              <div className="text-zinc-400 font-bold uppercase tracking-wider text-[8px]">Programmatic Settlement (Vickrey):</div>
                              {runnerUp ? (
                                <div>
                                  CPC = (Runner Up Ad Rank / (Winner QS * Multiplier)) + $0.01 <br />
                                  CPC = ({runnerUp.adRank.toFixed(2)} / ({winner.qs.toFixed(1)} * {rmnMultiplierB})) + $0.01 = <span className="text-emerald-400 font-extrabold">${billedCpc.toFixed(2)}</span>
                                </div>
                              ) : (
                                <div>
                                  CPC = Max Bid or Default Flat Minimum = <span className="text-emerald-400 font-extrabold">${billedCpc.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>
        </main>
      )}

      {activeTab === 'merchant' && (() => {
        const merchantProfiles = [
          { id: "nike_official", name: "Nike Official" },
          { id: "starbucks_official", name: "Starbucks Official" },
          { id: "redbull_official", name: "Red Bull Official" },
          { id: "fifa_souvenirs", name: "FIFA Souvenirs" },
          { id: "coop_partnership", name: "Co-Opetition Partnerships" }
        ];

        return (
          <main className="flex-1 flex flex-col p-5 overflow-y-auto space-y-6">
            <div className="shrink-0 flex items-center justify-between border-b border-zinc-900 pb-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
                  Merchant Bidding & Campaign Management Deck
                </h2>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                  Set max CPC bids, budget limits, target geofence zones, and audience keywords. Update creative copy and view real-time delivery performance.
                </p>
              </div>
              <div className="flex bg-zinc-950/60 p-1 rounded-md border border-zinc-900">
                {merchantProfiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setMerchantTenant(p.id);
                      setEditingCampaignId(null);
                    }}
                    className={`px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer select-none ${
                      merchantTenant === p.id
                        ? "bg-zinc-900/80 text-violet-400 border border-zinc-800/40 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-400"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* LEFT 2 COLUMNS: CAMPAIGN STATS & LIST */}
              <div className="xl:col-span-2 space-y-6">
                {merchantCampaigns.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 border border-dashed border-zinc-900 rounded-lg bg-zinc-950/10 text-center">
                    <svg className="h-10 w-10 text-zinc-700 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z" />
                    </svg>
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">No Campaigns Seeded</span>
                    <p className="text-[10px] text-zinc-650 mt-1 max-w-sm">
                      {merchantTenant === "coop_partnership" 
                        ? "No active joint campaigns found. Establish a partnership deal using the creator tool."
                        : "Seeding RMN database will initialize active campaigns for this tenant segment."}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-5">
                    {merchantCampaigns.map((camp) => {
                      const spent = camp.dailyBudget - camp.remainingBudget;
                      const ctr = camp.impressions > 0 ? (camp.clicks / camp.impressions) * 100 : 0;
                      const isEditing = editingCampaignId === camp.campaignId;
                      const isCoop = camp.isJoint;

                      return (
                        <div
                          key={camp.campaignId}
                          className={`border rounded-lg p-5 transition-all relative ${
                            isEditing
                              ? "border-violet-500/50 bg-zinc-950/90 shadow-[0_0_15px_rgba(139,92,246,0.1)]"
                              : "border-zinc-900 bg-zinc-900/10 hover:border-zinc-850"
                          }`}
                        >
                          {/* Header info */}
                          <div className="flex items-start justify-between border-b border-zinc-900 pb-3 mb-4">
                            <div>
                              <div className="flex items-center gap-2">
                                {isCoop && (
                                  <span className="bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded tracking-wider font-mono">
                                    CO-OP BUNDLE
                                  </span>
                                )}
                                <h3 className="text-xs font-bold text-white font-mono">{camp.campaignId}</h3>
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wider uppercase font-mono ${
                                  camp.status === "ELIGIBLE"
                                    ? "bg-emerald-950/50 text-emerald-400 border border-emerald-900/30"
                                    : "bg-zinc-900 text-zinc-500 border border-zinc-800"
                                }`}>
                                  {camp.status}
                                </span>
                              </div>
                              {isCoop && (
                                <p className="text-[9px] text-zinc-500 mt-1">
                                  Partners: <span className="text-zinc-400">{camp.partnerTenants.join(" & ")}</span>
                                </p>
                              )}
                            </div>
                            {!isEditing && (
                              <button
                                onClick={() => startEditingCampaign(camp)}
                                className="py-1 px-3 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800 text-[10px] font-bold rounded cursor-pointer transition-all active:scale-[0.98]"
                              >
                                EDIT DETAILS
                              </button>
                            )}
                          </div>

                          {/* If not editing, display read-only info */}
                          {!isEditing ? (
                            <div className="space-y-4">
                              {/* Stats */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <div className="bg-zinc-950/40 border border-zinc-900/80 rounded p-2.5">
                                  <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider font-mono">Impressions</div>
                                  <div className="text-sm font-extrabold text-zinc-200 mt-0.5 font-mono">{camp.impressions}</div>
                                </div>
                                <div className="bg-zinc-950/40 border border-zinc-900/80 rounded p-2.5">
                                  <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider font-mono">Clicks</div>
                                  <div className="text-sm font-extrabold text-zinc-200 mt-0.5 font-mono">{camp.clicks}</div>
                                </div>
                                <div className="bg-zinc-950/40 border border-zinc-900/80 rounded p-2.5">
                                  <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider font-mono">CTR</div>
                                  <div className="text-sm font-extrabold text-zinc-200 mt-0.5 font-mono">{ctr.toFixed(2)}%</div>
                                </div>
                                <div className="bg-zinc-950/40 border border-zinc-900/80 rounded p-2.5">
                                  <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider font-mono">Budget Spent</div>
                                  <div className="text-sm font-extrabold text-zinc-200 mt-0.5 font-mono">
                                    ${spent.toFixed(2)} <span className="text-[9px] text-zinc-500">/ ${camp.dailyBudget.toFixed(0)}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Campaign Details */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[11px] leading-relaxed">
                                <div>
                                  <span className="text-zinc-500 uppercase tracking-wider font-bold block mb-1">Targeting Criteria</span>
                                  <div className="space-y-1 font-mono">
                                    <div>Zones: <span className="text-zinc-300">{(camp.targetingCriteria.targetZones || []).join(", ")}</span></div>
                                    <div>Keywords: <span className="text-zinc-300">{(camp.targetingCriteria.audienceContextVectors || []).join(", ")}</span></div>
                                  </div>
                                </div>
                                <div>
                                  <span className="text-zinc-500 uppercase tracking-wider font-bold block mb-1">Max CPC Bid</span>
                                  <div className="text-zinc-200 font-extrabold font-mono text-xs">
                                    ${camp.maxBidPerClick.toFixed(2)}
                                  </div>
                                </div>
                              </div>

                              {/* Ad Creative Preview */}
                              <div className="border border-zinc-900 bg-zinc-950/30 rounded p-3 relative">
                                <span className="absolute -top-2 left-3 bg-zinc-950 px-1 text-[8px] text-zinc-500 font-bold tracking-wider uppercase font-mono">Ad Creative Preview</span>
                                <div className="space-y-1 mt-1">
                                  <h4 className="text-xs font-bold text-violet-300">{camp.creativeAsset.headline}</h4>
                                  <p className="text-[10px] text-zinc-400">{camp.creativeAsset.body}</p>
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* Edit Panel Form */
                            <div className="space-y-4 text-xs">
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Max Bid Per Click ($)</label>
                                  <input
                                    type="number"
                                    step="0.05"
                                    value={editMaxBid}
                                    onChange={(e) => setEditMaxBid(parseFloat(e.target.value))}
                                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-zinc-700 text-zinc-200 font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Daily Budget ($)</label>
                                  <input
                                    type="number"
                                    step="10"
                                    value={editDailyBudget}
                                    onChange={(e) => setEditDailyBudget(parseFloat(e.target.value))}
                                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-zinc-700 text-zinc-200 font-mono"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Target Zones (Comma Separated)</label>
                                  <input
                                    type="text"
                                    value={editZones}
                                    onChange={(e) => setEditZones(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-zinc-700 text-zinc-200 font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Status</label>
                                  <select
                                    value={editStatus}
                                    onChange={(e) => setEditStatus(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-zinc-700 text-zinc-200 font-mono cursor-pointer"
                                  >
                                    <option value="ELIGIBLE">ELIGIBLE</option>
                                    <option value="PAUSED">PAUSED</option>
                                  </select>
                                </div>
                              </div>

                              <div>
                                <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Targeting Keywords / Context Vectors (Comma Separated)</label>
                                <input
                                  type="text"
                                  value={editKeywords}
                                  onChange={(e) => setEditKeywords(e.target.value)}
                                  className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-zinc-700 text-zinc-200 font-mono"
                                />
                              </div>

                              <div className="grid grid-cols-1 gap-2 pt-2 border-t border-zinc-900">
                                <div>
                                  <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Creative Headline</label>
                                  <input
                                    type="text"
                                    value={editHeadline}
                                    onChange={(e) => setEditHeadline(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                                  />
                                </div>
                                <div>
                                  <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Creative Body Copy</label>
                                  <textarea
                                    value={editBody}
                                    onChange={(e) => setEditBody(e.target.value)}
                                    rows={2}
                                    className="w-full px-2.5 py-1.5 rounded bg-zinc-950 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                                  />
                                </div>
                              </div>

                              <div className="flex justify-end gap-2 pt-3">
                                <button
                                  type="button"
                                  onClick={() => setEditingCampaignId(null)}
                                  className="py-1.5 px-4 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/30 hover:bg-zinc-900 text-zinc-400 text-[10px] font-bold rounded cursor-pointer transition-all active:scale-[0.98]"
                                >
                                  CANCEL
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCampaignUpdate(camp.campaignId)}
                                  className="py-1.5 px-4 border border-violet-650 hover:border-violet-500 bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 text-[10px] font-bold rounded cursor-pointer transition-all active:scale-[0.98]"
                                >
                                  SAVE CHANGES
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: JOINT CO-OP DEAL CREATOR */}
              <div className="space-y-6">
                <section className="border border-zinc-900 bg-zinc-900/10 rounded-lg p-5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200 border-b border-zinc-900 pb-2 mb-4">
                    Co-Opetition Deal Builder
                  </h3>
                  <form onSubmit={handleCreateJointCampaign} className="space-y-4 text-xs">
                    <div>
                      <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Joint Campaign ID</label>
                      <input
                        type="text"
                        placeholder="e.g. camp_coop_nike_redbull"
                        value={jointCampaignId}
                        onChange={(e) => setJointCampaignId(e.target.value)}
                        className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-2">Select Partner Tenants (Min 2)</label>
                      <div className="space-y-1.5 font-mono">
                        {[
                          { id: "nike_official", name: "Nike Official" },
                          { id: "starbucks_official", name: "Starbucks Official" },
                          { id: "redbull_official", name: "Red Bull Official" },
                          { id: "fifa_souvenirs", name: "FIFA Souvenirs" }
                        ].map((t) => {
                          const isChecked = jointPartners.includes(t.id);
                          return (
                            <label key={t.id} className="flex items-center space-x-2 text-zinc-300 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setJointPartners(jointPartners.filter((p) => p !== t.id));
                                  } else {
                                    setJointPartners([...jointPartners, t.id]);
                                  }
                                }}
                                className="rounded bg-zinc-950 border-zinc-850 text-violet-500 focus:ring-0 cursor-pointer"
                              />
                              <span>{t.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Max CPC Bid ($)</label>
                        <input
                          type="number"
                          step="0.05"
                          value={jointMaxBid}
                          onChange={(e) => setJointMaxBid(parseFloat(e.target.value))}
                          className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Daily Budget ($)</label>
                        <input
                          type="number"
                          step="10"
                          value={jointDailyBudget}
                          onChange={(e) => setJointDailyBudget(parseFloat(e.target.value))}
                          className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Target Zones (Comma Separated)</label>
                        <input
                          type="text"
                          value={jointZones}
                          onChange={(e) => setJointZones(e.target.value)}
                          className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Targeting Keywords</label>
                        <input
                          type="text"
                          placeholder="e.g. exhausted, energy"
                          value={jointKeywords}
                          onChange={(e) => setJointKeywords(e.target.value)}
                          className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200 font-mono"
                        />
                      </div>
                    </div>

                    <div className="pt-2 border-t border-zinc-900 font-sans">
                      <div>
                        <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Joint Headline</label>
                        <input
                          type="text"
                          placeholder="Headline copy..."
                          value={jointHeadline}
                          onChange={(e) => setJointHeadline(e.target.value)}
                          className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200"
                        />
                      </div>
                      <div className="mt-2">
                        <label className="block text-zinc-500 font-bold uppercase tracking-wider text-[9px] mb-1">Joint Body Copy</label>
                        <textarea
                          placeholder="Bundle discount offer body copy..."
                          value={jointBody}
                          onChange={(e) => setJointBody(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 rounded bg-zinc-950/75 border border-zinc-850 focus:outline-none focus:border-violet-500 text-zinc-200"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 border border-violet-650 hover:border-violet-500 bg-violet-600/10 hover:bg-violet-600/25 text-violet-300 text-xs font-bold rounded cursor-pointer transition-all active:scale-[0.98]"
                    >
                      ESTABLISH JOINT CAMPAIGN DEAL
                    </button>
                  </form>
                </section>

                <section className="border border-zinc-900 bg-zinc-900/10 rounded-lg p-5 text-[11px] leading-relaxed text-zinc-400 space-y-2">
                  <span className="font-bold text-zinc-200 uppercase block tracking-wider text-[9px] mb-2 font-mono">⚡ How Joint Billing Works</span>
                  <p>
                    Programmatic RMN Vickrey Settlement splits the billed CPC cost equally between all participating partner campaigns.
                  </p>
                  <p>
                    For example, if the winning co-op ad CPC is settled at $1.50, then $0.75 is atomically deducted from both partner merchant's primary campaign budgets.
                  </p>
                  <p>
                    This stimulates cross-tenant co-opetitive marketing, bringing down single-merchant customer acquisition costs while preserving campaign margins.
                  </p>
                </section>
              </div>
            </div>
          </main>
        );
      })()}

      {/* FOOTER */}
      <footer className="shrink-0 h-8 bg-zinc-950 border-t border-zinc-900 px-6 flex items-center justify-between text-[10px] text-zinc-600 select-none font-mono">
        <span>MONGO_2DSPHERE // PIPELINE ACTIVE</span>
        <div className="flex items-center space-x-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>CONNECTED</span>
        </div>
      </footer>

    </div>
  );
}
