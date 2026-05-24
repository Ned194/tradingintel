require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");
const RSSParser = require("rss-parser");

const app = express();
const PORT = process.env.PORT || 3000;
const parser = new RSSParser();

app.use(cors());
app.use(express.json());

// ── Serve React frontend ──────────────────────────────
app.use(express.static(path.join(__dirname, "client/dist")));

// ── PRICES endpoint (Twelve Data) ────────────────────
app.get("/api/prices", async (req, res) => {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return res.status(500).json({ error: "No API key set" });

  try {
    const [wtiQ, ndxQ, wtiS, ndxS] = await Promise.all([
      fetch(`https://api.twelvedata.com/quote?symbol=WTI/USD&apikey=${key}`).then(r => r.json()),
      fetch(`https://api.twelvedata.com/quote?symbol=NDX&apikey=${key}`).then(r => r.json()),
      fetch(`https://api.twelvedata.com/time_series?symbol=WTI/USD&interval=5min&outputsize=60&apikey=${key}`).then(r => r.json()),
      fetch(`https://api.twelvedata.com/time_series?symbol=NDX&interval=5min&outputsize=60&apikey=${key}`).then(r => r.json()),
    ]);

    const parse = (q, s) => {
      const price = parseFloat(q.close || q.price);
      const prev  = parseFloat(q.previous_close);
      const candles = (s.values || []).slice().reverse().map(v => ({
        t: v.datetime.slice(11, 16),
        o: +v.open, h: +v.high, l: +v.low, c: +v.close
      }));
      return { price, change: price - prev, changePct: (price - prev) / prev * 100, candles };
    };

    res.json({ WTI: parse(wtiQ, wtiS), US100: parse(ndxQ, ndxS) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── NEWS SCRAPER endpoint ─────────────────────────────
app.post("/api/scrape", async (req, res) => {
  const { sources, keywords } = req.body;
  const results = [];

  for (const src of sources.filter(s => s.active && s.type === "rss")) {
    try {
      const feed = await parser.parseURL(src.url);
      for (const item of feed.items.slice(0, 10)) {
        const text = `${item.title} ${item.contentSnippet || ""}`.toLowerCase();
        const kws  = [...(keywords.WTI || []), ...(keywords.US100 || [])].map(k => k.toLowerCase());
        const matched = src.mode === "all" || kws.some(k => text.includes(k));
        if (matched) {
          results.push({
            source: src.name,
            headline: item.title,
            url: item.link,
            time: new Date(item.pubDate || Date.now()).toISOString(),
            triggered: true,
          });
        }
      }
    } catch (e) {
      console.error(`Failed scraping ${src.name}:`, e.message);
    }
  }

  res.json({ articles: results });
});

// ── ANALYZE endpoint (Claude API) ────────────────────
app.post("/api/analyze", async (req, res) => {
  const { headlines, wtiPrice, us100Price } = req.body;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "No Anthropic API key set" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `You are a professional financial analyst. Current live prices: WTI=${wtiPrice}, US100=${us100Price}.

NEWS:
${headlines}

Provide trading signals for WTI and US100. Respond ONLY in JSON:
{"signals":[{"market":"WTI","direction":"LONG","entry":0.00,"tp":0.00,"sl":0.00,"rr":"X:1","confidence":0,"reasoning":"..."},{"market":"US100","direction":"LONG","entry":0,"tp":0,"sl":0,"rr":"X:1","confidence":0,"reasoning":"..."}]}`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.map(c => c.text || "").join("") || "";
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WHATSAPP endpoint (Twilio) ────────────────────────
app.post("/api/whatsapp", async (req, res) => {
  const { signal } = req.body;
  const sid   = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from  = process.env.TWILIO_FROM;
  const to    = process.env.WHATSAPP_TO;

  if (!sid || !token) return res.status(500).json({ error: "Twilio not configured" });

  const msg = `🤖 *AI TRADE SIGNAL*\n\n📊 *${signal.market}* | ${signal.direction === "LONG" ? "🟢 LONG" : "🔴 SHORT"}\n\n💰 Entry: ${signal.entry}\n🎯 TP: ${signal.tp}\n🛑 SL: ${signal.sl}\n⚖️ R:R = ${signal.rr}\n🎯 Confidence: ${signal.confidence}%\n\n📝 ${signal.reasoning}\n\n⏰ ${signal.time}`;

  try {
    const form = new URLSearchParams();
    form.append("From", `whatsapp:${from}`);
    form.append("To",   `whatsapp:${to}`);
    form.append("Body", msg);

    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { "Authorization": "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: form
    });

    r.ok ? res.json({ ok: true }) : res.status(500).json({ error: "Twilio error" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Catch-all → serve React ───────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

app.listen(PORT, () => console.log(`TradingIntel running on port ${PORT}`));
