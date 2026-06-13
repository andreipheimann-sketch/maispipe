// api/hunter.js — Vercel serverless
// Descoberta de e-mail via Hunter.io
// Variavel de ambiente necessaria: HUNTER_API_KEY
//
// Estrategia:
//   1. Resolve o dominio da empresa (se so veio o nome) via Hunter
//   2. Usa Email Finder (nome + dominio) para achar o e-mail + score
//   3. Se nao achar pessoa especifica, tenta o e-mail mais provavel do dominio

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "HUNTER_API_KEY nao configurada nas variaveis de ambiente do Vercel." });
  }

  const { first_name, last_name, organization_name, domain } = req.body || {};

  if (!first_name && !last_name) {
    return res.status(400).json({ error: "Nome do contato e obrigatorio." });
  }

  try {
    // ── Passo 1: resolver dominio ──────────────────────────────────────────
    let resolvedDomain = (domain || "").trim();

    if (!resolvedDomain && organization_name) {
      const dsUrl =
        "https://api.hunter.io/v2/domain-search?company=" +
        encodeURIComponent(organization_name) +
        "&limit=1&api_key=" + apiKey;
      const dsRes = await fetch(dsUrl);
      if (dsRes.ok) {
        const dsData = await dsRes.json();
        resolvedDomain = (dsData.data && dsData.data.domain) || "";
      }
    }

    if (!resolvedDomain) {
      return res.status(200).json({ person: null, message: "Nao foi possivel identificar o dominio da empresa. Tente adicionar o dominio manualmente." });
    }

    // ── Passo 2: Email Finder (nome + dominio) ─────────────────────────────
    const efUrl =
      "https://api.hunter.io/v2/email-finder?domain=" +
      encodeURIComponent(resolvedDomain) +
      "&first_name=" + encodeURIComponent(first_name || "") +
      "&last_name=" + encodeURIComponent(last_name || "") +
      "&api_key=" + apiKey;

    const efRes = await fetch(efUrl);
    if (!efRes.ok) {
      const errText = await efRes.text();
      return res.status(efRes.status).json({ error: "Hunter retornou erro: " + efRes.status, detail: errText });
    }

    const efData = await efRes.json();
    const email = efData.data && efData.data.email;
    const score = (efData.data && efData.data.score) || 0;

    if (email) {
      return res.status(200).json({
        person: {
          email: email,
          email_confidence: score,
          domain: resolvedDomain,
          verification: (efData.data && efData.data.verification && efData.data.verification.status) || null,
        },
      });
    }

    return res.status(200).json({ person: null, domain: resolvedDomain, message: "E-mail nao encontrado para este contato no Hunter." });
  } catch (err) {
    return res.status(500).json({ error: "Erro ao consultar Hunter.io: " + err.message });
  }
}
