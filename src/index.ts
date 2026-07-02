interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Hong Kong Government Procurement MCP — GLD "Contracts Awarded" (keyless).
 *
 * Wraps the public, no-auth open dataset published by the Hong Kong Government
 * Logistics Department (GLD) via data.gov.hk. The English CSV at
 * https://www.gld.gov.hk/datagovhk/procurement/ContractsAwarded_EN.csv lists
 * recently awarded government supplies/services contracts.
 *
 * The source has no server-side search, so the whole CSV (currently ~100 rows,
 * ~16 KB) is fetched and filtered client-side by a substring query.
 *
 * Real columns: Tender Reference, Particulars, Contractor(s), Amount,
 * Contract Award Date. There is no explicit department column — the awarding
 * department is named inside the Particulars text.
 *
 * All tools return shaped, LLM-friendly objects (not raw CSV passthrough) and
 * never throw — fetch/parse failures resolve to { error }.
 */


const CSV_URL = 'https://www.gld.gov.hk/datagovhk/procurement/ContractsAwarded_EN.csv';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'hk_search_awards',
    description:
      'Search recently AWARDED Hong Kong government procurement contracts from the Government Logistics Department (GLD) "Contracts Awarded" open dataset (data.gov.hk, English). Returns each award with tender reference, subject/particulars, contractor, contract amount in HK$, and award date. Pass an optional query to filter by substring across subject, contractor, tender reference, and department (case-insensitive); omit query to list the most recent awards. Use for questions like "who won the HK water treatment contract", "Hong Kong government security guard contract awards", or "recent GLD contracts to <company>".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional case-insensitive substring to filter awards by subject/particulars, contractor name, tender reference, or department (e.g. "security guard", "Water Supplies Department", "Zung Fu"). Omit to list all current awards.',
        },
        limit: {
          type: ['number', 'string'],
          description: 'Maximum number of awards to return. Default 25, max 100.',
        },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'hk_search_awards':
        return await searchAwards(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

interface Award {
  reference: string;
  subject: string;
  contractor: string;
  amount_hkd: number | null;
  amount_raw: string;
  award_date: string;
  department: string | null;
}

async function searchAwards(args: Record<string, unknown>): Promise<unknown> {
  const query = strArg(args.query);
  const limit = clampLimit(args.limit, 25, 100);

  const rows = await fetchAwards();

  let matched = rows;
  if (query) {
    const q = query.toLowerCase();
    matched = rows.filter((a) =>
      [a.reference, a.subject, a.contractor, a.department ?? '']
        .some((f) => f.toLowerCase().includes(q))
    );
  }

  const awards = matched.slice(0, limit);
  return {
    source: 'HK Government Logistics Department — Contracts Awarded (data.gov.hk)',
    query: query ?? null,
    total_available: rows.length,
    matched: matched.length,
    count: awards.length,
    awards,
  };
}

async function fetchAwards(): Promise<Award[]> {
  const csv = await csvGet(CSV_URL);
  const table = parseCsv(csv);
  if (!table.length) return [];

  // Locate columns by header name (defensive against reordering).
  const header = table[0].map((h) => h.trim().toLowerCase());
  const idx = (want: string) => header.findIndex((h) => h.includes(want));
  const iRef = idx('reference');
  const iSubject = idx('particular');
  const iContractor = idx('contractor');
  const iAmount = idx('amount');
  const iDate = idx('date');

  const out: Award[] = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row.length || row.every((c) => !c.trim())) continue;
    const subject = cell(row, iSubject);
    const amountRaw = cell(row, iAmount);
    out.push({
      reference: cell(row, iRef),
      subject,
      contractor: cell(row, iContractor),
      amount_hkd: parseAmount(amountRaw),
      amount_raw: amountRaw,
      award_date: cell(row, iDate),
      department: extractDepartment(subject),
    });
  }
  return out;
}

function cell(row: string[], i: number): string {
  if (i < 0 || i >= row.length) return '';
  return (row[i] ?? '').trim();
}

// Amount looks like: "HK$9,102,384.00 " or "HK$134,621,800.00 F.I.S./Hong Kong"
// or "Not applicable". Extract the leading HK$ figure to a number; null if none.
function parseAmount(raw: string): number | null {
  const m = raw.match(/HK\$\s*([\d,]+(?:\.\d+)?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Department is embedded in the particulars, typically as
// "... to/for the <Something> Department" / "... Trading Fund" / "... Agency".
function extractDepartment(subject: string): string | null {
  const m = subject.match(
    /\b(?:to|for|of)\s+the\s+([A-Z][A-Za-z&/,'()\- ]*?(?:Department|Agency|Fund|Judiciary|Office|Bureau|Government[A-Za-z ]*))/,
  );
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

async function csvGet(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: 'text/csv,text/plain,*/*', 'User-Agent': UA },
  });
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`HK GLD Contracts Awarded: ${res.status} ${body}`.trim());
  }
  return res.text();
}

// Minimal RFC-4180 CSV parser: handles quoted fields, escaped ("") quotes,
// commas and newlines inside quotes, and a leading UTF-8 BOM.
function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function clampLimit(v: unknown, def: number, max: number): number {
  let n = def;
  if (typeof v === 'number' && Number.isFinite(v)) n = v;
  else if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) n = Number(v);
  n = Math.floor(n);
  if (n < 1) n = 1;
  if (n > max) n = max;
  return n;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
