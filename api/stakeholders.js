// api/stakeholders.js
// Layer 1: Hunter.io — verified emails by domain
// Layer 2: Apollo.io — people by title/company
// Layer 3: Tavily  — LinkedIn profiles from public web

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { company, domain } = req.body || {};
  if (!company) return res.status(400).json({ error: "company required" });

  const hunterKey  = process.env.HUNTER_API_KEY;
  const apolloKey  = process.env.APOLLO_API_KEY;
  const tavilyKey  = process.env.TAVILY_API_KEY;

  const results = { contacts: [], sources: [], errors: [] };
  const seen = new Set();

  function addContact(c) {
    const key = (c.nome || "").toLowerCase().replace(/\s/g,"").slice(0,8);
    if (!key || seen.has(key)) return;
    seen.add(key);
    results.contacts.push(c);
  }

  // ── LAYER 1: Hunter.io ──────────────────────────────────────────────────────
  if (hunterKey && domain) {
    try {
      const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=15&type=personal&seniority=senior,executive&api_key=${hunterKey}`;
      const r = await fetch(url);
      if (r.ok) {
        const json = await r.json();
        const emails = (json.data?.emails || []).filter(e =>
          e.value && e.value.toLowerCase().includes("@" + domain.toLowerCase())
        );
        const seniorRe = /ceo|cto|ciso|coo|cfo|vp\b|vice|direct|diret|manager|gerente|head|chief|founder|engineer|security|segurança|product|compliance/i;
        for (const e of emails) {
          if (!e.first_name && !e.last_name) continue;
          addContact({
            nome: [e.first_name, e.last_name].filter(Boolean).join(" "),
            cargo: e.position || "",
            email: e.value || "",
            email_confidence: e.confidence || 0,
            linkedin: e.linkedin || "",
            phone: e.phone_number || "",
            is_senior: seniorRe.test(e.position || ""),
            source: "Hunter.io",
          });
        }
        if (results.contacts.length) results.sources.push(`Hunter.io (${results.contacts.length} contatos)`);
      } else {
        results.errors.push(`Hunter.io: HTTP ${r.status}`);
      }
    } catch(e) { results.errors.push(`Hunter.io: ${e.message}`); }
  }

  // ── LAYER 2: Apollo.io ──────────────────────────────────────────────────────
  if (apolloKey) {
    const titles = ["CISO","CTO","Chief Information Security Officer","VP Engineering","Head of Security","AppSec","DevSecOps","Chief Technology Officer","Engineering Manager","Head of Product","CPO"];
    try {
      const body = {
        api_key: apolloKey,
        person_titles: titles.slice(0,6),
        person_locations: ["Brazil"],
        page: 1,
        per_page: 10,
      };
      if (domain) body.q_organization_domains = [domain];
      else body.q_organization_name = company;

      const r = await fetch("https://api.apollo.io/v1/mixed_people/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apolloKey, "Cache-Control": "no-cache" },
        body: JSON.stringify(body),
      });
      if (r.ok) {
        const json = await r.json();
        for (const p of (json.people || [])) {
          const existingEmails = results.contacts.map(c => c.email).filter(Boolean);
          const email = p.email || "";
          if (email && existingEmails.includes(email)) continue;
          const country = (p.country || (p.organization && p.organization.country) || "").toLowerCase();
          const isBrazil = !country || country.includes("brazil") || country.includes("brasil");
          if (!isBrazil) continue;
          addContact({
            nome: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "),
            cargo: p.title || "",
            email: email,
            email_confidence: email ? 75 : 0,
            linkedin: p.linkedin_url || "",
            phone: p.sanitized_phone || "",
            cidade: p.city || "",
            pais: p.country || "",
            is_senior: true,
            source: "Apollo.io",
          });
        }
        const apolloCount = results.contacts.filter(c => c.source === "Apollo.io").length;
        if (apolloCount) results.sources.push(`Apollo.io (${apolloCount} perfis)`);
      } else {
        const txt = await r.text();
        results.errors.push(`Apollo.io: HTTP ${r.status} — ${txt.slice(0,120)}`);
      }
    } catch(e) { results.errors.push(`Apollo.io: ${e.message}`); }
  }

  // ── LAYER 3: Tavily — LinkedIn public profiles ──────────────────────────────
  if (tavilyKey) {
    const queries = [
      `"${company}" CISO OR CTO OR "Head of Security" OR "VP Engineering" site:linkedin.com/in`,
      `"${company}" diretor segurança OR engenharia liderança executivo`,
    ];
    for (const q of queries) {
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: "basic", max_results: 5, language: "pt", country: "Brazil" }),
        });
        if (!r.ok) continue;
        const json = await r.json();
        for (const result of (json.results || [])) {
          const url = result.url || "";
          if (!url.includes("linkedin.com/in/")) continue;
          // Extract name from title: "Name - Title at Company | LinkedIn"
          const titleParts = (result.title || "").split(/\s*[-–|]\s*/);
          const name = titleParts[0]?.trim() || "";
          const role = titleParts[1]?.trim() || "";
          if (!name || name.length < 4 || name.toLowerCase() === company.toLowerCase()) continue;
          // Verify this person is actually associated with the company
          const snippet = (result.content || result.snippet || "").toLowerCase();
          if (!snippet.includes(company.toLowerCase().split(" ")[0])) continue;
          addContact({
            nome: name,
            cargo: role,
            linkedin: url,
            email: "",
            email_confidence: 0,
            is_senior: /ceo|cto|ciso|director|head|vp|chief|vice/i.test(role),
            source: "LinkedIn (Tavily)",
          });
        }
      } catch(e) { results.errors.push(`Tavily L3: ${e.message}`); }
    }
    const tavilyCount = results.contacts.filter(c => c.source?.includes("Tavily")).length;
    if (tavilyCount) results.sources.push(`LinkedIn público (${tavilyCount} perfis)`);
  }

  // Sort: senior first, then by email confidence
  results.contacts.sort((a, b) => {
    if (a.is_senior && !b.is_senior) return -1;
    if (!a.is_senior && b.is_senior) return 1;
    return (b.email_confidence || 0) - (a.email_confidence || 0);
  });

  return res.status(200).json({
    company,
    total: results.contacts.length,
    contacts: results.contacts.slice(0, 12),
    sources: results.sources,
    errors: results.errors,
  });
}
