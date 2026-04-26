/**
 * test_parallel.js
 *
 * Tests how REST vs gRPC scale with increasing concurrency.
 * VU levels: 1, 5, 20, 50, 100
 *
 * Run:
 *   k6 run k6/test_parallel.js
 */

import http from "k6/http";
import { check } from "k6";
import { Trend, Counter } from "k6/metrics";

const VU_LEVELS  = [1, 5, 20, 50, 100];
const PROTOCOLS  = ["rest", "grpc"];
const PAYLOAD_KB = 1;
const PAYLOAD    = "B".repeat(PAYLOAD_KB * 1024);

// Custom metrics per (protocol × vu_level)
const metrics = {};
for (const proto of PROTOCOLS) {
  for (const vus of VU_LEVELS) {
    const key = `${proto}_${vus}vu`;
    metrics[`${key}_duration`] = new Trend(`${key}_duration`, true);
    metrics[`${key}_errors`]   = new Counter(`${key}_errors`);
  }
}

// ─── Scenarios — sequential ramp-ups ─────────────────────────────────────────
// Each (protocol × vus) block runs for 15 s, 3 s gap between blocks.
export const options = {
  scenarios : {},
  thresholds: {},
};

const BLOCK_DURATION = 15;
const GAP            = 3;

let offset = 0;
for (const proto of PROTOCOLS) {
  for (const vus of VU_LEVELS) {
    const key = `${proto}_${vus}vu`;
    options.scenarios[key] = {
      executor  : "constant-vus",
      vus,
      duration  : `${BLOCK_DURATION}s`,
      startTime : `${offset}s`,
      exec      : `exec_${key}`,
      tags      : { protocol: proto, vus: `${vus}` },
    };
    options.thresholds[`${key}_duration`] = ["p(95)<10000"];
    offset += BLOCK_DURATION + GAP;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const BASE_URL = "http://localhost:3000";
const HEADERS  = { "Content-Type": "application/json" };

function makeCall(proto, vus) {
  const url  = `${BASE_URL}/${proto}/call`;
  const body = JSON.stringify({ id: `par-${vus}vu`, payload: PAYLOAD, payload_size_kb: PAYLOAD_KB });
  const res  = http.post(url, body, { headers: HEADERS, tags: { protocol: proto, vus: `${vus}` } });

  const key = `${proto}_${vus}vu`;
  const ok  = check(res, { [`${proto} ${vus}VUs status 200`]: (r) => r.status === 200 });
  if (!ok) metrics[`${key}_errors`].add(1);
  metrics[`${key}_duration`].add(res.timings.duration);
}

// Explicit exports (k6 requires named exports for exec references)
export const exec_rest_1vu   = () => makeCall("rest",  1);
export const exec_rest_5vu   = () => makeCall("rest",  5);
export const exec_rest_20vu  = () => makeCall("rest",  20);
export const exec_rest_50vu  = () => makeCall("rest",  50);
export const exec_rest_100vu = () => makeCall("rest",  100);
export const exec_grpc_1vu   = () => makeCall("grpc",  1);
export const exec_grpc_5vu   = () => makeCall("grpc",  5);
export const exec_grpc_20vu  = () => makeCall("grpc",  20);
export const exec_grpc_50vu  = () => makeCall("grpc",  50);
export const exec_grpc_100vu = () => makeCall("grpc",  100);

// ─── Summary → results/parallel.json ─────────────────────────────────────────
export function handleSummary(data) {
  const result = {
    test       : "parallel",
    payload_kb : PAYLOAD_KB,
    vu_levels  : {},
  };

  for (const vus of VU_LEVELS) {
    result.vu_levels[`${vus}vu`] = { rest: null, grpc: null };
    for (const proto of PROTOCOLS) {
      const key       = `${proto}_${vus}vu`;
      const durMetric = data.metrics[`${key}_duration`];
      const reqMetric = data.metrics[`http_reqs{protocol:${proto},vus:${vus}}`];

      if (durMetric) {
        result.vu_levels[`${vus}vu`][proto] = {
          avg_ms         : round(durMetric.values.avg),
          min_ms         : round(durMetric.values.min),
          max_ms         : round(durMetric.values.max),
          p50_ms         : round(durMetric.values["p(50)"]),
          p90_ms         : round(durMetric.values["p(90)"]),
          p95_ms         : round(durMetric.values["p(95)"]),
          p99_ms         : round(durMetric.values["p(99)"]),
          total_requests : reqMetric ? reqMetric.values.count : null,
          rps            : reqMetric ? round(reqMetric.values.rate) : null,
        };
      }
    }
  }

  return {
    "results/parallel.json": JSON.stringify(result, null, 2),
    stdout: "\n✅  Results written to results/parallel.json\n",
  };
}

function round(v) {
  return v !== undefined ? Math.round(v * 100) / 100 : null;
}
