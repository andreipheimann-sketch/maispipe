// api/gemini-test.js — Endpoint de diagnostico (GET no navegador)
// Acesse: https://SEU-SITE.vercel.app/api/gemini-test
// Mostra se a GEMINI_API_KEY esta configurada e se o Gemini responde.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const apiKey = process.env.GEMINI_API_KEY;
  const modelResumo = process.env.GEMINI_MODEL_RESUMO || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const modelSequencia = process.env.GEMINI_MODEL_SEQUENCIA || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const modelAnalyze = process.env.GEMINI_MODEL_ANALYZE || process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const diag = {
    keyConfigurada: !!apiKey,
    keyPrefixo: apiKey ? apiKey.slice(0, 7) + "..." : null,
    modelSequencia: modelSequencia,
    modelResumo: modelResumo,
    modelAnalyze: modelAnalyze,
    timestamp: new Date().toISOString(),
  };

  if (!apiKey) {
    diag.status = "ERRO";
    diag.mensagem = "GEMINI_API_KEY nao encontrada. Adicione no painel do Vercel (Settings > Environment Variables) e faca um novo deploy. Gere a chave gratis em aistudio.google.com/apikey.";
    return res.status(200).json(diag);
  }

  try {
    const r = await fetch(BASE + modelSequencia + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Responda apenas com a palavra: OK" }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      diag.status = "ERRO";
      diag.httpStatus = r.status;
      diag.mensagem = "O Gemini rejeitou a chamada.";
      diag.detalhe = data && data.error ? data.error : data;
      if (r.status === 400) diag.dica = "Key invalida ou modelo inexistente. Verifique a chave e o nome do modelo (ex: gemini-2.5-flash).";
      if (r.status === 403) diag.dica = "Sem permissao. Confirme que a API Generative Language esta ativada para esta key.";
      if (r.status === 429) diag.dica = "Limite de requisicoes atingido (rate limit do tier gratuito). Aguarde ou ative billing.";
      if (r.status === 404) diag.dica = "Modelo '" + modelSequencia + "' nao encontrado. Tente gemini-2.5-flash ou gemini-3-flash.";
      return res.status(200).json(diag);
    }

    const text = (data.candidates && data.candidates[0] && data.candidates[0].content &&
      data.candidates[0].content.parts || []).map(function (p) { return p.text || ""; }).join("");

    diag.status = "OK";
    diag.mensagem = "Gemini respondeu com sucesso! Geracao de sequencias, resumo e analise de documentos devem funcionar.";
    diag.respostaModelo = text;
    return res.status(200).json(diag);
  } catch (err) {
    diag.status = "ERRO";
    diag.mensagem = "Falha de rede ao contatar o Gemini: " + err.message;
    return res.status(200).json(diag);
  }
}
