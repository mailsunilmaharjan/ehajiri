// One-off: generates a self-signed TLS cert for HTTPS when no real domain/CA
// cert is available yet (e.g. a bare-IP VPS). Run manually — not part of the
// normal boot path. Swap server/certs/* for a real cert (Let's Encrypt etc.)
// once a domain is pointed at the server; index.js just reads whatever is there.
import selfsigned from 'selfsigned';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const certDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../certs');
fs.mkdirSync(certDir, { recursive: true });

const host = process.argv[2] || 'localhost';
const attrs = [{ name: 'commonName', value: host }];
const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

const pems = await selfsigned.generate(attrs, {
  days: 3650,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'subjectAltName', altNames: [ isIp ? { type: 7, ip: host } : { type: 2, value: host } ] },
  ],
});

fs.writeFileSync(path.join(certDir, 'key.pem'), pems.private);
fs.writeFileSync(path.join(certDir, 'cert.pem'), pems.cert);
console.log(`Self-signed cert written to ${certDir} (valid 10 years, CN=${host})`);
