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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia",
  });

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
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const sessionId = session.id;

      const metadata = session.metadata || {};
      const productCode =
        metadata.product_code ||
        session.client_reference_id ||
        "small";

      const { data: existing } = await supabase
        .from("paid_sessions")
        .select("session_id, draw_id")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (existing) {
        return res.status(200).json({ received: true, already_processed: true });
      }

      const { data: drawId, error: rpcError } = await supabase.rpc(
        "create_draw_after_payment",
        { p_product_code: productCode }
      );

      if (rpcError) {
        throw new Error(`RPC error: ${rpcError.message}`);
      }

      if (!drawId) {
        throw new Error("No draw id returned by create_draw_after_payment");
      }

      const { error: insertError } = await supabase
        .from("paid_sessions")
        .insert({
          session_id: sessionId,
          product_code: productCode,
          draw_id: drawId,
          payment_status: "paid",
        });

      if (insertError) {
        throw new Error(`Insert paid_sessions error: ${insertError.message}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
