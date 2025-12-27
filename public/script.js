async function run() {
  const raw = document.getElementById("code").value;
  const code = raw.startsWith(">") ? raw.slice(1) : raw;

  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });

  const data = await res.json();
  document.getElementById("out").textContent =
    data.ok ? data.result : data.error;
}
