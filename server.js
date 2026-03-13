const express = require("express");
const cors    = require("cors");
const path    = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const KEY   = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-20250514";

// ─── Robust JSON extractor ────────────────────────────────────
function extractJSON(raw) {
  if (!raw) return null;
  const clean = raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  // 1. direct parse
  try { return JSON.parse(clean); } catch(_){}
  // 2. find first { … }
  let d=0, s=-1;
  for(let i=0;i<clean.length;i++){
    if(clean[i]==="{"){if(d===0)s=i;d++;}
    else if(clean[i]==="}"){d--;if(d===0&&s!==-1){try{return JSON.parse(clean.slice(s,i+1));}catch(_){s=-1;d=0;}}}
  }
  // 3. find first [ … ]
  d=0;s=-1;
  for(let i=0;i<clean.length;i++){
    if(clean[i]==="["){if(d===0)s=i;d++;}
    else if(clean[i]==="]"){d--;if(d===0&&s!==-1){try{return JSON.parse(clean.slice(s,i+1));}catch(_){s=-1;d=0;}}}
  }
  return null;
}

// ─── Call Anthropic API ────────────────────────────────────────
async function claude({ system, user, search=false, tokens=10000 }) {
  if (!KEY) throw new Error("ANTHROPIC_API_KEY manquante dans les variables d'environnement. Ajoute-la dans Render > Environment.");

  const body = {
    model: MODEL,
    max_tokens: tokens,
    system,
    messages: [{ role:"user", content:user }],
  };
  if (search) body.tools = [{ type:"web_search_20250305", name:"web_search" }];

  let lastErr;
  for (let attempt=1; attempt<=3; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-api-key": KEY,
          "anthropic-version":"2023-06-01",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(`API: ${data.error.message}`);
      const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
      const parsed = extractJSON(text);
      if (parsed) return parsed;
      throw new Error(`JSON invalide (tentative ${attempt}): ${text.slice(0,200)}`);
    } catch(e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r=>setTimeout(r, 1500*attempt));
    }
  }
  throw lastErr;
}

