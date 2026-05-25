async function run() {
  const url = "https://new-pomah.lovable.app/api/fonnte?token=a45c575bd9d6c85f1f36ff8a1580af7f3536956070f5d2c0d1baa546875a5562";
  const payload = {
    sender: "6289999999999",
    message: "Halo, saya ingin tanya kamar",
    name: "Test User",
    id: "msg-id-" + Date.now()
  };

  console.log("Posting to", url);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    console.log("Status:", res.status);
    console.log("Response:", await res.text());
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
