import Table from "cli-table3";

export type Format = "json" | "pretty";

export function print<T>(data: T, format: Format, tableConfig?: {
  head: string[];
  rows: (item: T extends Array<infer U> ? U : T) => string[];
}): void {
  if (format === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  if (tableConfig && Array.isArray(data)) {
    const table = new Table({ head: tableConfig.head });
    for (const item of data) {
      table.push(tableConfig.rows(item as never));
    }
    console.log(table.toString());
    return;
  }
  // Fallback: pretty-print JSON
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

export function ok(message: string): void {
  // stderr so JSON stdout isn't polluted
  console.error(`✓ ${message}`);
}
