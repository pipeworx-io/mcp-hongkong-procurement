# mcp-hongkong-procurement

Hong Kong Government Procurement MCP — GLD "Contracts Awarded" (keyless).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `hk_search_awards` | Search recently AWARDED Hong Kong government procurement contracts from the Government Logistics Department (GLD) "Contracts Awarded" open dataset (data.gov.hk, English). Returns each award with tender reference, subject/particulars, contractor, contract amount in HK$, and award date. Pass an optional query to filter by substring across subject, contractor, tender reference, and department (case-insensitive); omit query to list the most recent awards. Use for questions like "who won the HK water treatment contract", "Hong Kong government security guard contract awards", or "recent GLD contracts to <company>". |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "hongkong-procurement": {
      "url": "https://gateway.pipeworx.io/hongkong-procurement/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Hongkong Procurement data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
