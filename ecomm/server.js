// server.js
import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import NodeCache from "node-cache";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const cacheTTL = Number(process.env.CACHE_TTL_SECONDS || 300); // seconds
const cache = new NodeCache({ stdTTL: cacheTTL, checkperiod: 120 });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Attempt to fetch from RapidAPI (if configured).
 * Return array of normalized results or null on unrecoverable failure.
 */
async function fetchFromRapidAPI(query) {
  const key = process.env.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST || "real-time-product-search.p.rapidapi.com";
  if (!key) return null;

  const url = `https://${host}/search`;
  try {
    const resp = await axios.get(url, {
      params: { q: query, page: 1, limit: 10 },
      headers: {
        "x-rapidapi-key": key,
        "x-rapidapi-host": host
      },
      timeout: 8000
    });

    // Adjust parsing to the API's shape; the code below attempts to normalize.
    const data = resp.data?.data || resp.data?.products || [];
    return data.slice(0, 10).map((p) => ({
      title: p.product_title || p.title || p.name || "No title",
      price: p.product_price || p.price || p.offer_price || p.amount || null,
      url: p.product_url || p.url || p.link || "#",
      image: p.product_image || p.image || p.thumbnail || null,
      source: (p.offer_page_url || p.url || "").includes("flipkart") ? "Flipkart" :
              (p.offer_page_url || p.url || "").includes("amazon") ? "Amazon" :
              (p.offer_page_url || p.url || "").includes("croma") ? "Croma" :
              p.source || p.store || "Other"
    }));
  } catch (err) {
    console.warn("RapidAPI fetch failed:", err.message || err.toString());
    return null;
  }
}

/**
 * Simple fallback scrapers for Amazon / Flipkart / Croma.
 * These are best-effort and may break over time; used only if API fails.
 */
async function fallbackScrape(query) {
  const q = encodeURIComponent(query.trim());
  const results = [];

  // --- Flipkart (simple)
  try {
    const flipUrl = `https://www.flipkart.com/search?q=${q}`;
    const flipResp = await axios.get(flipUrl, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 });
    const $f = cheerio.load(flipResp.data);
    $f("._1AtVbE").slice(0, 6).each((i, el) => {
      const title = $f(el).find("._4rR01T").text() || $f(el).find("a.s1Q9rs").attr("title") || "";
      const price = $f(el).find("._30jeq3._1_WHN1").first().text();
      const url = "https://www.flipkart.com" + ($f(el).find("a").attr("href") || "");
      const image = $f(el).find("img").attr("src") || $f(el).find("img").attr("data-src");
      if (title) results.push({ title: title.trim(), price: price || null, url, image, source: "Flipkart" });
    });
  } catch (e) {
    console.warn("Flipkart scrape failed:", e.message || e.toString());
  }

  // --- Amazon (simple)
  try {
    const amazonUrl = `https://www.amazon.in/s?k=${q}`;
    const aResp = await axios.get(amazonUrl, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 });
    const $a = cheerio.load(aResp.data);
    $a("div.s-result-item").slice(0, 6).each((i, el) => {
      const title = $a(el).find("h2 a span").text().trim();
      const whole = $a(el).find(".a-price-whole").first().text().replace(/[^\d]/g, "");
      const fraction = $a(el).find(".a-price-fraction").first().text().replace(/[^\d]/g, "");
      const price = whole ? `₹${whole}${fraction ? "." + fraction : ""}` : null;
      const href = $a(el).find("h2 a").attr("href");
      const url = href ? ("https://www.amazon.in" + href) : null;
      const image = $a(el).find("img.s-image").attr("src");
      if (title) results.push({ title, price, url, image, source: "Amazon" });
    });
  } catch (e) {
    console.warn("Amazon scrape failed:", e.message || e.toString());
  }

  // --- Croma (simple)
  try {
    const cromaUrl = `https://www.croma.com/search/?text=${q}`;
    const cResp = await axios.get(cromaUrl, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 });
    const $c = cheerio.load(cResp.data);
    $c(".product-tile").slice(0, 6).each((i, el) => {
      const title = $c(el).find(".product-name").text().trim();
      const price = $c(el).find(".price").text().trim();
      const url = $c(el).find("a").attr("href");
      const image = $c(el).find("img").attr("src");
      if (title) results.push({ title, price, url, image, source: "Croma" });
    });
  } catch (e) {
    console.warn("Croma scrape failed:", e.message || e.toString());
  }

  // Return up to 12 results, normalized
  return results.slice(0, 12).map(r => ({
    title: r.title,
    price: r.price || "Price unavailable",
    url: r.url || "#",
    image: r.image || "/placeholder.png",
    source: r.source || "Other"
  }));
}

// Normalize price text to a number (best-effort)
function parsePriceToNumber(priceText) {
  if (!priceText) return null;
  const cleaned = String(priceText).replace(/[^\d.]/g, "");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

// API route
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Missing ?q= query parameter" });

  // Check cache
  const cacheKey = `search:${q.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ source: "cache", results: cached });

  // First try RapidAPI
  let results = await fetchFromRapidAPI(q);

  // If RapidAPI failed or returned nothing, use fallback scraping
  if (!results || results.length === 0) {
    // small delay to avoid aggressive scraping
    await sleep(200);
    results = await fallbackScrape(q);
  }

  // Normalize price numeric for sorting on client
  const normalized = results.map(r => ({
    title: r.title,
    priceText: r.price ?? "Unknown",
    price: parsePriceToNumber(r.price),
    url: r.url,
    image: r.image,
    source: r.source
  }));

  cache.set(cacheKey, normalized);
  res.json({ source: results && results.length ? "live" : "fallback", results: normalized });
});

// Fallback index route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
