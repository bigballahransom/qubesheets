import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import connectMongoDB from '@/lib/mongodb';
import Template from '@/models/Template';

export async function GET() {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    // Query for template - prioritize org template if available
    let template = null;
    
    if (orgId) {
      template = await Template.findOne({
        organizationId: orgId,
        templateType: 'customer_instructions'
      });
    }
    
    // If no org template or not in org, look for personal template
    if (!template) {
      template = await Template.findOne({
        userId: userId,
        templateType: 'customer_instructions'
      });
    }

    if (!template) {
      return NextResponse.json({ error: 'No template found' }, { status: 404 });
    }

    return NextResponse.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { content } = body;

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // Determine context and name
    const isOrgContext = !!orgId;
    const templateData: any = {
      templateType: 'customer_instructions',
      name: 'Customer Upload Instructions',
      content: content,
      isActive: true
    };

    if (isOrgContext) {
      templateData.organizationId = orgId;
    } else {
      templateData.userId = userId;
    }

    // Use findOneAndUpdate with upsert to create or update
    const filter = isOrgContext 
      ? { organizationId: orgId, templateType: 'customer_instructions' }
      : { userId: userId, templateType: 'customer_instructions' };

    const template = await Template.findOneAndUpdate(
      filter,
      templateData,
      { 
        new: true, 
        upsert: true,
        runValidators: true 
      }
    );

    console.log('✅ Template saved successfully:', template._id);

    return NextResponse.json({
      success: true,
      template: template
    });

  } catch (error) {
    console.error('❌ Error saving template:', error);
    return NextResponse.json(
      { 
        error: 'Failed to save template',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    // Delete template based on context
    const filter = orgId 
      ? { organizationId: orgId, templateType: 'customer_instructions' }
      : { userId: userId, templateType: 'customer_instructions' };

    const deleted = await Template.findOneAndDelete(filter);

    if (!deleted) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Template deleted successfully' });

  } catch (error) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    );
  }
}