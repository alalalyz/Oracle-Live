const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-20250514";

function grabJSON(txt) {
  txt = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(txt); } catch (_) {}
  let d = 0, s = -1;
  for (let i = 0; i < txt.length; i++) {
    if (txt[i] === "{") { if (d === 0) s = i; d++; }
    else if (txt[i] === "}") {
      d--;
      if (d === 0 && s !== -1) {
        try { return JSON.parse(txt.slice(s, i + 1)); } catch (_) { s = -1; }
      }
    }
  }
  return null;
}

async function callClaude(system, user, useSearch = false, maxTokens = 7000) {
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  const parsed = grabJSON(text);
  if (!parsed) throw new Error("JSON invalide: " + text.slice(0, 200));
  return parsed;
}

// ── GET MATCHES ──────────────────────────────────────────────
app.post("/api/matches", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Clé API manquante. Ajoute ANTHROPIC_API_KEY dans les Secrets Replit." });

  const today = new Date().toISOString().split("T")[0];

  const system = `You are a football analyst. Today is ${today}.
Search for ALL real football matches today (${today}) in major leagues: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League, Conference League and others.
Search also for real current bookmaker odds (Bet365, Unibet, Winamax).
Return ONLY this raw JSON (no markdown, no text before/after):
{"matchs":[{"id":"m1","competition":"Premier League","flag":"🏴󠁧󠁢󠁥󠁮󠁧󠁿","heure":"21:00","domicile":"Arsenal","exterieur":"Chelsea","statut":"A VENIR","score":null,"cotes":{"src":"Bet365","d":"1.85","n":"3.40","e":"4.20","btts":"1.72","o25":"1.65"},"analyse":{"pronostic":"1","score":"2-1","conf":68,"valeur":false,"p1":52,"pn":26,"p2":22,"fd":"WWDWL","fe":"LDWWW","resume":"Short 2-sentence analysis.","facteur":"Key deciding factor","paris":[{"t":"Résultat","s":"1","c":"1.85"},{"t":"BTTS Oui","s":"Oui","c":"1.72"}]}}]}`;

  try {
    const data = await callClaude(system, `Find all football matches on ${today} with real odds. JSON only.`, true, 7000);
    if (!Array.isArray(data.matchs)) throw new Error("Format invalide");
    data.matchs = data.matchs.map((m, i) => ({ ...m, id: m.id || `m${i}` }));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET COMBOS ───────────────────────────────────────────────
app.post("/api/combos", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Clé API manquante." });
  const { matchs } = req.body;
  if (!matchs?.length) return res.status(400).json({ error: "Pas de matchs" });

  const system = `You are a betting combo optimizer. Return ONLY raw JSON:
{"conseil":"string","bankroll":"string","combos":[{"nom":"string","type":"SURE","nb":2,"cote":"3.10","conf":74,"mise":"5-10€","gain":"31.00€","desc":"string","warn":null,"sels":[{"match":"Team A vs Team B","h":"21:00","sel":"1","cote":"1.80","raison":"string"}]}]}
4 combos required: SURE(2-3 picks >70%), VALEUR(3-4 value), RISQUE(5-6), JACKPOT(7+).`;

  try {
    const summary = matchs.map(m => ({ match: `${m.domicile} vs ${m.exterieur}`, h: m.heure, prono: m.analyse?.pronostic, conf: m.analyse?.conf, valeur: m.analyse?.valeur, cotes: m.cotes }));
    const data = await callClaude(system, `Matches: ${JSON.stringify(summary)}\nBuild 4 combos. JSON only.`, false, 2500);
    if (!data.combos) throw new Error("Combos manquants");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CUSTOM COMBO ─────────────────────────────────────────────
app.post("/api/custom", async (req, res) => {
  if (!API_KEY) return res.status(500).json({ error: "Clé API manquante." });
  const { matchs } = req.body;
  if (!matchs || matchs.length < 2) return res.status(400).json({ error: "Min 2 matchs" });

  const system = `Analyze parlay. Return ONLY raw JSON:
{"cote":"X.XX","conf":70,"verdict":"JOUER","analyse":"string","conseil":"string","gain":"XX.XX€","risques":["string"]}
verdict: JOUER>65, PRUDENCE 45-65, EVITER<45`;

  try {
    const data = await callClaude(system, `Parlay: ${JSON.stringify(matchs.map(m => ({ match: `${m.domicile} vs ${m.exterieur}`, prono: m.analyse?.pronostic, conf: m.analyse?.conf })))}`, false, 600);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", key: API_KEY ? "✅ Clé API présente" : "❌ Clé API manquante" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅ ORACLE LIVE sur http://0.0.0.0:${PORT}`);
  console.log(`🔑 Clé API: ${API_KEY ? "✅ OK" : "❌ MANQUANTE — ajoute ANTHROPIC_API_KEY dans Secrets"}\n`);
});
