const BACKEND = "http://localhost:8080";
const FRONTEND = "http://localhost:3000";

const analyzeBtn = document.getElementById("analyzeBtn");
const statusMsg  = document.getElementById("statusMsg");
const urlDisplay = document.getElementById("currentUrl");

let currentUrl = "";

// Load the current tab's URL
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentUrl = tabs[0]?.url || "";
  urlDisplay.textContent = currentUrl || "No URL detected";
  
  // Disable if not a real web URL
  if (!currentUrl.startsWith("http")) {
    analyzeBtn.disabled = true;
    setStatus("error", "This page can't be analyzed.");
  }
});

analyzeBtn.addEventListener("click", async () => {
  if (!currentUrl) return;

  analyzeBtn.disabled = true;
  setStatus("loading", "Submitting to TrulyLied…");

  try {
    const res = await fetch(`${BACKEND}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: currentUrl }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Server error");
    }

    const data = await res.json();
    const reportId = data.report_id;

    setStatus("success", "✓ Analysis started! Opening report…");

    // Open the report page in a new tab
    setTimeout(() => {
      chrome.tabs.create({ url: `${FRONTEND}/report/${reportId}` });
    }, 800);

  } catch (e) {
    setStatus("error", `Error: ${e.message}`);
    analyzeBtn.disabled = false;
  }
});

function setStatus(type, text) {
  statusMsg.className = `status-msg ${type}`;
  if (type === "loading") {
    statusMsg.innerHTML = `<div class="spinner"></div> ${text}`;
  } else {
    statusMsg.textContent = text;
  }
}
