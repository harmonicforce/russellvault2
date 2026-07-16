import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lookups = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'seed', 'lookups.json'), 'utf-8'));

const router = Router();

router.get('/', (_req, res) => {
  res.json(lookups);
});

export default router;
