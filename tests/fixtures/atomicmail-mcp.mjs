import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { appendFileSync } from 'node:fs';

appendFileSync(process.argv[2], 'started\n');
const server = new McpServer({ name: 'atomicmail-fixture', version: '1.0.0' }, {
  instructions: 'Atomic Mail fixture: call help before using this mailbox.',
});
for (const name of ['register', 'jmap_request', 'help']) {
  server.registerTool(name, { description: `Atomic Mail fixture ${name}`, inputSchema: {} },
    async () => ({ content: [{ type: 'text', text: 'Offline mailbox fixture' }] }));
}
await server.connect(new StdioServerTransport());
