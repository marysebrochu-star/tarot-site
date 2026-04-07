const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function getProductCodeFromSession(session) {
  const amount = session.amount_total;

  if (amount === 1100) return "small";
  if (amount === 2200) return "medium";
  if (amount === 3300) return "deep";

  return "small";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let event;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Signature error:", err.message);
    return res.status(400).json({ error: err.message });
  }

  try {
    if (event.type !== "checkout.session.completed") {
      return res.status(200).json({ received: true, ignored: true });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const session = event.data.object;
    const sessionId = session.id;
    const productCode = getProductCodeFromSession(session);

    const { data: existing, error: existingError } = await supabase
      .from("paid_sessions")
      .select("session_id, draw_id")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (existingError) {
      console.error("Read paid_sessions error:", existingError.message);
      return res.status(500).json({ error: existingError.message });
    }

    if (existing) {
      return res.status(200).json({ received: true, already_processed: true });
    }

    const { data: drawId, error: rpcError } = await supabase.rpc(
      "create_draw_after_payment",
      { p_product_code: productCode }
    );

    if (rpcError) {
      console.error("RPC error:", rpcError.message);
      return res.status(500).json({ error: rpcError.message });
    }

    if (!drawId) {
      return res.status(500).json({ error: "No drawId returned" });
    }

    const { error: insertError } = await supabase
      .from("paid_sessions")
      .insert({
        session_id: sessionId,
        product_code: productCode,
        draw_id: Number(drawId),
        payment_status: "paid",
      });

    if (insertError) {
      console.error("Insert error:", insertError.message);
      return res.status(500).json({ error: insertError.message });
    }

   const customerEmail = session.customer_details?.email;

if (customerEmail) {
  const drawLink = `https://www.arcanaoracle.org/draw.html?id=${drawId}`;

  try {
    await resend.emails.send({
      from: "Arcana Oracle <onboarding@resend.dev>",
      to: customerEmail,
      subject: "✨ Votre tirage Arcana Oracle est prêt",
      html: `
        <div style="margin:0;padding:0;background:#05070d;font-family:Georgia,serif;color:#f5f5f5;">
          <div style="max-width:680px;margin:0 auto;padding:40px 20px;">
            
            <div style="text-align:center;padding:30px 20px 10px 20px;">
              <div style="font-size:34px;color:#d4af37;font-weight:bold;letter-spacing:2px;">
                ✨ Arcana Oracle ✨
              </div>
              <div style="margin-top:12px;font-size:18px;color:#d9d1b0;">
                Votre tirage mystique est prêt
              </div>
            </div>

            <div style="margin-top:30px;background:#0b1020;border:1px solid rgba(212,175,55,0.35);border-radius:16px;padding:40px 30px;text-align:center;box-shadow:0 0 30px rgba(0,0,0,0.35);">
              
              <h2 style="margin:0 0 20px 0;color:#d4af37;font-size:30px;">
                🔮 Votre tirage vous attend
              </h2>

              <p style="font-size:18px;line-height:1.7;color:#f5f5f5;margin:0 0 18px 0;">
                Merci pour votre confiance.
              </p>

              <p style="font-size:17px;line-height:1.7;color:#d9d9d9;margin:0 0 30px 0;">
                Les arcanes ont parlé.<br>
                Votre tirage personnalisé est maintenant disponible.
              </p>

              <a href="${drawLink}" style="display:inline-block;background:#d4af37;color:#05070d;text-decoration:none;padding:16px 28px;border-radius:10px;font-weight:bold;font-size:17px;">
                Voir mon tirage
              </a>

              <p style="margin:30px 0 0 0;font-size:15px;line-height:1.8;color:#cfcfcf;">
                Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br>
                <span style="color:#d4af37;">${drawLink}</span>
              </p>
            </div>

            <div style="text-align:center;padding:30px 20px 10px 20px;color:#b8b8b8;font-size:15px;line-height:1.8;">
              Que les arcanes éclairent votre chemin,<br>
              <span style="color:#d4af37;font-weight:bold;">Arcana Oracle</span>
            </div>

          </div>
        </div>
      `,
    });

    console.log("Email envoyé à :", customerEmail);
  } catch (emailError) {
    console.error("Erreur envoi email :", emailError.message);
  }
}
