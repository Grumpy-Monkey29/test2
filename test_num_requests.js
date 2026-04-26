/**
 * test_num_requests.js
 *
 * Tests throughput: how many requests each protocol handles over a fixed window.
 * Alternates between REST and gRPC calls with the same small payload.
 *
 * Run:
 *   k6 run k6/test_num_requests.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

// ─── Custom per-protocol metrics ────────────────────────────────────────────
const restDuration = new Trend("rest_duration", true);   // true = time series
const grpcDuration = new Trend("grpc_duration", true);
const restErrors   = new Counter("rest_errors");
const grpcErrors   = new Counter("grpc_errors");

// ─── Test config ─────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    rest_scenario: {
      executor: "constant-vus",
      vus: 20,
      duration: "30s",
      exec: "restTest",
    },
    grpc_scenario: {
      executor: "constant-vus",
      vus: 20,
      duration: "30s",
      exec: "grpcTest",
    },
  },
  thresholds: {
    rest_duration: ["p(95)<2000"],
    grpc_duration: ["p(95)<2000"],
  },
};

const BASE_URL   = "http://localhost:3000";
const PAYLOAD_KB = 1;                              // small fixed payload
const PAYLOAD    = "x".repeat(PAYLOAD_KB * 1024);

const REST_HEADERS = { "Content-Type": "application/json" };

// ─── REST scenario ───────────────────────────────────────────────────────────
export function restTest() {
  const body = JSON.stringify({ id: `req-${__VU}-${__ITER}`, payload: PAYLOAD, payload_size_kb: PAYLOAD_KB });
  const res  = http.post(`${BASE_URL}/rest/call`, body, { headers: REST_HEADERS, tags: { protocol: "rest" } });

  const ok = check(res, { "REST status 200": (r) => r.status === 200 });
  if (!ok) restErrors.add(1);

  restDuration.add(res.timings.duration);
  sleep(0.01);
}

// ─── gRPC scenario ───────────────────────────────────────────────────────────
export function grpcTest() {
  const body = JSON.stringify({ id: `req-${__VU}-${__ITER}`, payload: PAYLOAD, payload_size_kb: PAYLOAD_KB });
  const res  = http.post(`${BASE_URL}/grpc/call`, body, { headers: REST_HEADERS, tags: { protocol: "grpc" } });

  const ok = check(res, { "gRPC status 200": (r) => r.status === 200 });
  if (!ok) grpcErrors.add(1);

  grpcDuration.add(res.timings.duration);
  sleep(0.01);
}

// ─── Summary → results/num_requests.json ─────────────────────────────────────
export function handleSummary(data) {
  const extract = (metric) => {
    const m = data.metrics[metric];
    if (!m) return null;
    return {
      avg_ms  : round(m.values.avg),
      min_ms  : round(m.values.min),
      max_ms  : round(m.values.max),
      p50_ms  : round(m.values["p(50)"]),
      p90_ms  : round(m.values["p(90)"]),
      p95_ms  : round(m.values["p(95)"]),
      p99_ms  : round(m.values["p(99)"]),
    };
  };

  const restReqs  = data.metrics["http_reqs"] ? data.metrics["http_reqs{protocol:rest}"]  : null;
  const grpcReqs  = data.metrics["http_reqs"] ? data.metrics["http_reqs{protocol:grpc}"]  : null;

  const result = {
    test        : "num_requests",
    vus         : 20,
    duration_s  : 30,
    payload_kb  : PAYLOAD_KB,
    rest: {
      ...extract("rest_duration"),
      total_requests : data.metrics["rest_errors"] ? data.metrics["rest_errors"].values.count || 0 : 0,
      error_count    : data.metrics["rest_errors"] ? data.metrics["rest_errors"].values.count || 0 : 0,
    },
    grpc: {
      ...extract("grpc_duration"),
      total_requests : data.metrics["grpc_errors"] ? data.metrics["grpc_errors"].values.count || 0 : 0,
      error_count    : data.metrics["grpc_errors"] ? data.metrics["grpc_errors"].values.count || 0 : 0,
    },
    raw: {
      rest_duration : extract("rest_duration"),
      grpc_duration : extract("grpc_duration"),
    },
  };

  // Recalculate totals from http_reqs tagged metrics
  const allMetrics = data.metrics;
  for (const key of Object.keys(allMetrics)) {
    if (key === "http_reqs{protocol:rest}") {
      result.rest.total_requests = allMetrics[key].values.count;
      result.rest.rps            = round(allMetrics[key].values.rate);
    }
    if (key === "http_reqs{protocol:grpc}") {
      result.grpc.total_requests = allMetrics[key].values.count;
      result.grpc.rps            = round(allMetrics[key].values.rate);
    }
  }

  return {
    "results/num_requests.json": JSON.stringify(result, null, 2),
    stdout: "\n✅  Results written to results/num_requests.json\n",
  };
}

function round(v) {
  return v !== undefined ? Math.round(v * 100) / 100 : null;
}
