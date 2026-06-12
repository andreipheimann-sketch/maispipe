// api/analyze.js — Vercel serverless
// Analyzes an attached document using Anthropic Claude API
// Required env var: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const { attachData, attachFileName, company } = req.body || {};
  if (!attachData) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY nao configurada no servidor." });

  // Detect media type from data URI or filename
  let mediaType = "application/pdf";
  if (attachData.includes("data:")) {
    const mime = attachData.split(";")[0].replace("data:", "").trim();
    if (mime) mediaType = mime;
  } else if (attachFileName) {
    const ext = (attachFileName.split(".").pop() || "").toLowerCase();
    const mimeMap = {
      pdf: "application/pdf",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      doc: "application/msword",
      txt: "text/plain",
      csv: "text/csv",
    };
    mediaType = mimeMap[ext] || "application/pdf";
  }

  // Extract raw base64 (strip data URI prefix if present)
  const b64 = attachData.includes(",") ? attachData.split(",")[1] : attachData;
  if (!b64 || b64.length < 100) {
    return res.status(400).json({ error: "Arquivo invalido ou muito pequeno." });
  }

  const prompt = `Voce e um analista de inteligencia comercial B2B especializado em vendas SaaS no Brasil.
Analise este documento e retorne um JSON valido com exatamente esta estrutura (sem markdown, sem texto fora do JSON):
{
  "resumo": "Resumo executivo em 3-4 frases descrevendo o que a empresa faz, seu porte, mercado e destaques financeiros ou operacionais relevantes",
  "insights": ["insight comercial relevante 1", "insight comercial relevante 2", "insight comercial relevante 3", "insight comercial relevante 4", "insight comercial relevante 5"],
  "oportunidades": ["oportunidade de venda Zendesk 1", "oportunidade de venda Zendesk 2", "oportunidade de venda Zendesk 3"],
  "alertas": ["risco ou ponto de atencao 1", "risco ou ponto de atencao 2"]
}
Empresa sendo analisada: ${company || "não informada"}
Foque em informacoes uteis para um BDR da Zendesk que quer vender Suite de CX para esta empresa.
Responda SOMENTE o JSON, sem nenhum texto antes ou depois.`;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: mediaType, data: b64 },
            },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic error:", anthropicRes.status, errText.slice(0, 300));
      return res.status(502).json({ error: "Erro na API de IA: " + anthropicRes.status + ". Verifique ANTHROPIC_API_KEY." });
    }

    const data = await anthropicRes.json();
    const rawText = (data.content || []).map(function(b) { return b.text || ""; }).join("").trim();

    // Parse JSON — strip any accidental markdown fences
    const cleaned = rawText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      // Fallback: return raw as resumo
      console.warn("JSON parse failed, raw:", rawText.slice(0, 200));
      parsed = {
        resumo: rawText.slice(0, 600) || "Nao foi possivel estruturar a analise.",
        insights: [],
        oportunidades: [],
        alertas: [],
      };
    }

    return res.status(200).json({
      resumo: parsed.resumo || "",
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      oportunidades: Array.isArray(parsed.oportunidades) ? parsed.oportunidades : [],
      alertas: Array.isArray(parsed.alertas) ? parsed.alertas : [],
    });
  } catch (e) {
    console.error("analyze error:", e.message);
    return res.status(500).json({ error: "Erro interno ao processar o documento: " + e.message });
  }
}
