import nodemailer, { type Transporter } from "nodemailer";

// Thin mail layer for notifications (successor of the legacy
// MailApp.sendEmail calls). Sends via SMTP when SMTP_URL is configured;
// otherwise logs and no-ops so dev environments work without credentials.
//
//   SMTP_URL     smtp://user:pass@host:587  (or smtps://…:465)
//   MAIL_FROM    display sender, e.g. "OPS Fusion <no-reply@example.com>"
//   NOTIFY_EMAIL staff inbox that receives system notifications

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const url = process.env.SMTP_URL;
  transporter = url ? nodemailer.createTransport(url) : null;
  return transporter;
}

/** Best-effort send — never throws; returns whether a mail went out. */
export async function sendMail(message: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const smtp = getTransporter();
  if (!smtp) {
    console.log(`[mailer] SMTP not configured — skipped "${message.subject}"`);
    return false;
  }
  try {
    await smtp.sendMail({
      from: process.env.MAIL_FROM ?? "OPS Fusion <no-reply@ops.local>",
      ...message,
    });
    return true;
  } catch (err) {
    console.error("[mailer] send failed:", err);
    return false;
  }
}

/** Staff inbox for system notifications, when configured. */
export function staffNotifyAddress(): string | null {
  return process.env.NOTIFY_EMAIL || null;
}
