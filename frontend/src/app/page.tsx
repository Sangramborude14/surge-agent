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
  const [activeTab, setActiveTab] = useState<'operations' | 'shopping'>('operations');
  const [searchZoneA, setSearchZoneA] = useState<string>("");
  const [searchZoneB, setSearchZoneB] = useState<string>("");
  const [sentimentResultA, setSentimentResultA] = useState<any>(null);
  const [sentimentResultB, setSentimentResultB] = useState<any>(null);
  const [isSearchingA, setIsSearchingA] = useState<boolean>(false);
  const [isSearchingB, setIsSearchingB] = useState<boolean>(false);

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
      {activeTab === 'operations' ? (
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
      ) : (
        <main className="flex-1 flex flex-col p-5 overflow-y-auto space-y-5">
          {/* Main Simulator Header */}
          <div className="shrink-0 flex items-center justify-between border-b border-zinc-900 pb-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
                User Simulator Shopping Deck
              </h2>
              <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                Simulate consumer experience, browse real-time inventory, search by sentiment mood, and trigger transaction purchases.
              </p>
            </div>
            {backendOnline && (
              <span className="text-[10px] font-mono text-emerald-400 bg-zinc-900/40 px-2 py-0.5 rounded border border-emerald-950/20">
                LIVE DB TRANSACTIONS ACTIVE
              </span>
            )}
          </div>

          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-[500px]">
            {/* COLUMN 1: ZONE A SHOPPING (WEST WING) */}
            <div className="flex flex-col border border-zinc-900 bg-zinc-900/10 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                    Zone A Shopping // West Wing
                  </h3>
                </div>
                <span className="text-[9px] font-mono text-zinc-500">COORDINATES: [121.501, 31.240]</span>
              </div>

              {/* Search input Zone A */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Search Zone A or type mood (e.g. 'hot and tired')" 
                    value={searchZoneA}
                    onChange={e => setSearchZoneA(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearchSentiment("A")}
                    className="w-full px-3 py-2 text-xs rounded bg-zinc-950/70 border border-zinc-850 focus:outline-none focus:border-zinc-750 text-zinc-300 placeholder:text-zinc-650"
                  />
                  {searchZoneA && (
                    <button 
                      onClick={() => { setSearchZoneA(""); setSentimentResultA(null); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => handleSearchSentiment("A")}
                  disabled={isSearchingA || !searchZoneA.trim()}
                  className="px-4 py-2 border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-205 text-xs font-semibold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                >
                  {isSearchingA ? "Analyzing..." : "Search"}
                </button>
              </div>

              {/* Empathetic copy banner Zone A */}
              {sentimentResultA && (
                <div className="bg-purple-950/15 border border-purple-800/30 rounded p-3 text-[11px] text-purple-300 leading-relaxed shadow-sm relative overflow-hidden animate-[fadeIn_0.3s_ease]">
                  <div className="absolute top-0 left-0 bottom-0 w-[3px] bg-purple-500" />
                  <div className="font-bold text-[10px] uppercase tracking-wider text-purple-400 font-mono mb-1">Empathetic Target Campaign Offer</div>
                  "{sentimentResultA.empatheticMessage}"
                  {sentimentResultA.offer && (
                    <div className="mt-1.5 text-[10px] font-bold text-zinc-400">
                      Matched Offer: {sentimentResultA.offer.title} (+15% Sentiment Boost applied to category)
                    </div>
                  )}
                </div>
              )}

              {/* Shopping Cards Zone A */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(stores.length > 0 ? stores : INITIAL_MOCK_STORES)
                  .filter(s => s.name === "World Cup Athletics" || s.name === "Fan Zone Goods")
                  .filter(s => filterStoreByQuery(s, searchZoneA))
                  .sort((a, b) => {
                    if (searchZoneA.trim()) {
                      return (a.sales ?? 0) - (b.sales ?? 0);
                    }
                    return 0;
                  })
                  .map(store => {
                    const discounts = getCalculatedDiscount(store.name, store.item, "A");
                    const originalPrice = (store.wholesalePrice ?? 20) * 1.5;
                    const finalPrice = discounts.total > 0 
                      ? originalPrice * (1 - discounts.total / 100) 
                      : originalPrice;
                    const maxStock = store.name.includes("World Cup") ? 150 : store.name.includes("Champions") ? 120 : store.name.includes("Fan") ? 80 : 60;
                    const isCritical = store.current_stock <= store.target_stock;
                    
                    const currentStoresList = stores.length > 0 ? stores : INITIAL_MOCK_STORES;
                    const siblings = currentStoresList.filter(s => 
                      (store.category && s.category === store.category) ||
                      (store.brand && s.brand === store.brand)
                    );
                    const isLeastSales = searchZoneA.trim() !== "" && siblings.length > 0 && 
                      (store.sales ?? 0) === Math.min(...siblings.map(s => s.sales ?? 0));

                    return (
                      <div 
                        key={store.name + "-" + store.item} 
                        className="border border-zinc-900 bg-zinc-950/40 hover:border-zinc-850 p-4 rounded-md transition-all flex flex-col justify-between relative overflow-hidden"
                      >
                        {isLeastSales && (
                          <div className="absolute top-2 left-2 bg-amber-500/90 text-zinc-950 text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10 font-mono uppercase tracking-wider">
                            📉 Least Sales Focus
                          </div>
                        )}
                        {discounts.total > 0 && (
                          <div className="absolute top-2 right-2 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                            {discounts.total}% OFF
                          </div>
                        )}
                        
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase tracking-wider text-zinc-555 font-mono">
                            {store.name} {store.brand && `// ${store.brand.toUpperCase()}`}
                          </span>
                          <h4 className="text-xs font-bold text-zinc-200">{store.item}</h4>
                        </div>

                        <div className="mt-3 flex items-baseline space-x-2">
                          <span className="text-sm font-extrabold text-white">
                            ${finalPrice.toFixed(2)}
                          </span>
                          {discounts.total > 0 && (
                            <span className="text-[10px] text-zinc-655 line-through">
                              ${originalPrice.toFixed(2)}
                            </span>
                          )}
                        </div>

                        {(discounts.keywordBoost > 0 || discounts.sentimentBoost > 0 || discounts.leastSalesBoost > 0) && (
                          <div className="mt-2 flex flex-col gap-0.5 text-[8px] font-mono">
                            {discounts.keywordBoost > 0 && (
                              <span className="text-emerald-400">
                                +10% Keyword Match Boost
                              </span>
                            )}
                            {discounts.sentimentBoost > 0 && (
                              <span className="text-purple-400">
                                +15% Sentiment Target Boost
                              </span>
                            )}
                            {discounts.leastSalesBoost > 0 && (
                              <span className="text-amber-400">
                                +15% Least Sales Boost
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-4 space-y-1">
                          <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                            <span>STOCK STATUS</span>
                            <span className={isCritical ? "text-rose-400 font-semibold" : "text-zinc-350"}>
                              {store.current_stock} / {maxStock}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${isCritical ? "bg-rose-500/80" : "bg-emerald-500/80"} transition-all duration-300`} 
                              style={{ width: `${Math.min(100, (store.current_stock / maxStock) * 100)}%` }}
                            />
                          </div>
                        </div>

                        <button 
                          onClick={() => handleBuyItem(store.name, store.item)}
                          disabled={store.current_stock <= 0}
                          className="mt-4 w-full py-1.5 px-3 border border-zinc-805 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-850 text-zinc-200 text-[10px] font-semibold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                        >
                          {store.current_stock <= 0 ? "OUT OF STOCK" : "BUY ITEM"}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* COLUMN 2: ZONE B SHOPPING (EAST WING) */}
            <div className="flex flex-col border border-zinc-900 bg-zinc-900/10 rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                <div className="flex items-center space-x-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                    Zone B Shopping // East Wing
                  </h3>
                </div>
                <span className="text-[9px] font-mono text-zinc-500">COORDINATES: [121.515, 31.245]</span>
              </div>

              {/* Search input Zone B */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input 
                    type="text" 
                    placeholder="Search Zone B or type mood (e.g. 'hot and tired')" 
                    value={searchZoneB}
                    onChange={e => setSearchZoneB(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearchSentiment("B")}
                    className="w-full px-3 py-2 text-xs rounded bg-zinc-950/70 border border-zinc-850 focus:outline-none focus:border-zinc-750 text-zinc-300 placeholder:text-zinc-650"
                  />
                  {searchZoneB && (
                    <button 
                      onClick={() => { setSearchZoneB(""); setSentimentResultB(null); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => handleSearchSentiment("B")}
                  disabled={isSearchingB || !searchZoneB.trim()}
                  className="px-4 py-2 border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-205 text-xs font-semibold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                >
                  {isSearchingB ? "Analyzing..." : "Search"}
                </button>
              </div>

              {/* Empathetic copy banner Zone B */}
              {sentimentResultB && (
                <div className="bg-purple-950/15 border border-purple-800/30 rounded p-3 text-[11px] text-purple-300 leading-relaxed shadow-sm relative overflow-hidden animate-[fadeIn_0.3s_ease]">
                  <div className="absolute top-0 left-0 bottom-0 w-[3px] bg-purple-500" />
                  <div className="font-bold text-[10px] uppercase tracking-wider text-purple-400 font-mono mb-1">Empathetic Target Campaign Offer</div>
                  "{sentimentResultB.empatheticMessage}"
                  {sentimentResultB.offer && (
                    <div className="mt-1.5 text-[10px] font-bold text-zinc-400">
                      Matched Offer: {sentimentResultB.offer.title} (+15% Sentiment Boost applied to category)
                    </div>
                  )}
                </div>
              )}

              {/* Shopping Cards Zone B */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(stores.length > 0 ? stores : INITIAL_MOCK_STORES)
                  .filter(s => s.name === "Champions Souvenirs" || s.name === "Stadium Snacks & Gear")
                  .filter(s => filterStoreByQuery(s, searchZoneB))
                  .sort((a, b) => {
                    if (searchZoneB.trim()) {
                      return (a.sales ?? 0) - (b.sales ?? 0);
                    }
                    return 0;
                  })
                  .map(store => {
                    const discounts = getCalculatedDiscount(store.name, store.item, "B");
                    const originalPrice = (store.wholesalePrice ?? 20) * 1.5;
                    const finalPrice = discounts.total > 0 
                      ? originalPrice * (1 - discounts.total / 100) 
                      : originalPrice;
                    const maxStock = store.name.includes("World Cup") ? 150 : store.name.includes("Champions") ? 120 : store.name.includes("Fan") ? 80 : 60;
                    const isCritical = store.current_stock <= store.target_stock;
                    
                    const currentStoresList = stores.length > 0 ? stores : INITIAL_MOCK_STORES;
                    const siblings = currentStoresList.filter(s => 
                      (store.category && s.category === store.category) ||
                      (store.brand && s.brand === store.brand)
                    );
                    const isLeastSales = searchZoneB.trim() !== "" && siblings.length > 0 && 
                      (store.sales ?? 0) === Math.min(...siblings.map(s => s.sales ?? 0));

                    return (
                      <div 
                        key={store.name + "-" + store.item} 
                        className="border border-zinc-900 bg-zinc-950/40 hover:border-zinc-850 p-4 rounded-md transition-all flex flex-col justify-between relative overflow-hidden"
                      >
                        {isLeastSales && (
                          <div className="absolute top-2 left-2 bg-amber-500/90 text-zinc-950 text-[8px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10 font-mono uppercase tracking-wider">
                            📉 Least Sales Focus
                          </div>
                        )}
                        {discounts.total > 0 && (
                          <div className="absolute top-2 right-2 bg-rose-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm z-10">
                            {discounts.total}% OFF
                          </div>
                        )}
                        
                        <div className="space-y-1">
                          <span className="text-[9px] uppercase tracking-wider text-zinc-555 font-mono">
                            {store.name} {store.brand && `// ${store.brand.toUpperCase()}`}
                          </span>
                          <h4 className="text-xs font-bold text-zinc-200">{store.item}</h4>
                        </div>

                        <div className="mt-3 flex items-baseline space-x-2">
                          <span className="text-sm font-extrabold text-white">
                            ${finalPrice.toFixed(2)}
                          </span>
                          {discounts.total > 0 && (
                            <span className="text-[10px] text-zinc-650 line-through">
                              ${originalPrice.toFixed(2)}
                            </span>
                          )}
                        </div>

                        {(discounts.keywordBoost > 0 || discounts.sentimentBoost > 0 || discounts.leastSalesBoost > 0) && (
                          <div className="mt-2 flex flex-col gap-0.5 text-[8px] font-mono">
                            {discounts.keywordBoost > 0 && (
                              <span className="text-emerald-400">
                                +10% Keyword Match Boost
                              </span>
                            )}
                            {discounts.sentimentBoost > 0 && (
                              <span className="text-purple-400">
                                +15% Sentiment Target Boost
                              </span>
                            )}
                            {discounts.leastSalesBoost > 0 && (
                              <span className="text-amber-400">
                                +15% Least Sales Boost
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-4 space-y-1">
                          <div className="flex justify-between text-[9px] font-mono text-zinc-500">
                            <span>STOCK STATUS</span>
                            <span className={isCritical ? "text-rose-400 font-semibold" : "text-zinc-350"}>
                              {store.current_stock} / {maxStock}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${isCritical ? "bg-rose-500/80" : "bg-emerald-500/80"} transition-all duration-300`} 
                              style={{ width: `${Math.min(100, (store.current_stock / maxStock) * 100)}%` }}
                            />
                          </div>
                        </div>

                        <button 
                          onClick={() => handleBuyItem(store.name, store.item)}
                          disabled={store.current_stock <= 0}
                          className="mt-4 w-full py-1.5 px-3 border border-zinc-805 hover:border-zinc-700 bg-zinc-900/60 hover:bg-zinc-850 text-zinc-200 text-[10px] font-semibold rounded cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                        >
                          {store.current_stock <= 0 ? "OUT OF STOCK" : "BUY ITEM"}
                        </button>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </main>
      )}

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
