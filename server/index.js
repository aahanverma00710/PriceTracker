require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

let puppeteer;
try {
  const puppeteerExtra = require("puppeteer-extra");
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  puppeteerExtra.use(StealthPlugin());
  puppeteer = puppeteerExtra;
} catch {
  try { puppeteer = require("puppeteer"); } catch { /* optional */ }
}

// Use real installed Chrome if available — much harder for sites to detect
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
];
const systemChrome = CHROME_PATHS.find(p => { try { return fs.existsSync(p); } catch { return false; } });

function launchBrowser() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH ||
    systemChrome ||
    '/usr/bin/chromium-browser' ||
    '/usr/bin/chromium';
  const opts = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--single-process",
      "--no-zygote",
    ],
  };
  if (executablePath && fs.existsSync(executablePath)) {
    opts.executablePath = executablePath;
  }
  return puppeteer.launch(opts);
}

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, "db.json");

// --------------- Simple JSON "database" ---------------
function readDB() {
  if (!fs.existsSync(DB_PATH)) return { products: [], alerts: [], users: [] };
  const data = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  if (!data.users) data.users = [];
  return data;
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function migrateUsers() {
  const db = readDB();
  let changed = false;
  db.products.forEach(p => {
    if (p.alertEmail) {
      if (!p.userEmail) { p.userEmail = p.alertEmail; changed = true; }
      if (!db.users.find(u => u.email === p.alertEmail)) {
        db.users.push({ id: Date.now().toString() + Math.random(), email: p.alertEmail, createdAt: new Date().toISOString() });
        changed = true;
        console.log(`[MIGRATE] Created user for ${p.alertEmail}`);
      }
    }
  });
  if (changed) writeDB(db);
  console.log(`[MIGRATE] Done. ${db.users.length} users.`);
}
migrateUsers();

// --------------- Store scrapers ---------------
// Try multiple text candidates and return the first valid positive price
function parsePrice(...candidates) {
  for (const text of candidates) {
    if (!text) continue;
    const cleaned = text.replace(/,/g, "").replace(/[^0-9.]/g, "");
    const n = parseFloat(cleaned);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

// Last-resort: find ₹ followed by digits anywhere in raw HTML
function regexPrice(html) {
  const match = html.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);
  if (match) {
    const n = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

// Expand short URLs (amzn.in, amzn.to, a.co, fktr.in, etc.) by following redirects
async function resolveUrl(url) {
  try {
    const res = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      maxRedirects: 10,
      timeout: 8000,
    });
    return res.request?.res?.responseUrl || url;
  } catch {
    return url;
  }
}

const SCRAPERS = {
  Amazon: async (rawUrl) => {
    const url = await resolveUrl(rawUrl);
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const name =
      $("#productTitle").text().trim() || $("h1").first().text().trim();
    const price = parsePrice(
      $(".priceToPay .a-price-whole").first().text(),
      $(".apexPriceToPay .a-offscreen").first().text(),
      $(".a-price .a-offscreen").first().text(),
      $(".a-price-whole").first().text(),
      $("#priceblock_ourprice").text(),
      $("#priceblock_dealprice").text(),
    ) || regexPrice(data);
    return { price, name };
  },

  Flipkart: async (rawUrl) => {
    const url = await resolveUrl(rawUrl);
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const name =
      $(".B_NuCI").text().trim() ||
      $('span[class*="title"]').first().text().trim() ||
      $("h1").first().text().trim();
    const price = parsePrice(
      $("._30jeq3").first().text(),
      $("._16Jk6d").first().text(),
      $('[class*="price"]').first().text(),
    ) || regexPrice(data);
    return { price, name };
  },

  Nykaa: async (url) => {
    const USER_AGENTS = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.0.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    ];
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent": randomUA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Cache-Control": "max-age=0",
          "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        },
        timeout: 15000,
        maxRedirects: 5,
      });
      const $ = cheerio.load(data);
      const name = $("h1").first().text().trim() ||
        $('[class*="product-title"]').first().text().trim() ||
        $('[class*="ProductTitle"]').first().text().trim();
      const price = parsePrice(
        $('[class*="selling-price"]').first().text(),
        $('[class*="sellingPrice"]').first().text(),
        $('[class*="SellingPrice"]').first().text(),
        $('[class*="css-111z9ua"]').first().text(),
        $('[class*="price"]').first().text(),
        $('span[class*="Price"]').first().text(),
      ) || regexPrice(data);
      return { price, name };
    } catch (err) {
      if (err.response?.status === 403) {
        console.error('[NYKAA] Blocked with 403 — site is blocking scraping');
        return { price: null, name: null, note: "Nykaa is blocking automated requests" };
      }
      throw err;
    }
  },

  Myntra: async (url) => {
    // Try the Myntra product API first — extracts product ID from URL, no browser needed
    const idMatch = url.match(/\/(\d+)(?:\/buy)?(?:[?#].*)?$/);
    if (idMatch) {
      try {
        const pid = idMatch[1];
        const { data } = await axios.get(`https://www.myntra.com/gateway/v2/product/${pid}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
            "Accept": "application/json, */*;q=0.9",
            "Referer": "https://www.myntra.com/",
            "x-location-code": "560001",
          },
          timeout: 10000,
        });
        const style = data?.style;
        if (style) {
          const name = style.name || null;
          const price =
            style.sizes?.[0]?.sizeSellerData?.[0]?.discountedPrice ||
            style.sizes?.[0]?.sizeSellerData?.[0]?.mrp ||
            style.mrp ||
            null;
          console.log(`[MYNTRA API] ${name} — ₹${price}`);
          if (name || price) return { name, price };
        }
      } catch (apiErr) {
        console.log('[MYNTRA] API failed, falling back to Puppeteer:', apiErr.message);
      }
    }

    // Puppeteer fallback
    if (!puppeteer) return { price: null, name: null, note: "Puppeteer not installed" };
    let browser;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(r => setTimeout(r, 4000));
      const result = await page.evaluate(() => {
        const nameSelectors = [".pdp-name", "h1.pdp-title", ".pdp-title", "h1"];
        const nameEl = nameSelectors.map(s => document.querySelector(s)).find(e => e?.innerText?.trim());
        const priceSelectors = [".pdp-price strong", ".pdp-price", '[class*="discountedPrice"]', '[class*="selling"]', '[class*="price"]'];
        const priceEl = priceSelectors.map(s => document.querySelector(s)).find(e => e?.innerText?.trim());
        const name = nameEl?.innerText?.trim() || null;
        const rawPrice = priceEl?.innerText?.trim() || document.body.innerText.match(/Rs\.?\s*([\d,]+)|₹\s*([\d,]+)/)?.[1] || "";
        const price = parseFloat(rawPrice.replace(/,/g, "").replace(/[^0-9.]/g, "")) || null;
        return { name, price };
      });
      return result;
    } catch (err) {
      console.error('[MYNTRA] Browser launch failed:', err.message);
      return { price: null, name: null, note: "Browser unavailable: " + err.message };
    } finally {
      if (browser) await browser.close();
    }
  },

  Meesho: async (url) => {
    if (!puppeteer) return { price: null, name: null, note: "Puppeteer not installed" };
    let browser;
    try {
      browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      const result = await page.evaluate(() => {
        // Meesho renders product name in h1 and price in a span/p with ₹
        const name = document.querySelector("h1")?.innerText?.trim() || null;
        // scan all text nodes for a ₹ price pattern
        const allText = document.body.innerText;
        const priceMatch = allText.match(/₹\s*([\d,]+)/);
        const rawPrice = priceMatch ? priceMatch[1] : "";
        const price = parseFloat(rawPrice.replace(/,/g, "")) || null;
        return { name, price };
      });
      return result;
    } catch (err) {
      console.error('[MEESHO] Browser launch failed:', err.message);
      return { price: null, name: null, note: "Browser unavailable: " + err.message };
    } finally {
      if (browser) await browser.close();
    }
  },

  Sephora: async (url) => {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const name = $("h1").first().text().trim();
    const price = parsePrice(
      $('[data-comp="Price"]').first().text(),
      $('[class*="price"]').first().text(),
    ) || regexPrice(data);
    return { price, name };
  },

  SSBeauty: async (url) => {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const name = $("h1").first().text().trim();
    const price = parsePrice(
      $('[class*="price"]').first().text(),
    ) || regexPrice(data);
    return { price, name };
  },
};

// --------------- Email notifier ---------------
async function sendWelcomeEmail(product) {
  console.log(`[WELCOME EMAIL] Attempting to send to ${product.alertEmail}`);
  if (!process.env.RESEND_API_KEY) {
    console.log('[WELCOME EMAIL] Skipping — RESEND_API_KEY not set');
    return;
  }
  try {
    await resend.emails.send({
      from: 'PriceTracker <onboarding@resend.dev>',
      to: product.alertEmail,
      subject: `✅ Now tracking ${product.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9f9f9; border-radius: 12px;">
          <h2 style="color: #111;">📦 We're on it!</h2>
          <p>You've added <strong>${product.name}</strong> from <strong>${product.store}</strong> to your price tracker.</p>
          <table style="width:100%; background:#fff; border-radius:8px; padding:16px; margin:16px 0;">
            <tr><td style="color:#888;">Current Price</td><td><strong>₹${product.currentPrice}</strong></td></tr>
            <tr><td style="color:#888;">Alert Threshold</td><td><strong>${product.threshold ? '₹' + product.threshold : 'Not set'}</strong></td></tr>
            <tr><td style="color:#888;">Store</td><td><strong>${product.store}</strong></td></tr>
          </table>
          <p style="color:#555;">We'll check prices every 3 hours and notify you the moment the price drops below <strong>${product.threshold ? '₹' + product.threshold : 'your threshold'}</strong>.</p>
          ${product.url ? `<a href="${product.url}" style="display:inline-block; margin-top:12px; padding:10px 20px; background:#111; color:#fff; border-radius:6px; text-decoration:none;">View Product →</a>` : ''}
          <p style="margin-top:24px; font-size:12px; color:#aaa;">PriceTracker — watching prices so you don't have to.</p>
        </div>
      `
    });
    console.log(`[WELCOME EMAIL] Successfully sent to ${product.alertEmail} ✅`);
  } catch (err) {
    console.error('[WELCOME EMAIL ERROR]', err.message);
  }
}
async function sendAlert(product, oldPrice, newPrice) {
  const recipient = product.alertEmail;
  console.log(`[ALERT EMAIL] Attempting to send to ${recipient}`);
  if (!process.env.RESEND_API_KEY || !recipient) {
    console.log(`[ALERT EMAIL] Skipping — RESEND_API_KEY not set or no recipient`);
    return;
  }
  try {
    await resend.emails.send({
      from: 'PriceTracker <onboarding@resend.dev>',
      to: recipient,
      subject: `🔔 Price Drop! ${product.name} is now ₹${newPrice}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9f9f9; border-radius: 12px;">
          <h2 style="color: #c0392b;">📉 Price Drop Alert!</h2>
          <p><strong>${product.name}</strong> on <strong>${product.store}</strong></p>
          <table style="width:100%; background:#fff; border-radius:8px; padding:16px; margin:16px 0;">
            <tr><td style="color:#888;">Old Price</td><td><s>₹${oldPrice}</s></td></tr>
            <tr><td style="color:#888;">New Price</td><td><strong style="color:#27ae60;">₹${newPrice}</strong></td></tr>
            ${product.threshold ? `<tr><td style="color:#888;">Your Threshold</td><td>₹${product.threshold}</td></tr>` : ''}
          </table>
          ${product.url ? `<a href="${product.url}" style="display:inline-block; margin-top:12px; padding:10px 20px; background:#27ae60; color:#fff; border-radius:6px; text-decoration:none;">Buy Now →</a>` : ''}
          <p style="margin-top:24px; font-size:12px; color:#aaa;">PriceTracker — watching prices so you don't have to.</p>
        </div>
      `
    });
    console.log(`[ALERT EMAIL] Successfully sent to ${recipient} ✅`);
  } catch (err) {
    console.error('[ALERT EMAIL ERROR]', err.message);
  }
}

// --------------- Price check logic ---------------
async function checkPrice(product) {
  const scraper = SCRAPERS[product.store];
  if (!scraper) return null;
  try {
    const result = await scraper(product.url);
    return result;
  } catch (err) {
    console.error(`[SCRAPE ERROR] ${product.name}:`, err.message);
    return null;
  }
}

async function checkAllProducts() {
  console.log("[CRON] Checking all product prices...");
  const db = readDB();
  for (const product of db.products) {
    if (!product.url) continue;
    const result = await checkPrice(product);
    if (!result || !result.price || isNaN(result.price)) continue;

    const oldPrice = product.currentPrice;
    product.currentPrice = result.price;

    // Record history
    product.history = product.history || [];
    product.history.push({ price: result.price, checkedAt: new Date().toISOString() });
    if (product.history.length > 30) product.history.shift();

    // Alert if threshold crossed or significant drop
    const dropped = oldPrice && result.price < oldPrice;
    const belowThreshold = product.threshold && result.price <= product.threshold;

    if (dropped || belowThreshold) {
      db.alerts = db.alerts || [];
      db.alerts.unshift({
        productId: product.id,
        productName: product.name,
        store: product.store,
        oldPrice,
        newPrice: result.price,
        threshold: product.threshold,
        triggeredAt: new Date().toISOString(),
      });
      if (db.alerts.length > 50) db.alerts.pop();
      await sendAlert(product, oldPrice, result.price);
    }

    console.log(`[CHECK] ${product.name}: ₹${result.price}`);
  }
  writeDB(db);
  console.log("[CRON] Done.");
}

// --------------- Routes ---------------

// Auth
app.post("/api/auth/login", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });
  const db = readDB();
  const existingUser = db.users.find(u => u.email === email.toLowerCase().trim());
  if (existingUser) {
    console.log(`[AUTH] Existing user logged in: ${email}`);
    return res.json({ user: existingUser, isNew: false });
  }
  res.json({ isNew: true, email: email.toLowerCase().trim() });
});

app.post("/api/auth/register", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });
  const db = readDB();
  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ error: "User already exists" });
  }
  const user = { id: Date.now().toString(), email, createdAt: new Date().toISOString() };
  db.users.push(user);
  writeDB(db);
  console.log(`[AUTH] New user registered: ${email}`);
  res.json({ user, isNew: true });
});

// Get all products
app.get("/api/products", (req, res) => {
  const { email } = req.query;
  const db = readDB();
  const products = email
    ? db.products.filter(p => p.userEmail === email || p.alertEmail === email)
    : db.products;
  res.json(products);
});

// Add product
app.post("/api/products", async (req, res) => {
  const { name, store, url, currentPrice, threshold, alertEmail, userEmail } = req.body;
  if (!name || !store) return res.status(400).json({ error: "Name and store are required." });

  const db = readDB();
  const product = {
    id: Date.now().toString(),
    name,
    store,
    url: url || "",
    currentPrice: parseFloat(currentPrice) || 0,
    originalPrice: parseFloat(currentPrice) || 0,
    threshold: threshold ? parseFloat(threshold) : null,
    alertEmail: alertEmail || null,
    userEmail: userEmail || alertEmail || null,
    history: [{ price: parseFloat(currentPrice) || 0, checkedAt: new Date().toISOString() }],
    addedAt: new Date().toISOString(),
  };

  // Try to auto-fetch price if URL given
  if (url) {
    const fetched = await checkPrice(product).catch(() => null);
    if (fetched && fetched.price && !isNaN(fetched.price)) {
      product.currentPrice = fetched.price;
      product.originalPrice = fetched.price;
      product.name = fetched.name || name;
      product.history[0].price = fetched.price;
    }
  }

  db.products.unshift(product);
  writeDB(db);
  if (product.alertEmail) sendWelcomeEmail(product).catch(err => console.error("[WELCOME EMAIL ERROR]", err.message));
  res.json(product);
});

// Delete product
app.delete("/api/products/:id", (req, res) => {
  const db = readDB();
  db.products = db.products.filter((p) => p.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// Update threshold
app.patch("/api/products/:id", (req, res) => {
  const db = readDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: "Not found" });
  if (req.body.threshold !== undefined) product.threshold = parseFloat(req.body.threshold) || null;
  writeDB(db);
  res.json(product);
});

// Fetch product info from URL without adding it
app.post("/api/fetch-product", async (req, res) => {
  const { url, store } = req.body;
  if (!url || !store) return res.status(400).json({ error: "url and store are required." });
  const scraper = SCRAPERS[store];
  if (!scraper) return res.status(400).json({ error: `No scraper for store: ${store}` });
  try {
    const result = await scraper(url);
    if (!result || (!result.price && !result.name)) {
      return res.status(422).json({ error: "Could not extract product info. The store may block scraping or the URL is invalid." });
    }
    res.json({ name: result.name || null, price: (result.price && !isNaN(result.price)) ? result.price : null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch product info: " + err.message });
  }
});

// Manual check now
app.post("/api/check", async (req, res) => {
  await checkAllProducts();
  const db = readDB();
  res.json({ products: db.products, alerts: db.alerts });
});

// Get alerts
app.get("/api/alerts", (req, res) => {
  const db = readDB();
  res.json(db.alerts || []);
});

// --------------- Keep-alive ping (called by cron-job.org every 10min) ---------------
app.get("/ping", (req, res) => {
  res.json({ status: "alive", time: new Date().toISOString() });
});

// --------------- Cron: local dev only, cron-job.org handles prod ---------------
if (process.env.NODE_ENV !== "production") {
  cron.schedule("0 */3 * * *", checkAllProducts);
  console.log("[CRON] Local cron scheduled every 3 hours.");
}

// --------------- Start ---------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Price Tracker server at http://localhost:${PORT}`);
  console.log(`   In production: cron-job.org handles /api/check + /ping\n`);
});
