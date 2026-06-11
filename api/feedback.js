// api/feedback.js — Vercel serverless
// Sends feedback via nodemailer (Gmail SMTP) — no external API key needed.
// Required Vercel env vars:
//   GMAIL_USER    = seu-email@gmail.com
//   GMAIL_PASS    = senha-de-app-do-google (não a senha normal — gere em myaccount.google.com/apppasswords)
//
// To generate Gmail App Password:
//   1. Enable 2-factor auth on the Gmail account
//   2. Go to myaccount.google.com/apppasswords
//   3. Create password for "Mail" / "Other"
//   4. Copy the 16-char password → paste as GMAIL_PASS

import nodemailer from "nodemailer";

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

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;

  if (!gmailUser || !gmailPass) {
    // Dev fallback — log only
    console.log("[FEEDBACK - configure GMAIL_USER e GMAIL_PASS no Vercel]", { nome, assunto, mensagem });
    return res.status(200).json({ ok: true, mode: "log-only", warning: "Configure GMAIL_USER e GMAIL_PASS no Vercel." });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: '"+ Pipe Feedback" <' + gmailUser + '>',
      to: "andreip.heimann@gmail.com",
      replyTo: gmailUser, // reply goes to the sender, not exposing to user
      subject: "[+Pipe Beta] " + assunto.trim(),
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
          <div style="background:#0A0A0F;padding:20px 24px;border-radius:12px;margin-bottom:24px;">
            <span style="font-size:22px;font-weight:900;color:#4361EE;">+</span>
            <span style="font-size:18px;font-weight:800;color:#fff;margin-left:6px;">pipe</span>
            <span style="font-size:10px;background:rgba(67,97,238,.2);color:#4361EE;border-radius:6px;padding:2px 8px;letter-spacing:1px;font-weight:700;margin-left:10px;">BETA</span>
          </div>
          <h2 style="color:#0f172a;font-size:18px;margin:0 0 20px;">Novo Feedback Recebido</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px;width:100px;vertical-align:top;">Nome</td>
              <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:600;">${nome}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;vertical-align:top;">Assunto</td>
              <td style="padding:10px 0;color:#0f172a;font-size:13px;font-weight:600;">${assunto}</td>
            </tr>
          </table>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
            <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Mensagem</div>
            <div style="font-size:14px;color:#334155;line-height:1.7;white-space:pre-wrap;">${mensagem}</div>
          </div>
          <div style="margin-top:24px;font-size:11px;color:#94a3b8;text-align:center;">
            Enviado via +Pipe Beta — ${new Date().toLocaleString("pt-BR")}
          </div>
        </div>
      `,
    });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Nodemailer error:", e.message);
    return res.status(500).json({ error: "Erro ao enviar email. Verifique as configuracoes GMAIL_USER e GMAIL_PASS no Vercel." });
  }
}
