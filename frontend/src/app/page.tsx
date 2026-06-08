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

const API_BASE = "http://localhost:8000";

// Mock data for offline mode
const INITIAL_MOCK_STORES: Store[] = [
  {
    name: "World Cup Athletics",
    location: { type: "Point", coordinates: [121.501, 31.240] },
    item: "World Cup Jersey",
    current_stock: 150,
    target_stock: 20
  },
  {
    name: "Fan Zone Goods",
    location: { type: "Point", coordinates: [121.502, 31.241] },
    item: "Mascot Cap",
    current_stock: 80,
    target_stock: 10
  },
  {
    name: "Champions Souvenirs",
    location: { type: "Point", coordinates: [121.515, 31.245] },
    item: "Tournament Soccer Ball",
    current_stock: 120,
    target_stock: 30
  },
  {
    name: "Stadium Snacks & Gear",
    location: { type: "Point", coordinates: [121.516, 31.246] },
    item: "Reusable Water Bottle",
    current_stock: 60,
    target_stock: 15
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

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // local mock DB for offline fallback
  const mockStoresRef = useRef<Store[]>(JSON.parse(JSON.stringify(INITIAL_MOCK_STORES)));
  const mockPromotionsRef = useRef<Promotion[]>([]);
  const mockLogsRef = useRef<LogEntry[]>([
    {
      timestamp: new Date().toISOString(),
      message: "SYSTEM INIT: Dashboard initialized. Ready for simulation."
    }
  ]);

  // Update clock & countdown ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
      setSystemTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Scroll terminal to bottom when logs update
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Main Fetch Loop: Sync with backend or run mock fallback
  useEffect(() => {
    let active = true;

    async function syncData() {
      try {
        // Test backend connectivity & fetch stores
        const resStores = await fetch(`${API_BASE}/api/stores`);
        if (!resStores.ok) throw new Error("Stores API failed");
        const storesData = await resStores.json();

        // Fetch promotions
        const resPromos = await fetch(`${API_BASE}/api/promotions`);
        if (!resPromos.ok) throw new Error("Promotions API failed");
        const promosData = await resPromos.json();

        // Fetch logs
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
        // Fall back to mock databases
        if (active) {
          setBackendOnline(false);
          setStores([...mockStoresRef.current]);
          
          // filter expired mock promotions
          const now = Date.now();
          const filteredPromos = mockPromotionsRef.current.filter(promo => {
            const start = new Date(promo.timestamp).getTime();
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

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`);
        }
        
        // Immediate sync after successful trigger
        const data = await response.json();
        setPromotions(data.triggered_promotions);
        setLogs(data.logs);
      } catch (err: any) {
        console.error("Failed to post surge event:", err);
        addLocalLog(`[ERROR] Direct surge POST failed: ${err.message}. Reverting to local simulation.`);
      }
    } else {
      // Execute offline simulation behavior
      addLocalLog(`[SURGE_REQ] Manual surge triggered for ${zone} at coordinates [${coords[0]}, ${coords[1]}]`);
      addLocalLog(`[GEOSPATIAL] Geospatial Query: searching within 500m radius of [${coords[0]}, ${coords[1]}]`);

      // Find stores inside the simulated zone
      // Zone A: World Cup Athletics & Fan Zone Goods
      // Zone B: Champions Souvenirs & Stadium Snacks & Gear
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
          
          // Generate simulated promo
          const discount = [15, 20, 25, 30, 40, 50][Math.floor(Math.random() * 6)];
          const cleanName = store.name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
          const discountCode = `MOCK-SURGE-${discount}-${cleanName.substring(0, 4)}`;
          const promoMsg = `⚡ FLASH SALE: Take ${discount}% OFF all '${store.item}' at ${store.name}! Limited stock!`;
          const duration = 15; // 15 minutes
          
          addLocalLog(`[AGENT] Invoke agent: Generating promotion for ${store.name}...`);
          addLocalLog(`[AGENT] Promotion generated in 0.4281s: code=${discountCode}`);

          // Decrement stock in mock database
          const dec = Math.floor(Math.random() * 6) + 5; // 5-10
          const oldStock = store.current_stock;
          store.current_stock = Math.max(0, store.current_stock - dec);
          
          addLocalLog(`[ACTION] Stock decremented for '${store.name}': ${oldStock} -> ${store.current_stock} (-${dec})`);

          // Add to local mock active promotions
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

    // Reset scanner animation after 3.5 seconds
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
          // Sync immediately
          const resStores = await fetch(`${API_BASE}/api/stores`);
          const storesData = await resStores.json();
          setStores(storesData);
        }
      } catch (err) {
        console.error("Failed to seed database:", err);
      }
    } else {
      // Reset mock data
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

  // Filter logs based on search query
  const filteredLogs = useMemo(() => {
    if (!logFilter.trim()) return logs;
    const q = logFilter.toLowerCase();
    return logs.filter(l => l.message.toLowerCase().includes(q) || l.timestamp.includes(q));
  }, [logs, logFilter]);

  // Parse logs to render colored badges
  const renderLogLine = (log: LogEntry, index: number) => {
    let content = log.message;
    let badge = null;
    let badgeColor = "bg-slate-800 text-slate-400";

    const regex = /^\[([A-Z_]+)\]\s*(.*)$/;
    const match = content.match(regex);

    if (match) {
      const type = match[1];
      content = match[2];
      badge = type;

      switch (type) {
        case "SURGE_REQ":
        case "Surge Request":
          badgeColor = "bg-cyan-950 text-cyan-400 border border-cyan-500/20";
          break;
        case "GEOSPATIAL":
        case "Geospatial Query":
          badgeColor = "bg-purple-950 text-purple-400 border border-purple-500/20";
          break;
        case "INVENTORY":
          badgeColor = "bg-amber-950 text-amber-400 border border-amber-500/20";
          break;
        case "AGENT":
          badgeColor = "bg-emerald-950 text-emerald-400 border border-emerald-500/20";
          break;
        case "ACTION":
        case "Stock decremented":
          badgeColor = "bg-rose-950 text-rose-400 border border-rose-500/20";
          break;
        case "SYSTEM":
        case "ERROR":
          badgeColor = "bg-slate-900 text-red-400 border border-red-500/20";
          break;
      }
    } else {
      // Backend logs might use slightly different tags or literal strings, let's catch standard text
      if (content.includes("Surge Request:")) {
        badge = "SURGE_REQ";
        badgeColor = "bg-cyan-950 text-cyan-400 border border-cyan-500/20";
      } else if (content.includes("Geospatial Query:")) {
        badge = "GEOSPATIAL";
        badgeColor = "bg-purple-950 text-purple-400 border border-purple-500/20";
      } else if (content.includes("surplus detected:")) {
        badge = "INVENTORY";
        badgeColor = "bg-amber-950 text-amber-400 border border-amber-500/20";
      } else if (content.includes("Agent promotion generated")) {
        badge = "AGENT";
        badgeColor = "bg-emerald-950 text-emerald-400 border border-emerald-500/20";
      } else if (content.includes("Stock decremented")) {
        badge = "ACTION";
        badgeColor = "bg-rose-950 text-rose-400 border border-rose-500/20";
      } else if (content.includes("Database") || content.includes("startup")) {
        badge = "SYSTEM";
        badgeColor = "bg-slate-800 text-slate-300 border border-slate-700/50";
      }
    }

    const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour12: false });

    return (
      <div key={index} className="py-1 border-b border-slate-950 hover:bg-slate-900/40 transition-colors flex items-start gap-2 text-[12px] font-mono leading-relaxed">
        <span className="text-slate-500 shrink-0 font-medium select-none">{timeStr}</span>
        {badge && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 tracking-wider uppercase ${badgeColor}`}>
            {badge}
          </span>
        )}
        <span className="text-slate-300 break-words flex-1">{content}</span>
      </div>
    );
  };

  // Find store by name
  const getStoreForPromo = (promo: Promotion) => {
    return stores.find(s => s.name.toLowerCase() === promo.store_name.toLowerCase());
  };

  // Calculate promotion countdowns
  const getRemainingSeconds = (promo: Promotion) => {
    const start = new Date(promo.timestamp).getTime();
    const durationMs = promo.duration_minutes * 60 * 1000;
    const elapsed = Date.now() - start;
    const remaining = Math.max(0, Math.floor((durationMs - elapsed) / 1000));
    return remaining;
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-mono selection:bg-cyan-500/30">
      
      {/* HEADER SECTION */}
      <header className="shrink-0 flex items-center justify-between border-b border-slate-800 bg-slate-900/50 backdrop-blur-md px-6 py-4 relative">
        {/* Neon top line accent */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-500 via-emerald-500 to-indigo-500" />
        
        <div className="flex items-center space-x-3">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
          </div>
          <div>
            <h1 className="text-lg font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-emerald-400">
              SURGE-COMMANDER // v1.2
            </h1>
            <p className="text-[10px] text-slate-400 tracking-wider">
              REAL-TIME GEOSPATIAL PROMOTION AGENT DISPATCH
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Status Indicators */}
          <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border text-[11px] font-semibold tracking-wider transition-all duration-300 ${
            backendOnline 
              ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-400" 
              : "bg-amber-950/40 border-amber-500/30 text-amber-400"
          }`}>
            <span className={`h-2 w-2 rounded-full ${backendOnline ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"}`} />
            <span>{backendOnline ? "LIVE CORE ONLINE" : "OFFLINE DEMO EMULATION"}</span>
          </div>

          {/* Clock */}
          <div className="hidden sm:flex flex-col items-end px-3 py-1 border border-slate-800 bg-slate-950 rounded text-[11px] text-cyan-400 tracking-widest font-mono">
            <span className="text-slate-500 text-[8px] uppercase tracking-wider font-semibold">COMMAND TIME</span>
            {systemTime || "00:00:00"}
          </div>
        </div>
      </header>

      {/* DASHBOARD COLUMNS */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 overflow-hidden bg-slate-950">
        
        {/* LEFT COLUMN: CONTROL PANEL & MAP */}
        <section className="flex flex-col border border-slate-800 bg-slate-900/25 rounded-lg overflow-hidden backdrop-blur-sm relative group">
          <div className="shrink-0 bg-slate-900/80 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <h2 className="text-xs font-bold uppercase tracking-widest text-cyan-400">
                Geospatial Mall Map
              </h2>
            </div>
            {isSimulating && (
              <span className="text-[10px] text-emerald-400 font-semibold animate-pulse tracking-widest">
                SCANNING...
              </span>
            )}
          </div>

          <div className="flex-1 p-4 flex flex-col justify-between overflow-y-auto">
            {/* SVG Mall Layout Grid */}
            <div className="relative border border-slate-800 rounded bg-slate-950/80 p-2 flex items-center justify-center overflow-hidden aspect-[4/3] max-h-[300px] lg:max-h-[360px]">
              
              {/* Dynamic Scanning Radar Overlays */}
              {isSimulating && activeZone === "A" && (
                <div className="absolute left-[25%] top-[50%] -translate-x-1/2 -translate-y-1/2 w-48 h-48 pointer-events-none">
                  <div className="absolute inset-0 rounded-full border-2 border-cyan-500/40 animate-[ping_1.5s_infinite]" />
                  <div className="absolute inset-4 rounded-full border border-cyan-400/30 animate-[ping_1.8s_infinite]" />
                  <div className="absolute inset-0 rounded-full bg-cyan-500/5 animate-pulse" />
                </div>
              )}

              {isSimulating && activeZone === "B" && (
                <div className="absolute left-[75%] top-[55%] -translate-x-1/2 -translate-y-1/2 w-48 h-48 pointer-events-none">
                  <div className="absolute inset-0 rounded-full border-2 border-emerald-500/40 animate-[ping_1.5s_infinite]" />
                  <div className="absolute inset-4 rounded-full border border-emerald-400/30 animate-[ping_1.8s_infinite]" />
                  <div className="absolute inset-0 rounded-full bg-emerald-500/5 animate-pulse" />
                </div>
              )}

              {/* Mall Layout SVG */}
              <svg className="w-full h-full text-slate-700 font-mono" viewBox="0 0 400 300">
                {/* Background Grid Lines */}
                <defs>
                  <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(30, 41, 59, 0.5)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="400" height="300" fill="url(#grid)" />

                {/* Walkways */}
                <rect x="20" y="120" width="360" height="60" rx="4" fill="rgba(15, 23, 42, 0.8)" stroke="#1e293b" strokeWidth="1" />
                <rect x="180" y="30" width="40" height="240" rx="4" fill="rgba(15, 23, 42, 0.8)" stroke="#1e293b" strokeWidth="1" />

                {/* Central Plaza escalators */}
                <circle cx="200" cy="150" r="25" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="3,3" />
                <text x="200" y="153" fontSize="8" fill="#475569" textAnchor="middle" fontWeight="bold">PLAZA</text>

                {/* ZONE A Boundaries (West Wing) */}
                <rect 
                  x="25" y="40" width="135" height="220" 
                  fill="none" 
                  stroke={activeZone === "A" ? "#06b6d4" : "#1e293b"} 
                  strokeWidth={activeZone === "A" ? "2" : "1"} 
                  strokeDasharray="4,4"
                  className="transition-all duration-300"
                />
                <text 
                  x="92" y="250" 
                  fontSize="10" 
                  fill={activeZone === "A" ? "#22d3ee" : "#475569"} 
                  textAnchor="middle" 
                  fontWeight="bold"
                  className="transition-colors duration-300"
                >
                  ZONE A // WEST SPORTS WING
                </text>

                {/* ZONE A - World Cup Athletics */}
                <g 
                  onClick={() => handleSimulateSurge("A")} 
                  className="cursor-pointer group/store"
                >
                  <rect 
                    x="35" y="60" width="55" height="45" rx="3" 
                    fill="rgba(8, 47, 73, 0.8)" 
                    stroke={activeZone === "A" ? "#22d3ee" : "#0284c7"} 
                    strokeWidth="1.5" 
                  />
                  <text x="62.5" y="80" fontSize="7" fill="#38bdf8" textAnchor="middle" fontWeight="bold">WORLD CUP</text>
                  <text x="62.5" y="90" fontSize="6" fill="#0284c7" textAnchor="middle">ATHLETICS</text>
                  <circle cx="62.5" cy="100" r="2.5" fill="#ef4444" />
                </g>

                {/* ZONE A - Fan Zone Goods */}
                <g 
                  onClick={() => handleSimulateSurge("A")} 
                  className="cursor-pointer group/store"
                >
                  <rect 
                    x="95" y="60" width="55" height="45" rx="3" 
                    fill="rgba(8, 47, 73, 0.8)" 
                    stroke={activeZone === "A" ? "#22d3ee" : "#0284c7"} 
                    strokeWidth="1.5" 
                  />
                  <text x="122.5" y="80" fontSize="7" fill="#38bdf8" textAnchor="middle" fontWeight="bold">FAN ZONE</text>
                  <text x="122.5" y="90" fontSize="6" fill="#0284c7" textAnchor="middle">GOODS</text>
                  <circle cx="122.5" cy="100" r="2.5" fill="#ef4444" />
                </g>

                {/* ZONE B Boundaries (East Wing) */}
                <rect 
                  x="240" y="40" width="135" height="220" 
                  fill="none" 
                  stroke={activeZone === "B" ? "#10b981" : "#1e293b"} 
                  strokeWidth={activeZone === "B" ? "2" : "1"} 
                  strokeDasharray="4,4"
                  className="transition-all duration-300"
                />
                <text 
                  x="307" y="250" 
                  fontSize="10" 
                  fill={activeZone === "B" ? "#34d399" : "#475569"} 
                  textAnchor="middle" 
                  fontWeight="bold"
                  className="transition-colors duration-300"
                >
                  ZONE B // EAST SOUVENIR WING
                </text>

                {/* ZONE B - Champions Souvenirs */}
                <g 
                  onClick={() => handleSimulateSurge("B")} 
                  className="cursor-pointer group/store"
                >
                  <rect 
                    x="250" y="190" width="55" height="45" rx="3" 
                    fill="rgba(6, 78, 59, 0.8)" 
                    stroke={activeZone === "B" ? "#34d399" : "#059669"} 
                    strokeWidth="1.5" 
                  />
                  <text x="277.5" y="210" fontSize="7" fill="#a7f3d0" textAnchor="middle" fontWeight="bold">CHAMPIONS</text>
                  <text x="277.5" y="220" fontSize="6" fill="#059669" textAnchor="middle">SOUVENIRS</text>
                  <circle cx="277.5" cy="200" r="2.5" fill="#ef4444" />
                </g>

                {/* ZONE B - Stadium Snacks & Gear */}
                <g 
                  onClick={() => handleSimulateSurge("B")} 
                  className="cursor-pointer group/store"
                >
                  <rect 
                    x="310" y="190" width="55" height="45" rx="3" 
                    fill="rgba(6, 78, 59, 0.8)" 
                    stroke={activeZone === "B" ? "#34d399" : "#059669"} 
                    strokeWidth="1.5" 
                  />
                  <text x="337.5" y="210" fontSize="7" fill="#a7f3d0" textAnchor="middle" fontWeight="bold">SNACKS &</text>
                  <text x="337.5" y="220" fontSize="6" fill="#059669" textAnchor="middle">GEAR</text>
                  <circle cx="337.5" cy="200" r="2.5" fill="#ef4444" />
                </g>

                {/* Decorative Elements */}
                <text x="20" y="25" fontSize="6" fill="#475569">ENTRANCE A</text>
                <text x="345" y="25" fontSize="6" fill="#475569">ENTRANCE B</text>
              </svg>
            </div>

            {/* Active Crowd Status */}
            <div className="mt-4 border border-slate-800 bg-slate-950/60 rounded p-3 text-[11px] space-y-2">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">ACTIVE SCAN METRICS</div>
              <div className="grid grid-cols-2 gap-2">
                <div className="border border-slate-800/80 p-1.5 rounded bg-slate-900/30">
                  <div className="text-[9px] text-slate-500 uppercase font-semibold">ZONE SCAN TARGET</div>
                  <div className={`font-mono text-xs font-bold ${activeZone ? "text-cyan-400" : "text-slate-400"}`}>
                    {activeZone ? `ZONE ${activeZone} ACTIVE` : "SYSTEM STANDBY"}
                  </div>
                </div>
                <div className="border border-slate-800/80 p-1.5 rounded bg-slate-900/30">
                  <div className="text-[9px] text-slate-500 uppercase font-semibold">SCAN COORDINATES</div>
                  <div className="font-mono text-xs font-bold text-slate-300">
                    {lastScanCoords ? `${lastScanCoords[0].toFixed(3)}, ${lastScanCoords[1].toFixed(3)}` : "STANDBY"}
                  </div>
                </div>
                <div className="border border-slate-800/80 p-1.5 rounded bg-slate-900/30">
                  <div className="text-[9px] text-slate-500 uppercase font-semibold">GEOSPATIAL RANGE</div>
                  <div className="font-mono text-xs font-bold text-slate-300">
                    {activeZone ? "500 METERS" : "0 METERS"}
                  </div>
                </div>
                <div className="border border-slate-800/80 p-1.5 rounded bg-slate-900/30">
                  <div className="text-[9px] text-slate-500 uppercase font-semibold">SCAN PULSE STATUS</div>
                  <div className={`font-mono text-xs font-bold ${isSimulating ? "text-emerald-400 animate-pulse" : "text-slate-500"}`}>
                    {isSimulating ? "EMITTING RADAR" : "IDLE"}
                  </div>
                </div>
              </div>
            </div>

            {/* Simulation Dispatchers */}
            <div className="mt-4 space-y-2.5">
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">SIMULATION CONTROLS</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleSimulateSurge("A")}
                  disabled={isSimulating}
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 border border-cyan-500/30 hover:border-cyan-400 bg-cyan-950/20 hover:bg-cyan-900/30 text-cyan-400 font-bold text-[11px] rounded transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                  </span>
                  <span>SURGE ZONE A</span>
                </button>
                <button
                  onClick={() => handleSimulateSurge("B")}
                  disabled={isSimulating}
                  className="flex items-center justify-center space-x-1.5 py-2 px-3 border border-emerald-500/30 hover:border-emerald-400 bg-emerald-950/20 hover:bg-emerald-900/30 text-emerald-400 font-bold text-[11px] rounded transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span>SURGE ZONE B</span>
                </button>
              </div>

              <button
                onClick={handleSeedDB}
                className="w-full flex items-center justify-center space-x-2 py-2 px-3 border border-slate-700 hover:border-slate-500 bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 font-semibold text-[11px] rounded transition-all cursor-pointer select-none active:scale-[0.98]"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.213 6h-3.07" />
                </svg>
                <span>RESET & RE-SEED DATABASE</span>
              </button>
            </div>
          </div>
        </section>

        {/* CENTER COLUMN: CONSOLE LOGS TERMINAL */}
        <section className="flex flex-col border border-slate-800 bg-slate-950 rounded-lg overflow-hidden group">
          <div className="shrink-0 bg-slate-900/80 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-4 w-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <h2 className="text-xs font-bold uppercase tracking-widest text-emerald-400 font-mono">
                System Console Terminal
              </h2>
            </div>
            <div className="flex h-2.5 items-center space-x-1">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>
          </div>

          {/* Filter Bar */}
          <div className="shrink-0 border-b border-slate-900 bg-slate-950 px-3 py-2">
            <div className="relative flex items-center">
              <span className="absolute left-2.5 text-slate-500 text-xs">$</span>
              <input
                type="text"
                placeholder="grep -i log_filter..."
                value={logFilter}
                onChange={e => setLogFilter(e.target.value)}
                className="w-full pl-6 pr-8 py-1.5 rounded bg-slate-900 border border-slate-800 focus:outline-none focus:border-cyan-500/50 text-[11px] text-slate-200 font-mono placeholder:text-slate-600 transition-colors"
              />
              {logFilter && (
                <button 
                  onClick={() => setLogFilter("")}
                  className="absolute right-2 text-slate-500 hover:text-slate-300 text-[10px] cursor-pointer"
                >
                  CLEAR
                </button>
              )}
            </div>
          </div>

          {/* Terminal Logs */}
          <div className="flex-1 p-4 overflow-y-auto bg-black flex flex-col justify-start">
            <div className="space-y-0.5">
              {filteredLogs.length === 0 ? (
                <div className="text-slate-600 text-[11px] font-mono italic p-2 text-center">
                  No matching log entries found inside buffer.
                </div>
              ) : (
                filteredLogs.map((log, idx) => renderLogLine(log, idx))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: DIGITAL SIGNAGE / PROMO DECK */}
        <section className="flex flex-col border border-slate-800 bg-slate-900/25 rounded-lg overflow-hidden backdrop-blur-sm group">
          <div className="shrink-0 bg-slate-900/80 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className="h-4 w-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
              <h2 className="text-xs font-bold uppercase tracking-widest text-purple-400">
                Digital Promo Signage
              </h2>
            </div>
            <span className="text-[10px] text-slate-500 font-semibold px-2 py-0.5 rounded bg-slate-850">
              ACTIVE CODES: {promotions.length}
            </span>
          </div>

          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {promotions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-slate-800 rounded bg-slate-950/20">
                <svg className="h-10 w-10 text-slate-700 mb-3 animate-[pulse_3s_infinite]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2zM9 16H5v4h4v-4zm0-8H5v4h4V8zm8 8h-4v4h4v-4zm0-8h-4v4h4V8z" />
                </svg>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  No Active Flash Sales
                </div>
                <p className="text-[10px] text-slate-600 mt-1 max-w-[200px]">
                  Simulate a crowd surge in Zone A or Zone B to deploy active promotions.
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

                // Color schemes based on stock criticality
                const isCritical = currentStock <= targetStock;
                const stockBarColor = isCritical 
                  ? "bg-rose-500 shadow-[0_0_8px_#f43f5e]" 
                  : currentStock <= targetStock + 20 
                    ? "bg-amber-500 shadow-[0_0_8px_#f59e0b]" 
                    : "bg-cyan-500 shadow-[0_0_8px_#06b6d4]";

                return (
                  <div 
                    key={promo.id} 
                    className="relative border border-slate-800 bg-slate-950/80 rounded-lg p-4 overflow-hidden shadow-2xl transition-all hover:border-slate-700/80 flex flex-col justify-between"
                  >
                    {/* Glowing card trim */}
                    <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-purple-500 to-indigo-500" />
                    
                    {/* Store Title & Badge */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">STOREFRONT DISPATCH</div>
                        <h3 className="text-sm font-bold text-white tracking-tight leading-tight">{promo.store_name}</h3>
                        <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Surplus Target: {promo.item}</p>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] px-1.5 py-0.5 font-bold tracking-widest bg-purple-950/60 border border-purple-500/30 text-purple-400 rounded">
                          FLASH
                        </span>
                        
                        {/* Countdown */}
                        <div className="flex items-center space-x-1 mt-1 text-[11px] font-mono font-bold text-slate-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                          <span>{formatCountdown(remainingSeconds)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Marketing Pitch Message */}
                    <div className="my-3 px-3 py-2 border-l-2 border-purple-500 bg-purple-950/20 text-[11px] text-slate-300 font-sans italic leading-relaxed">
                      "{promo.message}"
                    </div>

                    {/* Stock level indicators */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono font-semibold">
                        <span>STOCK SURPLUS RESOLUTION</span>
                        <span className={isCritical ? "text-rose-400 font-bold" : "text-slate-200"}>
                          {currentStock} UNITS / SAFE LEVEL: {targetStock}
                        </span>
                      </div>
                      <div className="relative h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                        {/* Marker for Target Safety Stock */}
                        <div 
                          className="absolute top-0 bottom-0 w-[2px] bg-red-600/80 z-10" 
                          style={{ left: `${safetyThresholdPercent}%` }}
                          title={`Safety target: ${targetStock} units`}
                        />
                        <div 
                          className={`h-full rounded-full transition-all duration-1000 ${stockBarColor}`}
                          style={{ width: `${currentStockPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Ticket Coupon Code Box */}
                    <div className="mt-4 relative border border-dashed border-slate-700 bg-slate-900/50 rounded p-3 flex flex-col items-center justify-center">
                      <div className="absolute top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-slate-950 border-r border-slate-800" />
                      <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-slate-950 border-l border-slate-800" />
                      
                      <div className="text-[8px] text-slate-500 font-bold uppercase tracking-widest">PROMOTION REDEMPTION CODE</div>
                      <div className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-amber-500 tracking-widest mt-0.5 select-all">
                        {promo.discount_code}
                      </div>
                    </div>

                    {/* High-Fidelity Barcode */}
                    <div className="flex items-center justify-between h-8 bg-white/5 px-2.5 rounded mt-3.5 border border-slate-800/40">
                      <div className="flex h-4 items-stretch space-x-[1px]">
                        {[1, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 1, 3, 2].map((w, i) => (
                          <span key={i} className="bg-slate-300" style={{ width: `${w}px` }} />
                        ))}
                      </div>
                      <span className="font-mono text-[9px] text-slate-500 tracking-wider">
                        SURGE-SCAN-ID: {promo.id.toUpperCase()}
                      </span>
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </section>

      </main>

      {/* FOOTER METRICS BAR */}
      <footer className="shrink-0 h-9 bg-slate-900 border-t border-slate-800 px-6 flex items-center justify-between text-[10px] text-slate-500 select-none">
        <div className="flex items-center space-x-4">
          <span>PIPELINE BUFFER: 200 LOGS MAX</span>
          <span>//</span>
          <span>TARGET LATENCY: &lt;500MS</span>
          <span>//</span>
          <span>GEOSPATIAL GRID INDEX: MONGO_2DSPHERE</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
          <span>SYSTEM RUNNING (PROPS SYNCED)</span>
        </div>
      </footer>

    </div>
  );
}
