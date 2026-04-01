  } catch (err) {
  console.error("Webhook signature failed:", err.message);
  return res.status(400).json({ error: err.message });
};
  }

  try {
console.log("EVENT TYPE:", event.type);

if (event.type === "checkout.session.completed") {
  console.log("✅ INSIDE checkout.session.completed"); {
      const session = event.data.object;
      const sessionId = session.id;
      const productCode = getProductCodeFromSession(session);

      console.log("Session ID:", sessionId);
      console.log("Product code:", productCode);

      const { data: existing, error: existingError } = await supabase
        .from("paid_sessions")
        .select("session_id, draw_id")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (existingError) {
        console.error("ERROR:", err.message);
return res.status(200).json({ received: true });
      }

      if (existing) {
        console.log("Déjà traité");
        return res.status(200).json({ ok: true, already_processed: true });
      }

      const { data: drawId, error: rpcError } = await supabase.rpc(
        "create_draw_after_payment",
        { p_product_code: productCode }
      );

      if (rpcError) {
        console.error("ERROR:", err.message);
return res.status(200).json({ received: true });
      }

      if (!drawId) {
        console.error("ERROR:", err.message);
return res.status(200).json({ received: true });
      }

      console.log("Draw ID créé :", drawId);

      const { data: inserted, error: insertError } = await supabase
        .from("paid_sessions")
        .insert({
          session_id: sessionId,
          product_code: productCode,
          draw_id: Number(drawId),
          payment_status: "paid",
        })
        .select();

      if (insertError) {
        console.error("ERROR:", err.message);
return res.status(200).json({ received: true });
      }

      console.log("Insertion paid_sessions OK :", inserted);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
  console.error("Webhook server error:", err.message);
  return res.status(200).json({ received: true });
}
  }
}

