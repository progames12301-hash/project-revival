(() => {
  const INTERVAL_MS = 60_000;
  const $ = (id) => document.getElementById(id);
  const labels = {
    operational: "Operacional",
    degraded: "Lento",
    unavailable: "Indisponível",
  };
  let checking = false;
  let lastCheckAt = null;
  let nextCheckAt = 0;

  function safeText(value) {
    return value == null || value === "" ? "—" : String(value);
  }

  function render(services) {
    const counts = { operational: 0, degraded: 0, unavailable: 0 };
    services.forEach((service) => {
      if (Object.hasOwn(counts, service.status)) counts[service.status] += 1;
    });
    $("countOperational").textContent = counts.operational;
    $("countDegraded").textContent = counts.degraded;
    $("countUnavailable").textContent = counts.unavailable;
    $("countTotal").textContent = services.length;

    const unavailable = counts.unavailable;
    $("overallLabel").textContent = unavailable
      ? `${unavailable} serviço(s) precisam de atenção`
      : counts.degraded
        ? `${counts.degraded} serviço(s) respondendo com lentidão`
        : "Todos os serviços responderam";
    $("overallLabel").dataset.state = unavailable ? "unavailable" : counts.degraded ? "degraded" : "operational";

    const groups = new Map();
    services.forEach((service) => {
      if (!groups.has(service.group)) groups.set(service.group, []);
      groups.get(service.group).push(service);
    });

    const container = $("statusGroups");
    container.replaceChildren();
    groups.forEach((items, groupName) => {
      const section = document.createElement("section");
      section.className = "status-group";
      const head = document.createElement("div");
      head.className = "status-group-head";
      const title = document.createElement("h2");
      title.textContent = groupName;
      const total = document.createElement("span");
      const groupDown = items.filter((item) => item.status === "unavailable").length;
      total.textContent = groupDown ? `${items.length} itens · ${groupDown} indisponível(is)` : `${items.length} itens monitorados`;
      head.append(title, total);
      section.append(head);

      items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "status-item";
        const name = document.createElement("div");
        name.className = "status-item-name";
        const dot = document.createElement("i");
        dot.className = `state-dot ${item.status}`;
        const label = document.createElement("strong");
        label.textContent = item.name;
        name.append(dot, label);

        const chip = document.createElement("span");
        chip.className = `status-chip ${item.status}`;
        chip.textContent = labels[item.status] || "Sem informação";

        const latency = document.createElement("span");
        latency.className = "status-latency";
        latency.textContent = Number.isFinite(item.latencyMs) ? `${item.latencyMs} ms` : "—";

        const http = document.createElement("span");
        http.className = "status-http";
        http.textContent = item.httpStatus ? `HTTP ${item.httpStatus}` : safeText(item.detail);

        const checked = document.createElement("span");
        checked.className = "status-checked";
        checked.textContent = item.checkedAt
          ? new Date(item.checkedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
          : "—";
        checked.title = safeText(item.detail);
        row.append(name, chip, latency, http, checked);
        section.append(row);
      });
      container.append(section);
    });
  }

  async function refresh() {
    if (checking) return;
    checking = true;
    $("refreshStatus").disabled = true;
    $("refreshStatus").innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span> Consultando…';
    $("overallLabel").textContent = "Verificando os serviços cadastrados…";
    try {
      const response = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Falha ao consultar o monitor (HTTP ${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.services)) throw new Error("Resposta do monitor inválida.");
      render(payload.services);
      lastCheckAt = payload.checkedAt || new Date().toISOString();
      $("lastChecked").textContent = `Última verificação: ${new Date(lastCheckAt).toLocaleString("pt-BR")}`;
      nextCheckAt = Date.now() + (payload.intervalMs || INTERVAL_MS);
    } catch (error) {
      $("statusGroups").replaceChildren();
      const message = document.createElement("div");
      message.className = "status-error";
      message.textContent = error instanceof Error ? error.message : "Não foi possível consultar o monitor.";
      $("statusGroups").append(message);
      $("overallLabel").textContent = "Monitoramento temporariamente indisponível";
      $("lastChecked").textContent = "A consulta não foi concluída.";
      nextCheckAt = Date.now() + INTERVAL_MS;
    } finally {
      checking = false;
      $("refreshStatus").disabled = false;
      $("refreshStatus").innerHTML = '<span class="refresh-icon" aria-hidden="true">↻</span> Atualizar agora';
    }
  }

  $("refreshStatus").addEventListener("click", refresh);
  refresh();
  window.setInterval(() => {
    if (!checking && Date.now() >= nextCheckAt) refresh();
  }, 1000);
})();
