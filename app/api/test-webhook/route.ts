import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  console.log('🟢 TEST WEBHOOK ENDPOINT REACHED!');
  return NextResponse.json({ status: 'success', message: 'Test webhook working' });
}

export async function GET(request: NextRequest) {
  console.log('🟢 TEST WEBHOOK GET ENDPOINT REACHED!');
  return NextResponse.json({ status: 'success', message: 'Test webhook GET working' });
}