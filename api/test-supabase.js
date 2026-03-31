const { createClient } = require("@supabase/supabase-js");

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const testSessionId = "test_" + Date.now();

    const { data, error } = await supabase
      .from("paid_sessions")
      .insert({
        session_id: testSessionId,
        product_code: "small",
        draw_id: 53,
        payment_status: "paid",
      })
      .select();

    if (error) {
      return res.status(500).json({
        step: "insert paid_sessions",
        error: error.message,
        details: error.details || null,
        hint: error.hint || null,
        code: error.code || null,
      });
    }

    return res.status(200).json({
      ok: true,
      inserted: data,
    });
  } catch (err) {
    return res.status(500).json({
      step: "server catch",
      error: err.message,
    });
  }
}
