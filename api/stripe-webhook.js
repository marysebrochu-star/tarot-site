const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

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
  const metadata = session.metadata || {};

  if (metadata.product_code) return metadata.product_code;
  if (session.client_reference_id) return session.client_reference_id;

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

  console.log("Webhook hit");

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let event;

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("Stripe event:", event.type);
  } catch (err) {
    console.error("Signature error:", err.message);
    return res.status(400).json({ error: err.message });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const sessionId = session.id;
      const productCode = getProductCodeFromSession(session);

      console.log("Processing session:", sessionId);

      const { data: existing } = await supabase
        .from("paid_sessions")
        .select("*")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (existing) {
        console.log("Already processed");
        return res.status(200).json({ ok: true });
      }

      const { data: drawId, error: rpcError } = await supabase.rpc(
        "create_draw_after_payment",
        { p_product_code: productCode }
      );

      if (rpcError) {
        console.error("RPC error:", rpcError.message);
        throw rpcError;
      }

      await supabase.from("paid_sessions").insert({
        session_id: sessionId,
        product_code: productCode,
        draw_id: Number(drawId),
        payment_status: "paid",
      });

      console.log("Draw created:", drawId);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Server error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
