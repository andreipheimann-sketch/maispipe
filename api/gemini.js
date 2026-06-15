// api/gemini.js — Vercel serverless
// Geracao de sequencias de prospeccao e resumo de conta via Google Gemini.
// Variavel de ambiente necessaria: GEMINI_API_KEY
// Opcional:
//   GEMINI_MODEL_RESUMO    (default: gemini-2.5-flash)
//   GEMINI_MODEL_SEQUENCIA (default: gemini-2.5-flash)
//   GEMINI_MODEL           (fallback geral)

const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

async function callGemini(model, apiKey, systemText, userText, temperature, jsonMode) {
  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: temperature,
      maxOutputTokens: 2400,
    },
  };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  if (jsonMode) body.generationConfig.responseMimeType = "application/json";

  const r = await fetch(BASE + model + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
    return { ok: false, status: r.status, error: msg };
  }
  const text =
    (data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts || [])
      .map(function (p) { return p.text || ""; })
      .join("");
  return { ok: true, text: text };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY nao configurada nas variaveis de ambiente do Vercel." });

  const fallbackModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const modelResumo = process.env.GEMINI_MODEL_RESUMO || fallbackModel;
  const modelSequencia = process.env.GEMINI_MODEL_SEQUENCIA || fallbackModel;
  const { mode, empresa, setor, cargo, angulo, pain, touches, rawContext } = req.body || {};

  // ── MODO RESUMO ────────────────────────────────────────────────────────────
  if (mode === "resumo") {
    const sysR = [
      "Voce e um especialista senior em outbound B2B e account research, no nivel de um SDR/AE de alta performance.",
      "Sua tarefa: ler informacoes cruas (possivelmente desconexas, de varias fontes) sobre uma empresa e escrever um RESUMO EXECUTIVO de conta, claro, fluido e acionavel.",
      "REGRAS:",
      "- Portugues do Brasil, tom profissional e direto, sem jargao vazio.",
      "- 1 paragrafo unico, 3 a 5 frases, coeso e bem encadeado (nada de frases soltas ou repetidas).",
      "- Foque no que importa para vender CX/atendimento: o que a empresa faz, porte/momento, base de clientes, e por que CX e relevante.",
      "- Se a informacao crua for pobre ou contraditoria, NAO invente numeros. Generalize com elegancia.",
      "- Nunca cite URLs, nao use bullet points, nao use markdown. Apenas o paragrafo.",
    ].join("\n");
    const usrR = [
      "Empresa: " + (empresa || "a empresa"),
      "Setor (classificado): " + (setor || "tecnologia"),
      "",
      "Informacoes cruas coletadas (podem estar desorganizadas):",
      (rawContext || "Sem dados adicionais.").slice(0, 4000),
      "",
      "Escreva o resumo executivo da conta agora. Responda apenas com o paragrafo, sem aspas.",
    ].join("\n");
    const out = await callGemini(modelResumo, apiKey, sysR, usrR, 0.7, false);
    if (!out.ok) return res.status(502).json({ error: "Gemini erro: " + out.error });
    return res.status(200).json({ resumo: (out.text || "").trim() || null });
  }

  // ── MODO SEQUENCIA ─────────────────────────────────────────────────────────
  const cadencia = Array.isArray(touches) && touches.length
    ? touches
    : [
        { day: 1, type: "linkedin" }, { day: 3, type: "email" }, { day: 6, type: "call" },
        { day: 10, type: "email" }, { day: 15, type: "whatsapp" }, { day: 21, type: "breakup" },
      ];

  const systemPrompt = [
    "Voce e um copywriter de outbound B2B brasileiro, premiado, conhecido por mensagens que furam o bloqueio mental de executivos ocupados.",
    "Seu estilo: altamente criativo, disruptivo, descontraido e despojado — mas sem ser brega, forcado ou apelativo. Voce soa humano, esperto e confiante.",
    "Voce vende solucoes de CX / atendimento (Zendesk). Conhece MEDDPICC, SPIN e gatilhos de copy.",
    "REGRAS DE OURO:",
    "- Nada de jargao corporativo vazio. Fuja de cliche de vendedor.",
    "- Abra com um gancho que prenda em 1 linha. Use curiosidade, contraste, numero inesperado ou uma verdade incomoda.",
    "- Frases curtas. Ritmo. Pode usar humor inteligente e analogias surpreendentes.",
    "- Portugues do Brasil, tom de conversa real entre pessoas, nunca robotico.",
    "- Cada touch deve ser DIFERENTE em angulo e abertura. Zero repeticao de formula entre eles.",
    "- CTA leve e especifico (ex: '15 minutos quarta?'), nunca generico.",
    "- Personalize de verdade com a empresa, setor e cargo informados.",
  ].join("\n");

  const userPrompt = [
    "Crie uma sequencia de prospeccao para:",
    "- Empresa: " + (empresa || "a empresa"),
    "- Setor: " + (setor || "tecnologia"),
    "- Cargo do decisor: " + (cargo || "Decisor"),
    "- Angulo/responsabilidade: " + (angulo || "impacto no negocio"),
    "- Dor principal: " + (pain || "dores do atendimento"),
    "",
    "Gere exatamente " + cadencia.length + " touches nesta cadencia (dia e canal):",
    cadencia.map(function (t, i) { return (i + 1) + ") Dia " + t.day + " - canal: " + t.type; }).join("\n"),
    "",
    "Canais: email (com assunto), linkedin (InMail curto), call (script de cold call falado), whatsapp (curtissimo, informal), breakup (ultima tentativa, classe).",
    "",
    "Responda APENAS com um JSON valido neste formato:",
    '{"touches":[{"day":1,"type":"linkedin","subject":"...","body":"..."}]}',
    "Para call e whatsapp, subject pode ser um rotulo curto. O body e o conteudo da mensagem/script.",
    "Assine as mensagens como 'BDR | Zendesk' quando fizer sentido.",
  ].join("\n");

  const out = await callGemini(modelSequencia, apiKey, systemPrompt, userPrompt, 1.0, true);
  if (!out.ok) return res.status(502).json({ error: "Gemini erro: " + out.error });

  let parsed;
  try {
    parsed = JSON.parse((out.text || "").replace(/```json|```/g, "").trim());
  } catch (e) {
    return res.status(200).json({ touches: null, message: "Falha ao interpretar resposta da IA." });
  }
  return res.status(200).json({ touches: (parsed && parsed.touches) || null });
}
