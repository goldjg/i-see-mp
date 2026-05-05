# dv-mcp (Deliberately Vulnerable MCP Demo Fixture)

⚠️ **Demo-only fixture. Do not use in production.**

`dv-mcp` is a local synthetic MCP fixture used to demonstrate deterministic
end-to-end lethal-trifecta testing in ISeeMP.

## Safety constraints

- Uses only synthetic fake data (`DV_MCP_FAKE_SECRET_*`, `CANARY-DV-*`)
- Rejects non-localhost outbound URLs
- Intended for local deterministic testing only
- Designed to exercise:
  `UNTRUSTED_CONTENT_EXPOSURE -> MODEL_CONTEXT -> READ_SECRET_HIGH -> SEND_EXTERNAL`

## Location

- Fixture: `examples/dv-mcp`
- E2E script: `scripts/dv-mcp-e2e.sh`
