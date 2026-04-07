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
            <h2>✨ Votre tirage est prêt ✨</h2>
            <p>Merci pour votre confiance.</p>
            <p>Votre tirage est disponible ici :</p>
            <p><a href="${drawLink}">${drawLink}</a></p>
            <br>
            <p>Que les arcanes éclairent votre chemin 🔮</p>
            <p><strong>Arcana Oracle</strong></p>
          `,
        });

        console.log("Email envoyé à :", customerEmail);
      } catch (emailError) {
        console.error("Erreur envoi email :", emailError.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook runtime error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
