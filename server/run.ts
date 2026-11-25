import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRunHttp } from "../src/lib/api.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await handleRunHttp(req, res);
}
