import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";

const mailConfigSchema = z.object({
  from: z.string().email(),
  username: z.string().email(),
  password: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.enum(["true", "false"]).transform((value) => value === "true"),
  requireTls: z.enum(["true", "false"]).transform((value) => value === "true"),
  appUrl: z.string().url(),
});

function getMailConfig() {
  const config = mailConfigSchema.parse({
    from: process.env.MAIL_FROM,
    username: process.env.MAIL_USERNAME,
    password: process.env.MAIL_PASSWORD,
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE,
    requireTls: process.env.SMTP_REQUIRE_TLS,
    appUrl: process.env.APP_URL,
  });
  const appUrl = new URL(config.appUrl);

  if (
    appUrl.username ||
    appUrl.password ||
    appUrl.pathname !== "/" ||
    appUrl.search ||
    appUrl.hash ||
    (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:")
  ) {
    throw new Error("APP_URL must be a public HTTPS URL in production.");
  }

  return { ...config, appUrl: appUrl.origin };
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const config = getMailConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: {
      user: config.username,
      pass: config.password,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transport.sendMail({
    from: config.from,
    to,
    subject: "Reset your BestAgentMedia password",
    text: [
      "We received a request to reset the password for your BestAgentMedia account.",
      "",
      `Choose a new password using this one-time link (valid for 30 minutes): ${resetUrl}`,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: `<p>We received a request to reset the password for your BestAgentMedia account.</p><p><a href="${resetUrl}">Choose a new password</a>. This one-time link is valid for 30 minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

export function getPasswordResetUrl(token: string) {
  const config = getMailConfig();
  const url = new URL("/reset-password", config.appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
