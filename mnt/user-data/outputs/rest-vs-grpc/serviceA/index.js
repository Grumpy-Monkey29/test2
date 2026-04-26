const express = require("express");
const axios = require("axios");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const SERVICE_B_REST = "http://localhost:3001";
const SERVICE_B_GRPC_HOST = "localhost:50051";

// ─────────────────────────────────────────────
// Bootstrap gRPC client (singleton, reused across requests)
// This is important: gRPC uses persistent HTTP/2 connections,
// so we create the client once and reuse it — mirroring real-world usage.
// ─────────────────────────────────────────────
const PROTO_PATH = path.join(__dirname, "proto", "service.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDefinition).dataservice;

const grpcClient = new proto.DataService(
  SERVICE_B_GRPC_HOST,
  grpc.credentials.createInsecure(),
  {
    // Allow large messages for payload-size tests
    "grpc.max_receive_message_length": 50 * 1024 * 1024,
    "grpc.max_send_message_length": 50 * 1024 * 1024,
  }
);

// Promisify the gRPC unary call
function grpcProcessData(requestData) {
  return new Promise((resolve, reject) => {
    grpcClient.ProcessData(requestData, (err, response) => {
      if (err) return reject(err);
      resolve(response);
    });
  });
}

// ─────────────────────────────────────────────
// Express App
// ─────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "50mb" }));

/**
 * POST /rest/call
 * ServiceA → ServiceB via REST (HTTP/1.1 + JSON)
 */
app.post("/rest/call", async (req, res) => {
  const startTime = process.hrtime.bigint();
  try {
    const { id, payload, payload_size_kb } = req.body;
    const response = await axios.post(
      `${SERVICE_B_REST}/process`,
      { id, payload, payload_size_kb },
      { headers: { "Content-Type": "application/json" } }
    );
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    res.json({
      protocol: "REST",
      duration_ms: durationMs,
      service_b_response: response.data,
    });
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    res.status(500).json({ protocol: "REST", error: err.message, duration_ms: durationMs });
  }
});

/**
 * POST /grpc/call
 * ServiceA → ServiceB via gRPC (HTTP/2 + Protobuf)
 */
app.post("/grpc/call", async (req, res) => {
  const startTime = process.hrtime.bigint();
  try {
    const { id, payload, payload_size_kb } = req.body;
    const response = await grpcProcessData({ id, payload: payload || "", payload_size_kb: payload_size_kb || 0 });
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    res.json({
      protocol: "gRPC",
      duration_ms: durationMs,
      service_b_response: response,
    });
  } catch (err) {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    res.status(500).json({ protocol: "gRPC", error: err.message, duration_ms: durationMs });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────
app.listen(3000, () => {
  console.log("[ServiceA] Listening on port 3000");
  console.log("  POST /rest/call  → ServiceB via REST");
  console.log("  POST /grpc/call  → ServiceB via gRPC");
});
