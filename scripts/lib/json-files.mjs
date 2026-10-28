import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
export async function readJsonFile(path){const bytes=await readFile(path);return JSON.parse((String(path).endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8'));}
