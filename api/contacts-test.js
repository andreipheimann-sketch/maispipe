// api/contacts-test.js — Diagnostico das APIs de contatos (GET no navegador)
// Acesse: https://SEU-SITE.vercel.app/api/contacts-test?company=Nubank
// Mostra quais keys estao configuradas e o que cada fonte retorna.

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const company = (req.query && req.query.company) || "Nubank";

  const diag = {
    company: company,
    keys: {
      TAVILY_API_KEY: !!process.env.TAVILY_API_KEY,
      APOLLO_API_KEY: !!process.env.APOLLO_API_KEY,
      HUNTER_API_KEY: !!process.env.HUNTER_API_KEY,
    },
    tavily: null,
    timestamp: new Date().toISOString(),
  };

  // Testa a Tavily diretamente
  if (process.env.TAVILY_API_KEY) {
    try {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: `"${company}" diretor OR gerente site:linkedin.com/in`,
          search_depth: "advanced",
          max_results: 5,
          country: "Brazil",
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        diag.tavily = { status: "ERRO", httpStatus: r.status, detalhe: data };
        if (r.status === 401) diag.tavily.dica = "Key invalida. Gere em app.tavily.com.";
        if (r.status === 432 || r.status === 429) diag.tavily.dica = "Sem creditos ou limite atingido.";
      } else {
        const linkedinResults = (data.results || []).filter(function (x) {
          return (x.url || "").includes("linkedin.com/in/");
        });
        diag.tavily = {
          status: "OK",
          totalResultados: (data.results || []).length,
          perfisLinkedIn: linkedinResults.length,
          amostra: linkedinResults.slice(0, 3).map(function (x) {
            return { title: x.title, url: x.url };
          }),
        };
        if (linkedinResults.length === 0) {
          diag.tavily.aviso = "Tavily respondeu mas nao retornou perfis do LinkedIn para esta empresa. Cargo viria vazio.";
        }
      }
    } catch (e) {
      diag.tavily = { status: "ERRO", mensagem: e.message };
    }
  } else {
    diag.tavily = { status: "SEM_KEY", mensagem: "TAVILY_API_KEY nao configurada — os cargos do LinkedIn dependem dela." };
  }

  diag.resumo = diag.keys.TAVILY_API_KEY
    ? (diag.tavily && diag.tavily.status === "OK"
        ? "Tavily funcionando. Se cargos vierem vazios, e questao de extracao (ja melhorada) ou de perfis sem cargo no titulo."
        : "Tavily com problema — veja o detalhe acima.")
    : "TAVILY_API_KEY ausente. Adicione no Vercel e faca redeploy para popular cargos do LinkedIn.";

  return res.status(200).json(diag);
}
