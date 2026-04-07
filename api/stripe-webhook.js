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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
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

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook runtime error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