// ════════════════════════════════════════════════════════════════
// /api/matches — Multi-search + full analysis
// ════════════════════════════════════════════════════════════════
app.post("/api/matches", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  const heure = new Date().toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});

  const system = `Tu es ORACLE, moteur de pronostics football expert.
Date: ${today}. Heure: ${heure}.

INSTRUCTIONS ABSOLUES:
1. Utilise web_search PLUSIEURS FOIS pour trouver un maximum de matchs:
   - Cherche "football matches today ${today}"
   - Cherche "soccer fixtures ${today}"  
   - Cherche "Champions League Europa League matches ${today}"
   - Cherche "Premier League Ligue 1 Serie A La Liga Bundesliga ${today}"
   - Cherche "football odds ${today} bet365"
2. Tu DOIS retourner au moins 8 matchs si c'est un jour de semaine, 15+ si c'est un week-end.
3. Si tu ne trouves pas assez de matchs réels, complète avec des matchs plausibles basés sur les calendriers actuels des championnats.

RETOURNE UNIQUEMENT ce JSON brut (ZERO texte avant ou après, ZERO markdown):
{
  "total": 12,
  "matchs": [
    {
      "id": "pl_ars_che",
      "competition": "Premier League",
      "flag": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
      "journee": "J29",
      "heure": "21:00",
      "domicile": "Arsenal",
      "exterieur": "Chelsea",
      "stade": "Emirates Stadium",
      "ville": "Londres",
      "statut": "A VENIR",
      "score_actuel": null,
      "cotes": {
        "bookmaker": "Bet365",
        "dom": "1.85",
        "nul": "3.40",
        "ext": "4.50",
        "btts_oui": "1.72",
        "btts_non": "2.05",
        "over15": "1.22",
        "over25": "1.68",
        "over35": "2.45",
        "dc_1n": "1.18",
        "dc_12": "1.28",
        "dc_n2": "1.42"
      },
      "analyse": {
        "pronostic": "1",
        "score_predit": "2-1",
        "confiance": 72,
        "valeur": true,
        "prob_dom": 54,
        "prob_nul": 25,
        "prob_ext": 21,
        "prob_btts": 62,
        "prob_over25": 67,
        "forme_dom": "WWDWW",
        "forme_ext": "LDWDL",
        "classement_dom": "2ème",
        "classement_ext": "5ème",
        "buts_marques_dom": 2.1,
        "buts_encaisses_dom": 0.9,
        "buts_marques_ext": 1.4,
        "buts_encaisses_ext": 1.3,
        "resume": "Arsenal en grande forme à domicile avec 5 victoires consécutives à l'Emirates. Chelsea peine en déplacement.",
        "facteur_cle": "L'avantage du terrain et la forme récente d'Arsenal sont décisifs.",
        "paris": [
          {"type": "Résultat", "sel": "Arsenal gagne", "cote": "1.85", "conf": 72},
          {"type": "BTTS", "sel": "Oui", "cote": "1.72", "conf": 62},
          {"type": "Over 2.5", "sel": "Oui", "cote": "1.68", "conf": 67}
        ]
      }
    }
  ]
}`;

  try {
    const data = await claude({
      system,
      user: `Trouve TOUS les matchs de football du ${today}. Fais plusieurs recherches web. Retourne le JSON complet avec au moins 8 matchs analysés.`,
      search: true,
      tokens: 12000,
    });

    let matchs = data.matchs || (Array.isArray(data) ? data : []);
    if (!matchs.length) return res.status(500).json({ error: "Aucun match trouvé. Réessaie dans quelques secondes." });

    matchs = matchs.map((m,i) => ({ ...m, id: m.id || `m${i}_${Date.now()}` }));
    console.log(`✅ ${matchs.length} matchs`);
    res.json({ total: matchs.length, matchs });
  } catch(e) {
    console.error("❌ matches:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// /api/combos — 4 combos complets
// ════════════════════════════════════════════════════════════════
app.post("/api/combos", async (req, res) => {
  const { matchs } = req.body;
  if (!matchs?.length) return res.status(400).json({ error: "Aucun match fourni" });

  // On envoie un résumé léger pour ne pas dépasser le contexte
  const resume = matchs.map(m => ({
    id: m.id,
    match: `${m.domicile} vs ${m.exterieur}`,
    comp: m.competition,
    h: m.heure,
    prono: m.analyse?.pronostic,
    conf: m.analyse?.confiance,
    val: m.analyse?.valeur,
    cote_dom: m.cotes?.dom,
    cote_nul: m.cotes?.nul,
    cote_ext: m.cotes?.ext,
    cote_btts: m.cotes?.btts_oui,
    cote_o25: m.cotes?.over25,
    prob_dom: m.analyse?.prob_dom,
    prob_nul: m.analyse?.prob_nul,
    prob_ext: m.analyse?.prob_ext,
  }));

  const system = `Tu es ORACLE COMBOS, expert en construction de combinés à haute valeur.
Tu dois construire EXACTEMENT 4 combinés optimaux à partir des matchs fournis.

RETOURNE UNIQUEMENT ce JSON brut (ZERO texte avant ou après):
{
  "conseil_jour": "Conseil stratégique global en 2 phrases percutantes.",
  "bankroll": "Conseil de gestion bankroll du jour.",
  "combos": [
    {
      "id": "sure",
      "nom": "Le Béton",
      "type": "SURE",
      "emoji": "🛡️",
      "nb": 2,
      "cote": "3.41",
      "confiance": 78,
      "mise_conseil": "5-8% bankroll",
      "gain_10": "34.10€",
      "gain_20": "68.20€",
      "gain_50": "170.50€",
      "description": "Pourquoi ce combo est solide en 1-2 phrases.",
      "alerte": null,
      "sels": [
        {
          "match": "Arsenal vs Chelsea",
          "comp": "Premier League",
          "heure": "21:00",
          "sel": "1 - Arsenal",
          "type_pari": "Résultat 1X2",
          "cote": "1.85",
          "conf": 72,
          "why": "Raison courte et précise."
        }
      ]
    }
  ]
}

Types requis dans cet ordre:
1. SURE: 2-3 sélections hyper sûres, confiance >70%, cote totale 2.5-5x
2. VALEUR: 3-4 sélections avec edge (valeur=true en priorité), cote 5-10x
3. RISQUE: 5-6 sélections, équilibre risque/gain, cote 10-25x
4. JACKPOT: 7-10 sélections audacieuses, cote >30x

IMPORTANT: Utilise des matchs DIFFÉRENTS dans chaque combo autant que possible.`;

  try {
    const data = await claude({
      system,
      user: `Voici ${resume.length} matchs:\n${JSON.stringify(resume)}\n\nConstruit les 4 combos obligatoires. JSON uniquement.`,
      search: false,
      tokens: 5000,
    });

    const combos = data.combos || (Array.isArray(data) ? data : []);
    if (!combos.length) return res.status(500).json({ error: "Aucun combo généré" });
    console.log(`✅ ${combos.length} combos`);
    res.json({ conseil_jour: data.conseil_jour||"", bankroll: data.bankroll||"", combos });
  } catch(e) {
    console.error("❌ combos:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// /api/custom — Verdict combiné perso
// ════════════════════════════════════════════════════════════════
app.post("/api/custom", async (req, res) => {
  const { matchs } = req.body;
  if (!matchs || matchs.length < 2) return res.status(400).json({ error: "Minimum 2 matchs requis" });

  const system = `Tu es ORACLE VERDICT. Analyse ce combiné personnalisé.
RETOURNE UNIQUEMENT ce JSON brut:
{
  "cote": "X.XX",
  "confiance": 68,
  "verdict": "JOUER",
  "verdict_label": "Combo solide",
  "analyse": "Analyse complète du combiné en 2-3 phrases.",
  "conseil": "Conseil de mise pratique.",
  "gain_10": "XX.XX€",
  "gain_20": "XX.XX€",
  "gain_50": "XX.XX€",
  "forces": ["Force 1", "Force 2"],
  "risques": ["Risque 1", "Risque 2"],
  "suggestion": "Amélioration possible ou null."
}
Règle verdict: JOUER si confiance>65 | PRUDENCE si 45-65 | EVITER si <45`;

  try {
    const sel = matchs.map(m=>({
      match: `${m.domicile} vs ${m.exterieur}`,
      h: m.heure,
      prono: m.analyse?.pronostic,
      score: m.analyse?.score_predit,
      conf: m.analyse?.confiance,
      cote: m.cotes?.dom,
    }));
    const data = await claude({
      system,
      user: `Combiné de ${matchs.length} matchs:\n${JSON.stringify(sel)}\nJSON uniquement.`,
      tokens: 1000,
    });
    res.json(data);
  } catch(e) {
    console.error("❌ custom:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════
// /api/health
// ════════════════════════════════════════════════════════════════
app.get("/api/health", (req, res) => {
  res.json({
    ok: true, version: "5.0",
    key: KEY ? "✅ présente" : "❌ MANQUANTE",
    model: MODEL,
    ts: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════╗");
  console.log("║   ⚽  ORACLE LIVE  v5.0      ║");
  console.log("╚══════════════════════════════╝");
  console.log(`🌐  http://0.0.0.0:${PORT}`);
  console.log(`🔑  ${KEY ? "✅ API Key OK" : "❌ API Key MANQUANTE"}`);
});
