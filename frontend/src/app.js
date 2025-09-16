const root = document.getElementById("root");

if (root) {
  const status = document.createElement("p");
  status.textContent = "Estado del backend: pendiente de conexión";
  root.append(status);

  fetch("/api/health")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Respuesta inesperada: ${response.status}`);
      }
      return response.json();
    })
    .then((payload) => {
      status.textContent = `Estado del backend: ${payload.status ?? "desconocido"}`;
    })
    .catch((error) => {
      console.error("No se pudo verificar el backend", error);
      status.textContent = "Estado del backend: error al conectar";
    });
}
