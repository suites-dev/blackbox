// Static scanner fixtures only. Never execute this file.
// ruleid: blackbox-no-public-listen
server.listen(8080, '0.0.0.0');
// ruleid: blackbox-no-public-listen
server.listen(8080, '::', ready);
// ruleid: blackbox-no-public-listen
server.listen({ port: 8080, host: '0.0.0.0' });
// ok: blackbox-no-public-listen
server.listen(8080, '127.0.0.1');
// ok: blackbox-no-public-listen
server.listen(socketPath);
// ruleid: blackbox-no-shell-execution
spawn('echo', [input], { shell: true });
// ruleid: blackbox-no-shell-execution
import { exec } from 'node:child_process';
// ok: blackbox-no-shell-execution
spawn('echo', [input], { shell: false });
// ruleid: blackbox-no-disabled-tls
const insecure = { rejectUnauthorized: false };
// ruleid: blackbox-no-disabled-tls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// ok: blackbox-no-disabled-tls
const secure = { rejectUnauthorized: true };
// ruleid: blackbox-no-dynamic-eval
eval(input);
// ruleid: blackbox-no-dynamic-eval
new Function(input);
// ok: blackbox-no-dynamic-eval
JSON.parse(input);
