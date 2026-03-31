export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  console.log("MINIMAL WEBHOOK OK");
  return res.status(200).json({ ok: true, message: "webhook reached" });
}
