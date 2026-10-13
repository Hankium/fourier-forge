// Writes the built-in test shapes to public/samples/*.svg so the upload flow can be tried with them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { SAMPLES } from '../src/lib/samples.js';

const dir = new URL('../public/samples/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const s of SAMPLES) writeFileSync(new URL(`${s.id}.svg`, dir), s.svg);
console.log(`wrote ${SAMPLES.length} samples to public/samples/`);
