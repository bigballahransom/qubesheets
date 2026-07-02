#!/usr/bin/env node
// Reproduces the exact Chariot sync payload for a project and POSTs it to
// Chariot with timing/response logging. Read-only against Qube Sheets DB.
//
// Usage: node scripts/test-chariot-sync.mjs

import { MongoClient, ObjectId } from 'mongodb';
import 'dotenv/config';

const PROJECT_ID = '6a4444c888358bee52c7c7bc';
const ORG_ID = 'org_3FpDXY45tEPgT252UhAokofHyVr';
const JOB_ID = 742020;
const SYNC_OPTION = 'all'; // "Everything"
const INCLUDE_NOT_GOING = false;

const client = new MongoClient(process.env.MONGODB_URI);

function transform(item, weightConfig) {
  const total = item.quantity || 1;
  const isNotGoing = item.going === 'not going';
  const going = isNotGoing ? 0 : item.goingQuantity ?? total;
  const notMoving = Math.max(0, total - going);

  const unitVolume = item.cuft || 0;
  const unitWeight =
    weightConfig.weightMode === 'custom'
      ? unitVolume * weightConfig.customWeightMultiplier
      : item.weight || 0;

  const itemType = item.itemType || '';
  const isBox = ['packed_box', 'existing_box', 'boxes_needed'].includes(itemType);
  let displayName = item.name;
  if (item.packed_by === 'Crated') displayName = `Crated - ${item.name}`;
  else if (isBox) {
    if (item.packed_by === 'CP') displayName = `CP - ${item.name}`;
    else if (item.packed_by === 'PBO' || !item.packed_by || item.packed_by === 'N/A')
      displayName = `PBO - ${item.name}`;
  }

  const out = { name: displayName, quantity: going };
  if (item.location) out.room = item.location;
  if (item.description) out.description = item.description;
  if (item.special_handling) out.notes = item.special_handling;
  if (notMoving > 0) out.not_moving_quantity = notMoving;
  if (unitVolume > 0) out.volume = Math.round(unitVolume * 100) / 100;
  if (unitWeight > 0) out.weight = Math.round(unitWeight * 100) / 100;
  return out;
}

async function main() {
  await client.connect();
  const db = client.db('test');

  const project = await db.collection('projects').findOne({ _id: new ObjectId(PROJECT_ID) });
  const integration = await db.collection('chariotintegrations').findOne({ organizationId: ORG_ID });
  const orgSettings = await db.collection('organizationsettings').findOne({ organizationId: ORG_ID });

  const weightConfig = project.weightMode
    ? { weightMode: project.weightMode, customWeightMultiplier: project.customWeightMultiplier || 7 }
    : orgSettings?.weightMode
    ? { weightMode: orgSettings.weightMode, customWeightMultiplier: orgSettings.customWeightMultiplier || 7 }
    : { weightMode: 'actual', customWeightMultiplier: 7 };

  const allItems = await db.collection('inventoryitems').find({ projectId: new ObjectId(PROJECT_ID) }).toArray();

  const items = allItems.filter((item) => {
    if (item.going === 'not going' && !INCLUDE_NOT_GOING) return false;
    const itemType = item.itemType || 'regular_item';
    const isExistingBox = itemType === 'packed_box' || itemType === 'existing_box';
    const isRecommendedBox = itemType === 'boxes_needed';
    if (SYNC_OPTION === 'items_only') { if (isExistingBox || isRecommendedBox) return false; }
    else if (SYNC_OPTION === 'items_and_existing') { if (isRecommendedBox) return false; }
    return true;
  });

  const inventory_items = items.map((i) => transform(i, weightConfig));

  const totalVolume = inventory_items.reduce((s, ci) => s + (ci.volume ?? 0) * ci.quantity, 0);
  const totalWeight = inventory_items.reduce((s, ci) => s + (ci.weight ?? 0) * ci.quantity, 0);

  const existingInventoryId = project.metadata?.chariotSync?.chariotInventoryId;

  const payload = {
    meta: {
      auth_token: integration.authToken,
      ...(integration.accountId ? { account_id: integration.accountId } : {}),
    },
    job_id: JOB_ID,
    inventory_items,
    name: `Qube Sheets inventory — ${project.name || PROJECT_ID}`,
    category: 'Other',
    ...(existingInventoryId != null ? { id: existingInventoryId } : {}),
    ...(totalVolume > 0 ? { volume_override: Math.round(totalVolume * 100) / 100 } : {}),
    ...(totalWeight > 0 ? { weight_override: Math.round(totalWeight * 100) / 100 } : {}),
  };

  console.log(`\n📦 Project:      ${project.name} (${PROJECT_ID})`);
  console.log(`📦 Chariot job:  ${JOB_ID}`);
  console.log(`📦 Subdomain:    ${integration.clientSubdomain}`);
  console.log(`📦 Existing id:  ${existingInventoryId ?? '(none — will create new)'}`);
  console.log(`📦 Items:        ${inventory_items.length}`);
  console.log(`📦 Vol/Wt tot:   ${payload.volume_override ?? 0} cuft / ${payload.weight_override ?? 0} lb`);
  console.log(`📦 Payload size: ${JSON.stringify(payload).length} bytes`);

  const url = `https://${integration.clientSubdomain}.chariotmove.com/api/external/inventory`;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Auth-Token': integration.authToken,
    ...(integration.accountId ? { 'X-Account-Id': integration.accountId } : {}),
  };

  console.log(`\n📤 POST ${url}`);
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 min ceiling for the test

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`\n❌ FAILED after ${elapsed}ms:`, err.name, '-', err.message);
    await client.close();
    process.exit(1);
  } finally {
    clearTimeout(timeoutId);
  }

  const elapsed = Date.now() - start;
  const text = await response.text();
  console.log(`\n⏱  Elapsed:   ${elapsed}ms`);
  console.log(`📥 Status:    ${response.status} ${response.statusText}`);
  console.log(`📥 Headers:   content-type=${response.headers.get('content-type')}`);
  console.log(`📥 Body (first 2000 chars):\n${text.slice(0, 2000)}`);

  await client.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
