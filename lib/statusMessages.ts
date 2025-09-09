// lib/statusMessages.ts
// Utility functions for consistent status messaging throughout the app

export interface ImageStatus {
  status: 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed';
  processor?: string;
  itemCount?: number;
  error?: string;
}

export interface ProjectStatus {
  overallStatus: 'idle' | 'queued' | 'processing' | 'completed' | 'failed';
  summary: {
    total: number;
    completed: number;
    processing: number;
    queued: number;
    failed: number;
    totalItems: number;
  };
}

export function getImageStatusMessage(imageStatus: ImageStatus): string {
  switch (imageStatus.status) {
    case 'uploaded':
      return 'Ready for analysis';
    
    case 'queued':
      return 'Analysis queued ⏳';
    
    case 'processing':
      const processor = imageStatus.processor || 'AI';
      return `Analyzing with ${processor} ⚡`;
    
    case 'completed':
      const itemCount = imageStatus.itemCount || 0;
      return `✅ Complete - ${itemCount} item${itemCount === 1 ? '' : 's'} found`;
    
    case 'failed':
      return '❌ Analysis failed';
    
    default:
      return 'Unknown status';
  }
}

export function getImageStatusIcon(status: string): string {
  switch (status) {
    case 'uploaded': return '📷';
    case 'queued': return '⏳';
    case 'processing': return '⚡';
    case 'completed': return '✅';
    case 'failed': return '❌';
    default: return '📷';
  }
}

export function getProjectStatusMessage(projectStatus: ProjectStatus): string {
  const { overallStatus, summary } = projectStatus;
  
  switch (overallStatus) {
    case 'idle':
      if (summary.total === 0) {
        return 'Upload photos to start building your inventory';
      }
      return 'All images ready for analysis';
    
    case 'queued':
      return `${summary.queued} image${summary.queued === 1 ? '' : 's'} queued for analysis`;
    
    case 'processing':
      const processingCount = summary.processing + summary.queued;
      return `Analyzing ${processingCount} image${processingCount === 1 ? '' : 's'}... You can safely leave this page.`;
    
    case 'completed':
      if (summary.totalItems === 0) {
        return `${summary.completed} image${summary.completed === 1 ? '' : 's'} analyzed - No items found`;
      }
      return `✅ Analysis complete! Found ${summary.totalItems} inventory item${summary.totalItems === 1 ? '' : 's'}`;
    
    case 'failed':
      return '❌ Some images failed to analyze';
    
    default:
      return 'Unknown status';
  }
}

export function getUploadSuccessMessage(estimatedTime: string = '2-3 minutes'): string {
  return `Photo uploaded successfully! Analysis will complete automatically in ${estimatedTime}. You can safely close this page.`;
}

export function canUserLeave(status: string): boolean {
  // Users can always leave - processing continues in background
  return true;
}

export function getUserActionMessage(overallStatus: string): string {
  switch (overallStatus) {
    case 'processing':
    case 'queued':
      return '💡 Tip: Processing continues even if you close this page. Come back anytime to see your results!';
    
    case 'completed':
      return '🎉 Your inventory is ready! You can now review items and generate reports.';
    
    default:
      return '';
  }
}