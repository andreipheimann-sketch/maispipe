// api/openai.js — Vercel serverless
// Geracao criativa de sequencias de prospeccao via OpenAI.
// Variavel de ambiente necessaria: OPENAI_API_KEY
// Opcional:
//   OPENAI_MODEL_RESUMO    (default: gpt-5.4-mini)  — tarefa simples, mais barato
//   OPENAI_MODEL_SEQUENCIA (default: gpt-5.4)       — copy criativa, mais qualidade
//   OPENAI_MODEL           (fallback geral, opcional)

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Metodo nao permitido." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "OPENAI_API_KEY nao configurada nas variaveis de ambiente do Vercel." });
  }

  const fallbackModel = process.env.OPENAI_MODEL || "gpt-5.4";
  const modelResumo = process.env.OPENAI_MODEL_RESUMO || process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const modelSequencia = process.env.OPENAI_MODEL_SEQUENCIA || fallbackModel;
  const { mode, empresa, setor, cargo, angulo, pain, touches, rawContext } = req.body || {};

  // ── MODO RESUMO: gera um resumo profissional de outbound da conta ──────────
  if (mode === "resumo") {
    const sysR = [
      "Voce e um especialista senior em outbound B2B e account research, no nivel de um SDR/AE de alta performance.",
      "Sua tarefa: ler informacoes cruas (possivelmente desconexas, de varias fontes) sobre uma empresa e escrever um RESUMO EXECUTIVO de conta, claro, fluido e acionavel — do jeito que um vendedor experiente escreveria antes de abordar a conta.",
      "REGRAS:",
      "- Portugues do Brasil, tom profissional e direto, sem jargao vazio.",
      "- 1 paragrafo unico, 3 a 5 frases, coeso e bem encadeado (nada de frases soltas ou repetidas).",
      "- Foque no que importa para vender CX/atendimento: o que a empresa faz, porte/momento, base de clientes, e por que CX e relevante para ela.",
      "- Se a informacao crua for pobre ou contraditoria, NAO invente numeros. Generalize com elegancia.",
      "- Nunca cite URLs, nao use bullet points, nao use markdown. Apenas o paragrafo.",
    ].join("\n");
    const usrR = [
      "Empresa: " + (empresa || "a empresa"),
      "Setor (classificado): " + (setor || "tecnologia"),
      "",
      "Informacoes cruas coletadas (podem estar desorganizadas):",
      (rawContext || "Sem dados adicionais.").slice(0, 4000),
      "",
      "Escreva o resumo executivo da conta agora. Responda apenas com o paragrafo, sem aspas.",
    ].join("\n");
    try {
      const rr = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({
          model: modelResumo,
          messages: [{ role: "system", content: sysR }, { role: "user", content: usrR }],
          temperature: 0.7,
          max_tokens: 400,
        }),
      });
      if (!rr.ok) {
        const e = await rr.text();
        return res.status(rr.status).json({ error: "OpenAI erro " + rr.status, detail: e });
      }
      const rd = await rr.json();
      const resumo = rd.choices && rd.choices[0] && rd.choices[0].message && rd.choices[0].message.content;
      return res.status(200).json({ resumo: (resumo || "").trim() || null });
    } catch (err) {
      return res.status(500).json({ error: "Erro ao chamar OpenAI: " + err.message });
    }
  }

  // touches = [{day, type}] — define a cadencia que o front quer
  const cadencia = Array.isArray(touches) && touches.length
    ? touches
    : [
        { day: 1, type: "linkedin" },
        { day: 3, type: "email" },
        { day: 6, type: "call" },
        { day: 10, type: "email" },
        { day: 15, type: "whatsapp" },
        { day: 21, type: "breakup" },
      ];

  const systemPrompt = [
    "Voce e um copywriter de outbound B2B brasileiro, premiado, conhecido por mensagens que furam o bloqueio mental de executivos ocupados.",
    "Seu estilo: altamente criativo, disruptivo, descontraido e despojado — mas sem ser brega, forcado ou apelativo. Voce soa humano, esperto e confiante.",
    "Voce vende solucoes de CX / atendimento (Zendesk). Conhece MEDDPICC, SPIN e gatilhos de copy.",
    "REGRAS DE OURO:",
    "- Nada de jargao corporativo vazio ('solucoes inovadoras', 'sinergia', 'alavancar'). Fuja de cliche de vendedor.",
    "- Abra com um gancho que prenda em 1 linha. Use curiosidade, contraste, numero inesperado ou uma verdade incomoda.",
    "- Frases curtas. Ritmo. Pode usar humor inteligente e analogias surpreendentes.",
    "- Portugues do Brasil, tom de conversa real entre pessoas, nunca robotico.",
    "- Cada touch deve ser DIFERENTE em angulo e abertura. Zero repeticao de formula entre eles.",
    "- CTA leve e especifico (ex: '15 minutos quarta?'), nunca generico ('vamos conversar?').",
    "- Personalize de verdade com a empresa, setor e cargo informados.",
  ].join("\n");

  const userPrompt = [
    "Crie uma sequencia de prospeccao para:",
    "- Empresa: " + (empresa || "a empresa"),
    "- Setor: " + (setor || "tecnologia"),
    "- Cargo do decisor: " + (cargo || "Decisor"),
    "- Angulo/responsabilidade: " + (angulo || "impacto no negocio"),
    "- Dor principal: " + (pain || "dores do atendimento"),
    "",
    "Gere exatamente " + cadencia.length + " touches nesta cadencia (dia e canal):",
    cadencia.map(function (t, i) { return (i + 1) + ") Dia " + t.day + " - canal: " + t.type; }).join("\n"),
    "",
    "Canais: email (com assunto), linkedin (InMail curto), call (script de cold call falado), whatsapp (curtissimo, informal), breakup (ultima tentativa, classe).",
    "",
    "Responda APENAS com um JSON valido, sem markdown, neste formato:",
    '{"touches":[{"day":1,"type":"linkedin","subject":"...","body":"..."}]}',
    "Para call e whatsapp, subject pode ser um rotulo curto. O body e o conteudo da mensagem/script.",
    "Assine as mensagens como 'BDR | Zendesk' quando fizer sentido.",
  ].join("\n");

  try {
    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: modelSequencia,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 1.0,
        max_tokens: 2200,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      return res.status(aiRes.status).json({ error: "OpenAI retornou erro: " + aiRes.status, detail: errText });
    }

    const aiData = await aiRes.json();
    const content = aiData.choices && aiData.choices[0] && aiData.choices[0].message && aiData.choices[0].message.content;
    if (!content) return res.status(200).json({ touches: null, message: "Sem conteudo retornado." });

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/```json|```/g, "").trim());
    } catch (e) {
      return res.status(200).json({ touches: null, message: "Falha ao interpretar resposta da IA." });
    }

    return res.status(200).json({ touches: (parsed && parsed.touches) || null });
  } catch (err) {
    return res.status(500).json({ error: "Erro ao chamar OpenAI: " + err.message });
  }
}
