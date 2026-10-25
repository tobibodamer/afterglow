// Serve the repository for interactive work in a normal browser:
//   node render/serve.mjs [--port 8137]
//   open http://127.0.0.1:8137/scene/index.html?preview&frame=600&N=4&w=960&h=540[&placeholders][&debug=coc]
// (Frame uploads are accepted and discarded.)
import { startServer } from './lib/server.mjs';
import { parseArgs } from './lib/util.mjs';

const a = parseArgs();
const { url } = await startServer(+(a.port || 8137), { onFrame: async () => {} });
console.log(`[serve] ${url}/scene/index.html?preview&frame=0&N=4&w=960&h=540`);
