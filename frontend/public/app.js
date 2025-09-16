const chartsList = document.getElementById("charts");
const form = document.querySelector("#chart-form form");

async function fetchCharts() {
  try {
    const response = await fetch("/api/charts");
    if (!response.ok) {
      throw new Error("No se pudo obtener la lista de gráficas");
    }

    const charts = await response.json();
    renderCharts(charts);
  } catch (error) {
    console.error(error);
  }
}

function renderCharts(charts) {
  chartsList.innerHTML = "";
  charts.forEach((chart) => {
    const item = document.createElement("li");
    item.innerHTML = `<h3>${chart.title}</h3><p>${chart.description ?? ""}</p>`;
    chartsList.appendChild(item);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData);

  try {
    const response = await fetch("/api/charts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error ?? "Error creando la gráfica");
    }

    form.reset();
    await fetchCharts();
  } catch (error) {
    console.error(error);
  }
});

fetchCharts();
