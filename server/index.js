require('dotenv').config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");
const nodemailer = require("nodemailer");
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
  const opts = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  };
  if (systemChrome) opts.executablePath = systemChrome;
  return puppeteer.launch(opts);
}

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, "db.json");

// --------------- Simple JSON "database" ---------------
function readDB() {
  if (!fs.existsSync(DB_PATH)) return { products: [], alerts: [] };
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

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
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
      timeout: 10000,
    });
    const $ = cheerio.load(data);
    const name = $("h1").first().text().trim();
    const price = parsePrice(
      $(".css-111z9ua").first().text(),
      $('[class*="selling-price"]').first().text(),
      $('[class*="price"]').first().text(),
    ) || regexPrice(data);
    return { price, name };
  },

  Myntra: async (url) => {
    if (!puppeteer) return { price: null, name: null, note: "Install puppeteer: npm install puppeteer" };
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-IN,en;q=0.9", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" });
      // override navigator.webdriver even when stealth isn't available
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        window.chrome = { runtime: {} };
      });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      // give JS time to render product info
      await new Promise(r => setTimeout(r, 3000));
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
    } finally {
      await browser.close();
    }
  },

  Meesho: async (url) => {
    if (!puppeteer) return { price: null, name: null, note: "Install puppeteer: npm install puppeteer" };
    const browser = await launchBrowser();
    try {
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
    } finally {
      await browser.close();
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
// Fill in your Gmail credentials in .env or directly here
const EMAIL_USER = process.env.EMAIL_USER || "";
const EMAIL_PASS = process.env.EMAIL_PASS || "";

async function sendWelcomeEmail(product) {
  if (!EMAIL_USER || !EMAIL_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });
  await transporter.sendMail({
    from: EMAIL_USER,
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
  console.log(`[WELCOME EMAIL] Sent to ${product.alertEmail}`);
}

async function sendAlert(product, oldPrice, newPrice) {
  const recipient = product.alertEmail;
  if (!EMAIL_USER || !EMAIL_PASS || !recipient) {
    console.log(`[ALERT] ${product.name}: ₹${oldPrice} → ₹${newPrice} (email not configured)`);
    return;
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });
  await transporter.sendMail({
    from: EMAIL_USER,
    to: recipient,
    subject: `🔔 Price Drop! ${product.name} is now ₹${newPrice}`,
    html: `
      <h2>Price Drop Alert 📉</h2>
      <p><strong>${product.name}</strong> on <strong>${product.store}</strong></p>
      <p>Price dropped from <s>₹${oldPrice}</s> → <strong>₹${newPrice}</strong></p>
      ${product.threshold ? `<p>Your threshold: ₹${product.threshold}</p>` : ""}
      ${product.url ? `<p><a href="${product.url}">View on ${product.store}</a></p>` : ""}
    `,
  });
  console.log(`[EMAIL SENT] Alert for ${product.name}`);
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

// Get all products
app.get("/api/products", (req, res) => {
  const db = readDB();
  res.json(db.products);
});

// Add product
app.post("/api/products", async (req, res) => {
  const { name, store, url, currentPrice, threshold, alertEmail } = req.body;
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
