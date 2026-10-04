import 'dotenv/config';
import { createAppServer } from './app.ts';

const server = createAppServer();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT 必须是 1 到 65535 之间的整数');
await server.listen(port, host);
console.log(`幕间服务已启动：http://${host}:${port}`);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
