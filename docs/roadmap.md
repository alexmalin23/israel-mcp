# Roadmap

## Next services
- **Payment gateways** (Grow/Meshulam, Cardcom, Tranzila, Pelecard): payment links and transaction lookup first; charging saved tokens only behind a write flag + dry run.
- **Israel Post**: tracking (no official public API — needs scraping or a partner).
- **Bank of Israel history**: SDMX series for historical rates and the policy rate.

## Platform
- Per-user credentials (OAuth / encrypted key vault) for a hosted multi-tenant version.
- Response caching for public data (BOI once per business day, Hebcal per range).
- Publish to npm (`npx israel-mcp`) and the MCP registry.
