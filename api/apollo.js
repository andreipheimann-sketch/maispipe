// api/apollo.js — Vercel serverless
// Proxy Apollo.io com duas estratégias: people/match + people/search fallback
// Variável de ambiente necessária: APOLLO_API_KEY

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "APOLLO_API_KEY nao configurada. Adicione nas variaveis de ambiente do Vercel." });
  }

  const { first_name, last_name, organization_name, title, linkedin_url } = req.body || {};

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "X-Api-Key": apiKey,
  };

  // ── Estratégia 1: people/match (mais preciso, requer nome completo ou LinkedIn)
  try {
    const matchBody = {
      api_key: apiKey,
      first_name: first_name || "",
      last_name: last_name || "",
      organization_name: organization_name || "",
      title: title || "",
      reveal_personal_emails: true,
    };
    if (linkedin_url) matchBody.linkedin_url = linkedin_url;

    const matchRes = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers,
      body: JSON.stringify(matchBody),
    });

    if (matchRes.ok) {
      const matchData = await matchRes.json();
      const email = matchData.person && matchData.person.email;
      if (email && !email.includes("email_not_unlocked")) {
        return res.status(200).json(matchData);
      }
    }
  } catch (e) {}

  // ── Estratégia 2: people/search (busca por título + empresa)
  try {
    const searchBody = {
      api_key: apiKey,
      q_organization_name: organization_name || "",
      page: 1,
      per_page: 5,
      reveal_personal_emails: true,
    };
    if (title) searchBody.person_titles = [title];
    if (first_name || last_name) searchBody.q_keywords = ((first_name || "") + " " + (last_name || "")).trim();

    const searchRes = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
      method: "POST",
      headers,
      body: JSON.stringify(searchBody),
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const people = searchData.people || [];
      // Find best match by title similarity
      const target = (title || "").toLowerCase();
      let best = people[0];
      for (const p of people) {
        const t = (p.title || "").toLowerCase();
        if (target && t.includes(target.split(" ")[0])) { best = p; break; }
      }
      if (best) {
        return res.status(200).json({ person: best });
      }
    }
  } catch (e) {}

  return res.status(200).json({ person: null, message: "Nenhum resultado encontrado para este contato no Apollo." });
}
