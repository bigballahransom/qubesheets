// app/video-call/[roomId]/page.tsx - Fixed for customer access
'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import VideoCallInventory from '@/components/video/VideoCallInventory';
import { Loader2, AlertCircle } from 'lucide-react';

export default function VideoCallPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, userId } = useAuth();
  
  const roomId = params?.roomId as string;
  const projectId = searchParams?.get('projectId');
  const participantName = searchParams?.get('name') || 'Participant';
  
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [callStartTime] = useState(new Date());

  useEffect(() => {
    // For customers (non-authenticated users), we need different validation
    const isAgent = participantName.toLowerCase().includes('agent');
    
    if (isAgent) {
      // Agents must be authenticated
      if (!isLoaded) return; // Wait for auth to load
      
      if (!userId) {
        router.push('/sign-in');
        return;
      }
    }
    // For customers, we don't need to wait for auth to load

    if (!projectId) {
      setValidationError('Invalid video call link - missing project information');
      setIsValidating(false);
      return;
    }

    // Validate access based on user type
    const validateAccess = async () => {
      try {
        if (isAgent && userId) {
          // For agents, validate they own the project
          const response = await fetch(`/api/projects/${projectId}`);
          if (!response.ok) {
            throw new Error('Project not found or access denied');
          }
        } else {
          // For customers, just validate the project exists (no auth required)
          const response = await fetch(`/api/projects/${projectId}/public-info`);
          if (!response.ok) {
            // Fallback: try to validate the room ID format
            if (!roomId || !roomId.includes(projectId)) {
              throw new Error('Invalid video call link');
            }
            // If we can't validate the project but the room format looks right,
            // allow the customer to proceed (the LiveKit room will handle final validation)
          }
        }
        
        setIsValidating(false);
      } catch (error) {
        console.error('Access validation failed:', error);
        
        if (isAgent) {
          // Agents should be redirected to projects page
          router.push('/projects');
        } else {
          // Customers should see an error message, not be redirected
          setValidationError(
            error instanceof Error ? error.message : 'Unable to join video call'
          );
          setIsValidating(false);
        }
      }
    };

    validateAccess();
  }, [isLoaded, userId, projectId, roomId, participantName, router]);

  const handleCallEnd = async () => {
    const isAgent = participantName.toLowerCase().includes('agent');
    
    // Log the video call activity
    try {
      const callEndTime = new Date();
      const duration = Math.round((callEndTime.getTime() - callStartTime.getTime()) / 1000); // Duration in seconds
      
      const response = await fetch(`/api/projects/${projectId}/log-video-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId,
          duration,
          participantCount: isAgent ? 2 : 1, // Assume agent + customer, or just customer
          userName: participantName
        })
      });
      
      if (response.ok) {
        console.log('✅ Video call activity logged');
      } else {
        console.warn('⚠️ Failed to log video call activity:', await response.text());
      }
    } catch (logError) {
      console.warn('⚠️ Failed to log video call activity:', logError);
      // Don't fail the navigation if logging fails
    }
    
    if (isAgent && userId) {
      // Agents go back to their project
      router.push(`/projects/${projectId}`);
    } else {
      // Customers get a thank you message or go to a landing page
      router.push('/call-complete');
    }
  };

  if ((!isLoaded && participantName.toLowerCase().includes('agent')) || isValidating) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600">Preparing video call...</p>
          <p className="text-sm text-gray-500 mt-2">
            Joining as: {participantName}
          </p>
        </div>
      </div>
    );
  }

  if (validationError) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-xl shadow-lg text-center max-w-md">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Unable to Join Call
          </h2>
          <p className="text-gray-600 mb-4">{validationError}</p>
          <p className="text-sm text-gray-500">
            Please contact your moving company for assistance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <VideoCallInventory
      projectId={projectId!}
      roomId={roomId}
      participantName={participantName}
      onCallEnd={handleCallEnd}
    />
  );
}