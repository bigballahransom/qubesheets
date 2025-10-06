// app/api/debug/connection-stats/route.ts - Monitor MongoDB connection health
import { NextResponse } from 'next/server';
import { getConnectionStats } from '@/lib/mongodb';

export async function GET() {
  try {
    const stats = getConnectionStats();
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      mongodb: stats,
      recommendations: {
        status: stats.connectionCount <= 10 ? 'healthy' : 'warning',
        message: stats.connectionCount <= 10 
          ? 'Connection count is within safe limits' 
          : `High connection count detected: ${stats.connectionCount}. Consider restarting the app.`
      }
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: 'Failed to get connection stats',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}