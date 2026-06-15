// api/analyze.js — Vercel serverless
// Analisa um documento anexado (RI, relatorios) usando OpenAI.
// Variavel de ambiente necessaria: OPENAI_API_KEY
// Opcional: OPENAI_MODEL_ANALYZE (default: gpt-5.4-mini)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const { attachData, attachFileName, company } = req.body || {};
  if (!attachData) return res.status(400).json({ error: "Nenhum arquivo enviado." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "OPENAI_API_KEY nao configurada no servidor." });

  const model = process.env.OPENAI_MODEL_ANALYZE || process.env.OPENAI_MODEL_RESUMO || "gpt-5.4-mini";

  // Detecta tipo do arquivo
  const ext = (attachFileName || "").split(".").pop().toLowerCase();
  const isPdf = ext === "pdf" || (attachData.indexOf("application/pdf") >= 0);

  // Extrai base64 puro
  const b64 = attachData.indexOf(",") >= 0 ? attachData.split(",")[1] : attachData;
  if (!b64 || b64.length < 100) {
    return res.status(400).json({ error: "Arquivo invalido ou muito pequeno." });
  }

  const prompt = [
    "Voce e um analista de inteligencia comercial B2B especializado em vendas SaaS de CX (Zendesk) no Brasil.",
    "Analise o documento e retorne APENAS um JSON valido (sem markdown, sem texto fora do JSON) nesta estrutura exata:",
    '{"resumo":"Resumo executivo em 3-4 frases: o que a empresa faz, porte, mercado e destaques financeiros/operacionais relevantes","insights":["insight 1","insight 2","insight 3","insight 4","insight 5"],"oportunidades":["oportunidade Zendesk 1","oportunidade Zendesk 2","oportunidade Zendesk 3"],"alertas":["risco 1","risco 2"]}',
    "Empresa: " + (company || "nao informada") + ".",
    "Foque no que ajuda um BDR da Zendesk a vender Suite de CX para esta empresa. Responda SOMENTE o JSON.",
  ].join("\n");

  // Monta o conteudo da mensagem conforme o tipo
  let userContent;
  if (isPdf) {
    userContent = [
      { type: "file", file: { filename: attachFileName || "documento.pdf", file_data: "data:application/pdf;base64," + b64 } },
      { type: "text", text: prompt },
    ];
  } else {
    // Para nao-PDF (txt/csv), decodifica e manda como texto
    let textContent = "";
    try { textContent = Buffer.from(b64, "base64").toString("utf-8").slice(0, 12000); } catch (e) {}
    userContent = [{ type: "text", text: prompt + "\n\nConteudo do documento:\n" + textContent }];
  }

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: userContent }],
        max_tokens: 1400,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      let detail = errText.slice(0, 300);
      let hint = "";
      if (aiRes.status === 400 && errText.indexOf("file") >= 0) hint = " (O modelo pode nao aceitar PDF; tente converter para texto ou use outro modelo.)";
      return res.status(502).json({ error: "OpenAI erro " + aiRes.status + hint, detail: detail });
    }

    const data = await aiRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    const cleaned = rawText.replace(/```json|```/gi, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
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
