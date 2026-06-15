// api/openai-test.js — Endpoint de diagnostico (GET no navegador)
// Acesse: https://SEU-SITE.vercel.app/api/openai-test
// Mostra se a OPENAI_API_KEY esta configurada e se a OpenAI responde.

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  const diag = {
    keyConfigurada: !!apiKey,
    keyPrefixo: apiKey ? apiKey.slice(0, 7) + "..." : null,
    model: model,
    timestamp: new Date().toISOString(),
  };

  if (!apiKey) {
    diag.status = "ERRO";
    diag.mensagem = "OPENAI_API_KEY nao encontrada nas variaveis de ambiente. Adicione no painel do Vercel (Settings > Environment Variables) e faca um novo deploy.";
    return res.status(200).json(diag);
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: "Responda apenas com a palavra: OK" }],
        max_tokens: 5,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      diag.status = "ERRO";
      diag.httpStatus = r.status;
      diag.mensagem = "A OpenAI rejeitou a chamada.";
      diag.detalheOpenAI = data && data.error ? data.error : data;
      // dicas comuns
      if (r.status === 401) diag.dica = "Key invalida ou revogada. Gere uma nova em platform.openai.com/api-keys.";
      if (r.status === 429) diag.dica = "Sem creditos ou limite de uso atingido. Verifique o billing em platform.openai.com.";
      if (r.status === 404) diag.dica = "O modelo '" + model + "' nao esta disponivel para sua conta. Tente definir OPENAI_MODEL=gpt-4o-mini.";
      return res.status(200).json(diag);
    }

    diag.status = "OK";
    diag.mensagem = "OpenAI respondeu com sucesso! A geracao de sequencias deve funcionar.";
    diag.respostaModelo = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return res.status(200).json(diag);
  } catch (err) {
    diag.status = "ERRO";
    diag.mensagem = "Falha de rede ao contatar a OpenAI: " + err.message;
    return res.status(200).json(diag);
  }
}
