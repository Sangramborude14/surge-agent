# Tourist Surge Real-Time AI Retail Agent

A production-ready hackathon prototype for a **Dynamic "Tourist Surge" Retail Agent** designed for the 2026 World Cup, running on the Google Antigravity 2.0 platform.

This system simulates live crowd-density updates at a mall, queries a local MongoDB database to identify nearby stores using geospatial `$near` queries, detects inventory surplus, and triggers an autonomous AI retail optimizer to generate flash promotions in real-time.

---

## 📂 Project Structure

```
surge-agent/
├── backend/
│   ├── dummy_google_antigravity/  # Local mock SDK package for version resolution
│   ├── .env                       # Backend configurations
│   ├── requirements.txt           # Python dependencies
│   ├── db.py                      # MongoDB connection & 2dsphere index initializer
│   ├── seed.py                    # Storefront mock data seeding script
│   ├── agent.py                   # Core retail optimizer using google.antigravity SDK
│   ├── main.py                    # FastAPI server exposing REST endpoints
│   └── poll_crowd.py              # Background crowd density scanner simulation
└── frontend/
    ├── package.json
    ├── tailwind.config.js
    └── src/
        └── app/
            ├── layout.tsx         # Next.js global layout
            ├── globals.css        # Global CSS stylesheet
            └── page.tsx           # Sleek dark-mode Commander Dashboard UI
```

---

## 🚀 Core Features

- **Geospatial Location Matching**: Uses MongoDB `2dsphere` indexes and `$near` queries to match scanning coordinates with storefront coordinates.
- **AI-Driven Flash Promotions**: Integrates the `google.antigravity` SDK to generate marketing copy and structured promotional codes matching Pydantic schemas. Includes a resilient local fallback in `agent.py` to guarantee demo uptime.
- **Simple & Sleek Dashboard**: Designed with a premium, minimalist zinc dark-mode theme:
  - **Left**: Interactive Mall Floor Map with Zone A & B simulation buttons and Database Reset.
  - **Center**: System Console Terminal rendering color-coded logs showing real-time pipeline events.
  - **Right**: Active Signage Promo Deck rendering coupons, barcodes, ticking countdown timers, and live stock countdown trackers.
- **Automated Background Scanner**: `poll_crowd.py` simulates real-time crowds scanning different wings of the mall every 10 seconds.
- **Offline Emulation Mode**: The frontend dashboard operates in a mock-data emulator loop if the FastAPI backend server is offline, showing fully simulated radar sweeps, stock decrements, and coupon deployments.

---

## ⚙️ Setup & Startup

### 1. Database Seeding
Ensure your local MongoDB instance is running on port `27017`. Run the seed script to create the collection, index, and storefront data:
```bash
python backend/seed.py
```

### 2. Start Backend Service
From the root workspace, launch the FastAPI server:
```bash
cd backend
python main.py
```
*The API is now running on `http://localhost:8000`.*

### 3. Start Background Crowd Scanner (Scheduled Simulator)
In a separate terminal, launch the simulator script to feed mock crowd locations to the database:
```bash
cd backend
python poll_crowd.py
```

### 4. Start Frontend Dashboard
Navigate to the `frontend/` directory, install packages, and launch Next.js:
```bash
cd frontend
npm install
npm run dev
```
*Open **`http://localhost:3000`** in your browser to view the live dashboard.*

---

## ☁️ Deployment Readiness

This codebase is configured for cloud deployment (e.g. Render/Heroku for backend, Vercel for frontend):
1. **FastAPI**: Reads `PORT` from environment variables, defaulting to port `8000`, and binds to `0.0.0.0` for host routing.
2. **MongoDB**: Reads the connection string via `MONGODB_URI` from the environment.
3. **Next.js**: Reads the backend endpoint via `NEXT_PUBLIC_API_URL` from the environment (defaulting to `http://localhost:8000`). Simply set this variable to your deployed API URL when deploying the frontend.