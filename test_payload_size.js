/**
 * test_payload_size.js
 *
 * Tests how REST vs gRPC handle different payload sizes.
 * Sizes: 1 KB, 10 KB, 100 KB, 500 KB
 *
 * Run:
 *   k6 run k6/test_payload_size.js
 */

import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

// Custom metrics per (protocol × size)
const metrics = {};
const SIZES_KB = [1, 10, 100, 500];
const PROTOCOLS = ["rest", "grpc"];

for (const proto of PROTOCOLS) {
  for (const kb of SIZES_KB) {
    const key = `${proto}_${kb}kb`;
    metrics[`${key}_duration`] = new Trend(`${key}_duration`, true);
    metrics[`${key}_errors`]   = new Counter(`${key}_errors`);
  }
}

// ─── Build payloads once (avoids regenerating per iteration) ─────────────────
const payloads = {};
for (const kb of SIZES_KB) {
  payloads[kb] = "A".repeat(kb * 1024);
}

// ─── Test config — one scenario per (protocol × size) ────────────────────────
export const options = {
  scenarios: {},
  thresholds: {},
};

let startOffset = 0;
for (const proto of PROTOCOLS) {
  for (const kb of SIZES_KB) {
    const key = `${proto}_${kb}kb`;
    options.scenarios[key] = {
      executor   : "constant-vus",
      vus        : 10,
      duration   : "20s",
      startTime  : `${startOffset}s`,
      exec       : `exec_${key}`,
      tags       : { protocol: proto, size_kb: `${kb}` },
    };
    options.thresholds[`${key}_duration`] = ["p(95)<5000"];
    startOffset += 22; // 20s run + 2s gap
  }
}

// ─── Executor functions (one per scenario) ────────────────────────────────────
const BASE_URL = "http://localhost:3000";
const HEADERS  = { "Content-Type": "application/json" };

function makeCall(proto, kb) {
  const url  = `${BASE_URL}/${proto}/call`;
  const body = JSON.stringify({ id: `sz-test-${kb}kb`, payload: payloads[kb], payload_size_kb: kb });
  const res  = http.post(url, body, { headers: HEADERS, tags: { protocol: proto, size_kb: `${kb}` } });

  const key = `${proto}_${kb}kb`;
  const ok  = check(res, { [`${proto} ${kb}KB status 200`]: (r) => r.status === 200 });
  if (!ok) metrics[`${key}_errors`].add(1);
  metrics[`${key}_duration`].add(res.timings.duration);
}

// Dynamically create exported functions
for (const proto of PROTOCOLS) {
  for (const kb of SIZES_KB) {
    const key = `${proto}_${kb}kb`;
    // k6 needs exported named functions — use globalThis trick
    globalThis[`exec_${key}`] = () => makeCall(proto, kb);
  }
}

export const exec_rest_1kb   = () => makeCall("rest",  1);
export const exec_rest_10kb  = () => makeCall("rest",  10);
export const exec_rest_100kb = () => makeCall("rest",  100);
export const exec_rest_500kb = () => makeCall("rest",  500);
export const exec_grpc_1kb   = () => makeCall("grpc",  1);
export const exec_grpc_10kb  = () => makeCall("grpc",  10);
export const exec_grpc_100kb = () => makeCall("grpc",  100);
export const exec_grpc_500kb = () => makeCall("grpc",  500);

// ─── Summary → results/payload_size.json ─────────────────────────────────────
export function handleSummary(data) {
  const result = {
    test   : "payload_size",
    vus    : 10,
    sizes  : {},
  };

  for (const kb of SIZES_KB) {
    result.sizes[`${kb}kb`] = { rest: null, grpc: null };
    for (const proto of PROTOCOLS) {
      const key      = `${proto}_${kb}kb`;
      const durMetric = data.metrics[`${key}_duration`];
      if (durMetric) {
        result.sizes[`${kb}kb`][proto] = {
          avg_ms : round(durMetric.values.avg),
          min_ms : round(durMetric.values.min),
          max_ms : round(durMetric.values.max),
          p50_ms : round(durMetric.values["p(50)"]),
          p90_ms : round(durMetric.values["p(90)"]),
          p95_ms : round(durMetric.values["p(95)"]),
          p99_ms : round(durMetric.values["p(99)"]),
        };
      }
    }
  }

  return {
    "results/payload_size.json": JSON.stringify(result, null, 2),
    stdout: "\n✅  Results written to results/payload_size.json\n",
  };
}

function round(v) {
  return v !== undefined ? Math.round(v * 100) / 100 : null;
}
