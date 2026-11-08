import { createFileRoute } from "@tanstack/react-router";
import { SERVICES, STATUS_INTERVAL_MS } from "@/lib/status-services";

const REQUEST_TIMEOUT_MS = 12_000;

type CheckStatus = "operational" | "degraded" | "unavailable";

async function checkService(service: (typeof SERVICES)[number]) {
  const started = performance.now();
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(service.url, {
      method: service.method ?? "GET",
      headers: {
        Accept: service.kind === "image"
          ? "image/avif,image/webp,image/png,image/gif,*/*"
          : "*/*",
        ...(service.body ? { "Content-Type": "application/json" } : {}),
      },
      body: service.method === "POST" ? service.body : undefined,
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const latencyMs = Math.round(performance.now() - started);
    await response.body?.cancel().catch(() => undefined);

    const status: CheckStatus = !response.ok
      ? "unavailable"
      : latencyMs >= 5_000
        ? "degraded"
        : "operational";

    return {
      id: service.id,
      name: service.name,
      group: service.group,
      status,
      httpStatus: response.status,
      latencyMs,
      checkedAt,
      detail: response.ok
        ? (status === "degraded" ? "Resposta lenta" : "Resposta HTTP válida")
        : `HTTP ${response.status} · ${response.statusText || "resposta inválida"}`,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const message = error instanceof Error
      ? (error.name === "TimeoutError" || error.name === "AbortError"
          ? "Tempo limite excedido"
          : error.message)
      : "Falha de conexão";

    return {
      id: service.id,
      name: service.name,
      group: service.group,
      status: "unavailable" as const,
      httpStatus: null,
      latencyMs,
      checkedAt,
      detail: message || "Falha de conexão",
    };
  }
}

export const Route = createFileRoute("/api/status")({
  server: {
    handlers: {
      GET: async () => {
        const checkedAt = new Date().toISOString();
        const services = await Promise.all(SERVICES.map(checkService));
        return Response.json(
          { checkedAt, intervalMs: STATUS_INTERVAL_MS, services },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
              "X-Content-Type-Options": "nosniff",
            },
          },
        );
      },
    },
  },
});
