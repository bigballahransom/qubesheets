// app/api/settings/box-recommendations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectMongoDB from '@/lib/mongodb';
import OrganizationSettings from '@/models/OrganizationSettings';
import { getAuthContext } from '@/lib/auth-helpers';

const MIN_LEVEL = 1;
const MAX_LEVEL = 3;
// Level 2 ("Balanced") matches the current Railway box-recommendation prompt.
// Keeping it as the default means existing orgs see no behavior change once
// the per-level prompt variants are wired into the worker.
const DEFAULT_LEVEL = 2;
const DEFAULT_ENABLED = true;

export async function GET(_request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Box recommendation settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const settings = await OrganizationSettings.findOne({
      organizationId: authContext.organizationId
    });

    return NextResponse.json({
      boxRecommendationsEnabled: settings?.boxRecommendationsEnabled ?? DEFAULT_ENABLED,
      boxRecommendationLevel: settings?.boxRecommendationLevel ?? DEFAULT_LEVEL
    });
  } catch (error) {
    console.error('Error fetching box recommendation settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch box recommendation settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authContext = await getAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }

    if (authContext.isPersonalAccount || !authContext.organizationId) {
      return NextResponse.json(
        { error: 'Box recommendation settings are only available for organization members' },
        { status: 403 }
      );
    }

    await connectMongoDB();

    const data = await request.json();
    const level = parseInt(data.boxRecommendationLevel, 10);

    if (Number.isNaN(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      return NextResponse.json(
        { error: `Box recommendation level must be an integer between ${MIN_LEVEL} and ${MAX_LEVEL}` },
        { status: 400 }
      );
    }

    // Enabled flag — accept boolean or omit (treat as true). Anything else is
    // a client bug and rejected.
    let enabled: boolean = DEFAULT_ENABLED;
    if (data.boxRecommendationsEnabled !== undefined) {
      if (typeof data.boxRecommendationsEnabled !== 'boolean') {
        return NextResponse.json(
          { error: 'boxRecommendationsEnabled must be a boolean' },
          { status: 400 }
        );
      }
      enabled = data.boxRecommendationsEnabled;
    }

    const settings = await OrganizationSettings.findOneAndUpdate(
      { organizationId: authContext.organizationId },
      {
        $set: {
          organizationId: authContext.organizationId,
          boxRecommendationsEnabled: enabled,
          boxRecommendationLevel: level
        }
      },
      { upsert: true, new: true, runValidators: true }
    );

    return NextResponse.json({
      boxRecommendationsEnabled: settings.boxRecommendationsEnabled ?? DEFAULT_ENABLED,
      boxRecommendationLevel: settings.boxRecommendationLevel
    }, { status: 200 });
  } catch (error) {
    console.error('Error saving box recommendation settings:', error);

    if (error instanceof Error && error.name === 'ValidationError') {
      return NextResponse.json(
        { error: 'Invalid box recommendation settings', details: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to save box recommendation settings' },
      { status: 500 }
    );
  }
}
