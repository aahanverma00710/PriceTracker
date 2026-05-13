# 📉 Price Tracker

Track prices on Amazon, Flipkart, Nykaa, Myntra, Meesho, Sephora & SSBeauty.
Get notified by email (per product) when prices drop below your threshold.

---

## 🖥️ Run locally

```bash
# 1. Install deps
cd server && npm install && cd ..
cd frontend && npm install && cd ..

# 2. Create server env file
cp .env.example server/.env
# Edit server/.env with your Gmail credentials

# 3. Start both
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3001

---

## 🚀 Deploy to production (free)

### Stack
| What | Platform | Cost |
|------|----------|------|
| Backend (Express) | Railway | ~free ($5 credits/mo) |
| Frontend (React) | Vercel | Free forever |
| Scheduling + keep-alive | cron-job.org | Free forever |

---

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/price-tracker.git
git push -u origin main
```

---

### Step 2 — Deploy backend on Railway

1. Go to railway.app → New Project → Deploy from GitHub
2. Select your repo
3. Click the service → Settings:
   - Root Directory: `server`
   - Start Command: `node index.js`
4. Go to Variables tab, add:
   ```
   EMAIL_USER   = your@gmail.com
   EMAIL_PASS   = your_gmail_app_password
   EMAIL_TO     = your@gmail.com
   NODE_ENV     = production
   ```
5. Deploy → copy your Railway URL (e.g. https://price-tracker-xxx.up.railway.app)

---

### Step 3 — Deploy frontend on Vercel

1. Go to vercel.com → New Project → import your repo
2. Settings:
   - Root Directory: `frontend`
   - Framework: Vite
3. Add environment variable:
   ```
   VITE_API_URL = https://price-tracker-xxx.up.railway.app/api
   ```
4. Deploy → your app is live 🎉

---

### Step 4 — Set up cron-job.org (keeps server alive + triggers checks)

1. Go to cron-job.org → sign up free
2. Create Job 1 — keep alive:
   ```
   URL:      https://price-tracker-xxx.up.railway.app/ping
   Method:   GET
   Schedule: Every 10 minutes
   ```
3. Create Job 2 — price checks:
   ```
   URL:      https://price-tracker-xxx.up.railway.app/api/check
   Method:   POST
   Schedule: Every 6 hours
   ```

Done! Server never sleeps, prices checked automatically.

---

## 📧 Gmail App Password

1. myaccount.google.com → Security → 2-Step Verification → App Passwords
2. Create new → copy the 16-char password → use as EMAIL_PASS
