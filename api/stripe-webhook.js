import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

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

    console.log("Constructing Stripe event...");

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("Stripe event constructed:", event.type);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      console.log("Session received:", {
        id: session.id,
        payment_status: session.payment_status,
        amount_total: session.amount_total,
        metadata: session.metadata,
        client_reference_id: session.client_reference_id,
      });

      const sessionId = session.id;
      const productCode = getProductCodeFromSession(session);

      console.log("Resolved productCode:", productCode);

      const { data: existing, error: existingError } = await supabase
        .from("paid_sessions")
        .select("session_id, draw_id")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (existingError) {
        console.error("Error checking existing paid session:", existingError.message);
        throw new Error(`Existing session check error: ${existingError.message}`);
      }

      if (existing) {
        console.log("Session already processed:", existing);
        return res.status(200).json({ received: true, already_processed: true });
      }

      console.log("Calling create_draw_after_payment...");

      const { data: drawId, error: rpcError } = await supabase.rpc(
        "create_draw_after_payment",
        { p_product_code: productCode }
      );

      if (rpcError) {
        console.error("RPC error:", rpcError.message);
        throw new Error(`RPC error: ${rpcError.message}`);
      }

      if (!drawId) {
        console.error("No draw id returned");
        throw new Error("No draw id returned by create_draw_after_payment");
      }

      console.log("Draw created:", drawId);

      const { error: insertError } = await supabase
        .from("paid_sessions")
        .insert({
          session_id: sessionId,
          product_code: productCode,
          draw_id: Number(drawId),
          payment_status: "paid",
        });

      if (insertError) {
        console.error("Insert paid_sessions error:", insertError.message);
        throw new Error(`Insert paid_sessions error: ${insertError.message}`);
      }

      console.log("paid_sessions insert OK");
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook server error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
