import type { VercelRequest, VercelResponse } from '@vercel/node';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    // Submit to waitlist
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    try {
      await sql`
        INSERT INTO waitlist (email)
        VALUES (${email.toLowerCase().trim()})
        ON CONFLICT (email) DO NOTHING
      `;

      return res.status(200).json({ success: true, message: 'Added to waitlist' });
    } catch (err) {
      console.error('Failed to add to waitlist:', err);
      return res.status(500).json({ error: 'Failed to add to waitlist' });
    }
  }

  if (req.method === 'GET') {
    // Get waitlist (admin only)
    const token = req.headers.authorization?.replace('Bearer ', '');
    const apiToken = process.env.API_TOKEN;

    if (!apiToken || token !== apiToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const entries = await sql<Array<{
        id: string;
        email: string;
        created_at: Date;
      }>>`
        SELECT id, email, created_at
        FROM waitlist
        ORDER BY created_at DESC
      `;

      return res.status(200).json({
        count: entries.length,
        entries: entries.map(e => ({
          id: e.id,
          email: e.email,
          created_at: e.created_at,
        })),
      });
    } catch (err) {
      console.error('Failed to fetch waitlist:', err);
      return res.status(500).json({ error: 'Failed to fetch waitlist' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
