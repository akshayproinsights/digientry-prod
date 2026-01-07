---
description: Start the Invoice Insights Hub application (Backend & Frontend)
---

# Start Invoice Insights Hub

## Backend (Terminal 1)

```powershell
cd backend
python -m uvicorn main:app --reload --port 8000
```

**Expected Output:**
```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [XXXX] using WatchFiles
INFO:     Started server process [XXXX]
INFO:     Application startup complete.
```

**Backend URL:** http://localhost:8000  
**API Docs:** http://localhost:8000/docs

---

## Frontend (Terminal 2 - New Terminal)

```powershell
cd frontend
npm run dev
```

**Expected Output:**
```
VITE v6.4.1  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

**Frontend URL:** http://localhost:5173 (or 5174 if 5173 is busy)

---

## Quick Start (One Command Each)

### Option 1: Two separate terminals (Recommended)
**Terminal 1 (Backend):**
```powershell
cd c:\Users\MSi\Documents\Superbase\backend && python -m uvicorn main:app --reload --port 8000
```

**Terminal 2 (Frontend):**
```powershell
cd c:\Users\MSi\Documents\Superbase\frontend && npm run dev
```

### Option 2: Single terminal with background process
```powershell
# Start backend in background
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd c:\Users\MSi\Documents\Superbase\backend; python -m uvicorn main:app --reload --port 8000"

# Start frontend (waits 3 seconds for backend)
Start-Sleep -Seconds 3
cd c:\Users\MSi\Documents\Superbase\frontend
npm run dev
```

---

## Stop Both Servers

**Press `CTRL+C` in each terminal window**

---

## Troubleshooting

### Port already in use
If you see "Port 8000 is already in use":
```powershell
# Kill process on port 8000
Get-Process -Id (Get-NetTCPConnection -LocalPort 8000).OwningProcess | Stop-Process -Force
```

### Frontend port busy
If Vite shows "Port 5173 is in use", it will automatically use 5174 or 5175.

---

## After Starting

1. **Open Browser:** http://localhost:5173
2. **Login:** Username: `adnak`
3. **Start Using!**