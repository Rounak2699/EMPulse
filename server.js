/**
 * MindScope / Excel MindPulse — Backend Server
 * Receives a PDF report from the frontend and emails it to the admin.
 *
 * Stack : Node.js · Express · Multer · Resend
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { Resend } = require("resend");

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";

if (!RESEND_API_KEY || !FROM_EMAIL || !ADMIN_EMAIL) {
  console.error(
    "❌  Missing required env vars. Copy .env.example → .env and fill it in."
  );
  process.exit(1);
}

// ─── Resend client ───────────────────────────────────────────────────────────
const resend = new Resend(RESEND_API_KEY);

// ─── Express setup ───────────────────────────────────────────────────────────
const app = express();

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// ─── Multer — keep PDF in memory (no disk writes needed) ─────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"), false);
    }
  },
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── POST /send-report ────────────────────────────────────────────────────────
/**
 * Expected multipart/form-data body:
 *   pdf          — the generated PDF file  (required)
 *   userName     — participant's full name  (optional, for the email subject)
 *   userEmail    — participant's email      (optional, CC copy to them)
 *   score        — overall score string     (optional, e.g. "72%")
 *   institution  — college / institution    (optional)
 *   department   — department               (optional)
 */
app.post("/send-report", upload.single("pdf"), async (req, res) => {
  try {
    // ── Validate PDF ─────────────────────────────────────────────────────────
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No PDF file received." });
    }

    // ── Pull metadata sent from the frontend ─────────────────────────────────
    const {
      userName = "Participant",
      userEmail = "",
      score = "N/A",
      institution = "N/A",
      department = "N/A",
    } = req.body;

    const dateStr = new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    const filename = `MindPulse-Report-${userName.replace(/\s+/g, "-")}-${Date.now()}.pdf`;

    // ── Build email payload ───────────────────────────────────────────────────
    const emailPayload = {
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject: `📊 MindPulse Report — ${userName} (${score}) — ${dateStr}`,
      html: buildEmailHtml({ userName, score, institution, department, dateStr }),
      attachments: [
        {
          filename,
          content: req.file.buffer, // Buffer from multer memory storage
        },
      ],
    };

    // Optional: CC the participant if they provided an email
    if (userEmail && isValidEmail(userEmail)) {
      emailPayload.cc = [userEmail];
    }

    // ── Send via Resend ───────────────────────────────────────────────────────
    const { data, error } = await resend.emails.send(emailPayload);

    if (error) {
      console.error("Resend error:", error);
      return res
        .status(502)
        .json({ success: false, error: "Failed to send email.", detail: error });
    }

    console.log(
      `✅  Report emailed | id=${data.id} | participant=${userName} | score=${score}`
    );
    return res.json({ success: true, emailId: data.id });
  } catch (err) {
    console.error("Server error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal server error." });
  }
});

// ─── Multer error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.message === "Only PDF files are accepted") {
    return res.status(400).json({ success: false, error: err.message });
  }
  console.error(err);
  res.status(500).json({ success: false, error: "Internal server error." });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀  MindScope backend running on http://localhost:${PORT}`);
  console.log(`   Admin reports → ${ADMIN_EMAIL}`);
  console.log(`   From address  → ${FROM_EMAIL}\n`);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Returns a clean, branded HTML body for the admin notification email.
 */
function buildEmailHtml({ userName, score, institution, department, dateStr }) {
  // Determine badge color based on score percentage
  const pct = parseInt(score) || 0;
  let badgeColor = "#d32f2f"; // < 30 — Burnout Risk
  let badgeLabel = "Burnout Risk";
  if (pct >= 80) { badgeColor = "#3ec9a7"; badgeLabel = "Perfect in Managing Stress"; }
  else if (pct >= 60) { badgeColor = "#4a8fe8"; badgeLabel = "Manageable Stress"; }
  else if (pct >= 40) { badgeColor = "#d4a843"; badgeLabel = "Facing Stress"; }
  else if (pct >= 30) { badgeColor = "#e8624a"; badgeLabel = "High Stress"; }

  return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MindPulse Report</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1f2937;padding:28px 36px;">
              <span style="font-size:22px;font-weight:800;color:#eeeae0;letter-spacing:-0.5px;">
                Excel Mind<span style="color:#d4a843;">Pulse</span>
              </span>
              <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;">
                Faculty Stress Assessment — Admin Report
              </p>
            </td>
          </tr>

          <!-- Gold divider -->
          <tr><td style="height:3px;background:linear-gradient(90deg,#d4a843,#f0c75a);"></td></tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
                A new psychometric assessment report has been submitted and is attached to this email.
              </p>

              <!-- Info card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
                <tr><td colspan="2" style="padding:12px 18px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;">
                  <span style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.1em;text-transform:uppercase;">Participant Details</span>
                </td></tr>
                ${infoRow("Name", userName)}
                ${infoRow("Institution", institution)}
                ${infoRow("Department", department)}
                ${infoRow("Report Date", dateStr)}
                <tr>
                  <td style="padding:10px 18px;font-size:12px;font-weight:600;color:#6b7280;width:140px;border-bottom:1px solid #e2e8f0;">Overall Score</td>
                  <td style="padding:10px 18px;border-bottom:1px solid #e2e8f0;">
                    <span style="display:inline-block;padding:3px 10px;background:${badgeColor}22;color:${badgeColor};border:1px solid ${badgeColor}55;border-radius:20px;font-size:12px;font-weight:700;">
                      ${score} — ${badgeLabel}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">
                The full 2-page PDF report is attached to this email. Please review it and take any necessary action.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">
                Excel MindPulse Psychometric Assessment · Confidential · ${dateStr}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function infoRow(label, value) {
  return `
    <tr>
      <td style="padding:10px 18px;font-size:12px;font-weight:600;color:#6b7280;width:140px;border-bottom:1px solid #e2e8f0;">${label}</td>
      <td style="padding:10px 18px;font-size:13px;color:#1f2937;border-bottom:1px solid #e2e8f0;">${value || "—"}</td>
    </tr>`;
}
