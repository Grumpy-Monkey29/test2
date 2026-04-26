const express = require("express");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

// ─────────────────────────────────────────────
// Shared processing logic
// ─────────────────────────────────────────────
function processData({ id, payload, payload_size_kb }) {
  // Simulate lightweight CPU work proportional to payload size
  let hash = 0;
  const str = payload || "";
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return {
    id: id || "unknown",
    result: `processed-${Math.abs(hash).toString(16)}`,
    processed_at: Date.now(),
    bytes_received: Buffer.byteLength(str, "utf8"),
  };
}

// ─────────────────────────────────────────────
// REST server (port 3001)
// ─────────────────────────────────────────────
function startRestServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  app.post("/process", (req, res) => {
    const { id, payload, payload_size_kb } = req.body;
    const result = processData({ id, payload, payload_size_kb });
    res.json(result);
  });

  app.get("/health", (_req, res) => res.json({ status: "ok", protocol: "REST" }));

  app.listen(3001, () => {
    console.log("[ServiceB] REST server listening on port 3001");
  });
}

// ─────────────────────────────────────────────
// gRPC server (port 50051)
// ─────────────────────────────────────────────
function startGrpcServer() {
  const PROTO_PATH = path.join(__dirname, "proto", "service.proto");
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition).dataservice;

  const server = new grpc.Server();

  server.addService(proto.DataService.service, {
    ProcessData: (call, callback) => {
      const { id, payload, payload_size_kb } = call.request;
      const result = processData({ id, payload, payload_size_kb });
      callback(null, result);
    },
  });

  server.bindAsync(
    "0.0.0.0:50051",
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error("[ServiceB] gRPC bind error:", err);
        return;
      }
      console.log(`[ServiceB] gRPC server listening on port ${port}`);
    }
  );
}

// ─────────────────────────────────────────────
// Boot both servers
// ─────────────────────────────────────────────
startRestServer();
startGrpcServer();
