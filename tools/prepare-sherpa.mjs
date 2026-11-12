/** Pinned official Android runtime. Model weights are downloaded by the app. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const directory = new URL('../app/modules/dsh-voice/android/maven/com/k2fsa/sherpa/sherpa-onnx/2.0.1/', import.meta.url);
const artifact = new URL('sherpa-onnx-2.0.1.aar', directory);
const expected = 'a8d09d1d32f3eb8520482c6d3d43fae674681c5b050385967c70a3c2c9bf0ee7';
await mkdir(directory, { recursive: true });
let bytes = await readFile(artifact).catch(() => null);
const digest = (value) => createHash('sha256').update(value).digest('hex');
if (!bytes || digest(bytes) !== expected) {
  const response = await fetch('https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-2.0.1.aar', { signal: AbortSignal.timeout(240000) });
  if (!response.ok) throw new Error('Cannot download sherpa-onnx: HTTP ' + response.status);
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error('sherpa-onnx SHA-256 mismatch');
  await writeFile(artifact, bytes);
}
await writeFile(new URL('sherpa-onnx-2.0.1.pom', directory), '<project><modelVersion>4.0.0</modelVersion><groupId>com.k2fsa.sherpa</groupId><artifactId>sherpa-onnx</artifactId><version>2.0.1</version><packaging>aar</packaging></project>');
console.log('Verified sherpa-onnx Android 2.0.1 (' + bytes.length + ' bytes)');
