// api/feedback.js — Vercel serverless
// Sends feedback email via Resend without exposing the destination email.
// Set RESEND_API_KEY in Vercel environment variables.
// To use a free Resend account: verify your domain or use onboarding@resend.dev as sender.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { nome, assunto, mensagem } = req.body || {};
  if (!nome?.trim() || !assunto?.trim() || !mensagem?.trim()) {
    return res.status(400).json({ error: "Preencha todos os campos." });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // Fallback: log to console if no key configured (dev mode)
    console.log("[FEEDBACK]", { nome, assunto, mensagem });
    return res.status(200).json({ ok: true, mode: "log-only" });
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + resendKey,
      },
      body: JSON.stringify({
        from: "Mais Pipe Feedback <feedback@maispipe.com.br>",
        to: ["andreip.heimann@gmail.com"],
        reply_to: [],
        subject: "[+Pipe Beta] " + assunto.trim(),
        html: `
          <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
            <div style="background:#0A0A0F;padding:20px 24px;border-radius:12px;margin-bottom:24px;display:flex;align-items:center;gap:12px;">
              <span style="font-size:22px;font-weight:900;color:#4361EE;">+</span>
              <span style="font-size:18px;font-weight:800;color:#fff;">pipe</span>
              <span style="font-size:10px;background:rgba(67,97,238,.2);color:#4361EE;border-radius:6px;padding:2px 8px;letter-spacing:1px;font-weight:700;">BETA</span>
            </div>
            <h2 style="color:#0f172a;font-size:18px;margin:0 0 20px;">Novo Feedback Recebido</h2>
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;width:100px;">Nome</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:600;">${nome}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;">Assunto</td>
                  <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:600;">${assunto}</td></tr>
            </table>
            <div style="margin-top:20px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
              <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Mensagem</div>
              <div style="font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${mensagem}</div>
            </div>
            <div style="margin-top:24px;font-size:11px;color:#94a3b8;text-align:center;">Enviado via +Pipe Beta &bull; ${new Date().toLocaleString("pt-BR")}</div>
          </div>
        `,
      }),
    });

    if (r.ok) {
      return res.status(200).json({ ok: true });
    } else {
      const txt = await r.text();
      console.error("Resend error:", r.status, txt);
      return res.status(502).json({ error: "Falha ao enviar. Tente novamente." });
    }
  } catch (e) {
    console.error("Feedback error:", e.message);
    return res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}
