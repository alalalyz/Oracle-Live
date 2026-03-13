const express = require("express");
const cors    = require("cors");
const path    = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const KEY   = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-20250514";

function extractJSON(raw) {
  if (!raw) return null;
  const clean = raw.replace(/```json/gi,"").replace(/```/g,"").trim();
  try { return JSON.parse(clean); } catch(_){}
  let d=0,s=-1;
  for(let i=0;i<clean.length;i++){
    if(clean[i]==="{"){if(d===0)s=i;d++;}
    else if(clean[i]==="}"){d--;if(d===0&&s!==-1){try{return JSON.parse(clean.slice(s,i+1));}catch(_){s=-1;d=0;}}}
  }
  return null;
}

async function claude({ system, user, search=false, tokens=6000 }) {
  if (!KEY) throw new Error("ANTHROPIC_API_KEY manquante. Ajoute-la dans Replit Secrets ou Render Environment.");
  const body = {
    model: MODEL, max_tokens: tokens, system,
    messages: [{ role:"user", content:user }],
  };
  if (search) body.tools = [{ type:"web_search_20250305", name:"web_search" }];

  for (let attempt=1; attempt<=3; attempt++) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "x-api-key":KEY, "anthropic-version":"2023-06-01" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
      const parsed = extractJSON(text);
      if (parsed) return parsed;
      throw new Error("JSON invalide: " + text.slice(0,150));
    } catch(e) {
      if (attempt===3) throw e;
      await new Promise(r=>setTimeout(r, 2000*attempt));
    }
  }
}

app.post("/api/matches", async (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  const system = `Football analyst. Today: ${today}. Search web for ALL football matches today and real bookmaker odds. Return ONLY raw JSON no markdown:
{"matchs":[{"id":"str","competition":"Ligue 1","flag":"🇫🇷","journee":"J29","heure":"21:00","domicile":"PSG","exterieur":"Lyon","statut":"A VENIR","score_actuel":null,"cotes":{"bookmaker":"Bet365","dom":"1.60","nul":"3.80","ext":"5.00","btts_oui":"1.75","btts_non":"2.00","over25":"1.70","dc_1n":"1.15","dc_12":"1.25","dc_n2":"1.40"},"analyse":{"pronostic":"1","score_predit":"2-0","confiance":70,"valeur":false,"prob_dom":58,"prob_nul":24,"prob_ext":18,"prob_btts":55,"prob_over25":62,"forme_dom":"WWWDW","forme_ext":"LDLWL","classement_dom":"1er","classement_ext":"4ème","buts_marques_dom":2.2,"buts_encaisses_dom":0.8,"buts_marques_ext":1.3,"buts_encaisses_ext":1.5,"resume":"Analyse.","facteur_cle":"Facteur.","paris":[{"type":"Résultat","sel":"Victoire dom","cote":"1.60","conf":70}]}}]}`;

  try {
    const data = await claude({
      system,
      user: `Find ALL football matches on ${today}. Search: fixtures today, Champions League, Premier League, Ligue 1, Serie A, La Liga, Bundesliga, Europa League. Return 8+ matches with real odds. JSON only.`,
      search: true,
      tokens: 8000,
    });
    let matchs = data.matchs || (Array.isArray(data) ? data : []);
    if (!matchs.length) return res.status(500).json({ error: "Aucun match trouvé. Réessaie." });
    matchs = matchs.map((m,i) => ({ ...m, id: m.id||`m${i}` }));
    console.log(`✅ ${matchs.length} matchs`);
    res.json({ total: matchs.length, matchs });
  } catch(e) {
    console.error("❌ matches:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/combos", async (req, res) => {
  const { matchs } = req.body;
  if (!matchs?.length) return res.status(400).json({ error: "Aucun match" });

  const resume = matchs.map(m => ({
    match: `${m.domicile} vs ${m.exterieur}`,
    h: m.heure, comp: m.competition,
    prono: m.analyse?.pronostic,
    conf: m.analyse?.confiance,
    val: m.analyse?.valeur,
    cdom: m.cotes?.dom, cnul: m.cotes?.nul, cext: m.cotes?.ext,
  }));

  const system = `Betting optimizer. Build exactly 4 combos. Return ONLY raw JSON:
{"conseil_jour":"str","bankroll":"str","combos":[{"id":"sure","nom":"str","type":"SURE","emoji":"🛡️","nb":2,"cote":"3.40","confiance":76,"mise_conseil":"5%","gain_10":"34€","gain_20":"68€","gain_50":"170€","description":"str","alerte":null,"sels":[{"match":"A vs B","comp":"L1","heure":"21:00","sel":"1 - Dom gagne","type_pari":"Résultat","cote":"1.85","conf":72,"why":"Raison"}]}]}
Types: SURE(2-3,conf>70%,cote 2.5-5x) VALEUR(3-4,value bets,5-10x) RISQUE(5-6,10-25x) JACKPOT(7+,>30x)`;

  try {
    const data = await claude({
      system,
      user: `${resume.length} matches: ${JSON.stringify(resume)}\nBuild 4 combos. JSON only.`,
      tokens: 3000,
    });
    const combos = data.combos || [];
    if (!combos.length) return res.status(500).json({ error: "Aucun combo" });
    res.json({ conseil_jour: data.conseil_jour||"", bankroll: data.bankroll||"", combos });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/custom", async (req, res) => {
  const { matchs } = req.body;
  if (!matchs||matchs.length<2) return res.status(400).json({ error: "Min 2 matchs" });

  const system = `Parlay analyst. Return ONLY raw JSON:
{"cote":"X.XX","confiance":68,"verdict":"JOUER","verdict_label":"str","analyse":"str","conseil":"str","gain_10":"X€","gain_20":"X€","gain_50":"X€","forces":["str"],"risques":["str"],"suggestion":null}
verdict: JOUER>65 PRUDENCE 45-65 EVITER<45`;

  try {
    const sel = matchs.map(m=>({ match:`${m.domicile} vs ${m.exterieur}`, prono:m.analyse?.pronostic, conf:m.analyse?.confiance }));
    const data = await claude({ system, user:`Parlay: ${JSON.stringify(sel)}. JSON only.`, tokens:800 });
    res.json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok:true, key: KEY?"✅":"❌", model:MODEL }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚽ ORACLE v5.1 — port ${PORT} — key: ${KEY?"✅":"❌ MANQUANTE"}`);
});
