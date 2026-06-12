// api/apollo.js — Vercel serverless
// Proxy para Apollo.io People Match API (evita CORS do browser)
// Variável de ambiente necessária: APOLLO_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "APOLLO_API_KEY nao configurada no servidor. Adicione nas variaveis de ambiente do Vercel." });
  }

  const { first_name, last_name, organization_name, title } = req.body || {};

  try {
    const apolloRes = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        first_name: first_name || "",
        last_name: last_name || "",
        organization_name: organization_name || "",
        title: title || "",
        reveal_personal_emails: true,
      }),
    });

    if (!apolloRes.ok) {
      const errText = await apolloRes.text();
      return res.status(apolloRes.status).json({ error: "Apollo retornou erro: " + apolloRes.status, detail: errText });
    }

    const data = await apolloRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Erro ao chamar Apollo.io: " + err.message });
  }
}
