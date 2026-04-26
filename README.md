- ServiceA acts as the proxy — k6 always speaks plain HTTP to it, and ServiceA handles the REST-vs-gRPC split internally. Both paths hit identical processing logic in ServiceB, isolating the protocol overhead.
- Key design decisions
  - ServiceA gRPC client is a singleton — one persistent HTTP/2 connection with multiplexed streams, exactly how you'd use gRPC in production. REST uses a fresh connection per request (axios default), making the comparison fair at the protocol level.
  - ServiceB proto defines one RPC: ProcessData(DataRequest) → DataResponse. Both the REST and gRPC handler run the same CPU work so you're purely measuring serialization + transport.



---

- Good catch — partially yes, but not fully. Here's the honest breakdown:What IS already capturedThe end-to-end measured latency for the REST path already includes:
- axios in ServiceA internally calls JSON.stringify() before sending to ServiceB
- Express json() middleware in ServiceB calls JSON.parse() on receipt
- For gRPC, those two steps are replaced by Protobuf binary encode/decode. So the serialization cost difference is baked into the numbers — you just can't see it in isolation.What is NOT captured (the gap)The payload you're sending is a flat repeated string like "AAAAAAA...". That's the worst case for gRPC (strings are stored as raw UTF-8 in both formats, so there's no size advantage) and the best case for JSON (no nesting, no escaping, no type overhead).In real services, payloads are structured objects — nested fields, numbers, booleans, arrays — where JSON pays a tax on field name repetition and type encoding ("created_at": 1714000000 vs a 4-byte varint in proto), and where Protobuf's binary encoding really wins.With a flat string payload, you're underrepresenting how much REST serialization costs at scale.The fixUpdate the proto and both services to use a structured payload (realistic nested object), and add an explicit serialization micro-benchmark that measures just JSON.stringify vs protobuf.encode in isolation. Here are the changes:
