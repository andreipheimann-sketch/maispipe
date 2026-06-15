// api/analyze.js — Vercel serverless
// Analisa um documento anexado (RI, relatorios) usando Google Gemini.
// Variavel de ambiente necessaria: GEMINI_API_KEY
// Opcional: GEMINI_MODEL_ANALYZE (default: gemini-2.5-flash)

const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const { attachData, attachFileName, company } = req.body || {};
  if (!attachData) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY nao configurada no servidor." });

  const model = process.env.GEMINI_MODEL_ANALYZE || process.env.GEMINI_MODEL || "gemini-2.5-flash";

  // Detecta tipo
  const ext = (attachFileName || "").split(".").pop().toLowerCase();
  let mediaType = "application/pdf";
  const mimeMap = {
    pdf: "application/pdf",
    txt: "text/plain",
    csv: "text/csv",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  if (attachData.indexOf("data:") >= 0) {
    const mime = attachData.split(";")[0].replace("data:", "").trim();
    if (mime) mediaType = mime;
  } else if (mimeMap[ext]) {
    mediaType = mimeMap[ext];
  }

  const b64 = attachData.indexOf(",") >= 0 ? attachData.split(",")[1] : attachData;
  if (!b64 || b64.length < 100) return res.status(400).json({ error: "Arquivo invalido ou muito pequeno." });

  const prompt = [
    "Voce e um analista de inteligencia comercial B2B especializado em vendas SaaS de CX (Zendesk) no Brasil.",
    "Analise o documento e retorne APENAS um JSON valido nesta estrutura exata:",
    '{"resumo":"Resumo executivo em 3-4 frases: o que a empresa faz, porte, mercado e destaques financeiros/operacionais relevantes","insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"oportunidades":["oportunidade Zendesk 1","oportunidade Zendesk 2","oportunidade Zendesk 3"],"alertas":["risco 1","risco 2"]}',
    "Empresa: " + (company || "nao informada") + ".",
    "Foque no que ajuda um BDR da Zendesk a vender Suite de CX para esta empresa.",
  ].join("\n");

  // Para texto puro (txt/csv) decodifica e manda como texto; senao manda inline_data
  const isText = mediaType === "text/plain" || mediaType === "text/csv";
  let parts;
  if (isText) {
    let textContent = "";
    try { textContent = Buffer.from(b64, "base64").toString("utf-8").slice(0, 12000); } catch (e) {}
    parts = [{ text: prompt + "\n\nConteudo do documento:\n" + textContent }];
  } else {
    parts = [
      { text: prompt },
      { inline_data: { mime_type: mediaType, data: b64 } },
    ];
  }

  try {
    const r = await fetch(BASE + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: parts }],
        generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1400 },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = (data && data.error && data.error.message) || ("HTTP " + r.status);
      return res.status(502).json({ error: "Gemini erro: " + msg });
    }

    const rawText = (data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts || []).map(function (p) { return p.text || ""; }).join("").trim();

    const cleaned = rawText.replace(/```json|```/gi, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      parsed = { resumo: rawText.slice(0, 600) || "Nao foi possivel estruturar a analise.", insights: [], oportunidades: [], alertas: [] };
    }

    return res.status(200).json({
      resumo: parsed.resumo || "",
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      oportunidades: Array.isArray(parsed.oportunidades) ? parsed.oportunidades : [],
      alertas: Array.isArray(parsed.alertas) ? parsed.alertas : [],
    });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno ao processar o documento: " + e.message });
  }
}
