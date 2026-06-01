require('dotenv').config({ path: '/Users/andrewransom/Desktop/qubesheets/.env.local' });
const { EgressClient, RoomServiceClient } = require('livekit-server-sdk');

const ROOM = '69fa3b5ae5a82dbae9263b82-1778114582773-5b6b4abd';

(async () => {
  const egressClient = new EgressClient(
    process.env.LIVEKIT_URL,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET
  );

  console.log('Querying LiveKit egresses for room:', ROOM);
  const all = await egressClient.listEgress({ roomName: ROOM });
  console.log(`Found ${all.length} egress record(s)\n`);

  for (const e of all) {
    const started = e.startedAt ? new Date(Number(e.startedAt) / 1_000_000).toISOString() : null;
    const ended = e.endedAt ? new Date(Number(e.endedAt) / 1_000_000).toISOString() : null;
    const updated = e.updatedAt ? new Date(Number(e.updatedAt) / 1_000_000).toISOString() : null;
    const fileResults = (e.fileResults || []).map(f => ({
      filename: f.filename,
      location: f.location,
      duration: f.duration ? Number(f.duration) / 1e9 + 's' : null,
      size: f.size ? Number(f.size) : null,
      startedAt: f.startedAt ? new Date(Number(f.startedAt) / 1_000_000).toISOString() : null,
      endedAt: f.endedAt ? new Date(Number(f.endedAt) / 1_000_000).toISOString() : null,
    }));
    console.log('---');
    console.log({
      egressId: e.egressId,
      status: e.status,                          // numeric enum
      statusName: ['STARTING','ACTIVE','ENDING','COMPLETE','FAILED','ABORTED','LIMIT_REACHED'][e.status] || e.status,
      roomName: e.roomName,
      startedAt: started,
      endedAt: ended,
      updatedAt: updated,
      error: e.error,
      requestType: Object.keys(e).find(k => k.endsWith('Egress') || k.endsWith('Composite')),
      fileResults,
    });
  }
})().catch(err => { console.error('ERR', err); process.exit(1); });
