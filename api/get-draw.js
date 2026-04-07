const { createClient } = require("@supabase/supabase-js");

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const sessionId = req.query.session_id;

  if (!sessionId) {
    return res.status(400).json({ error: "Missing session_id" });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from("paid_sessions")
      .select("draw_id, product_code, payment_status")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: "Draw not ready yet" });
    }

    return res.status(200).json({
      ok: true,
      draw_id: data.draw_id,
      product_code: data.product_code,
      payment_status: data.payment_status,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
