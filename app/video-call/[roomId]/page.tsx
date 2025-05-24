// app/video-call/[roomId]/page.tsx
'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import VideoCallInventory from '@/components/video/VideoCallInventory';
import { Loader2 } from 'lucide-react';

export default function VideoCallPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, userId } = useAuth();
  
  const roomId = params.roomId as string;
  const projectId = searchParams.get('projectId');
  const participantName = searchParams.get('name') || 'Agent';
  
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    if (!isLoaded) return;
    
    if (!userId) {
      router.push('/sign-in');
      return;
    }

    if (!projectId) {
      router.push('/projects');
      return;
    }

    // Validate project access
    const validateAccess = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}`);
        if (!response.ok) {
          throw new Error('Invalid project');
        }
        setIsValidating(false);
      } catch (error) {
        console.error('Access validation failed:', error);
        router.push('/projects');
      }
    };

    validateAccess();
  }, [isLoaded, userId, projectId, router]);

  const handleCallEnd = () => {
    router.push(`/projects/${projectId}`);
  };

  if (!isLoaded || isValidating) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-500" />
          <p className="text-gray-600">Preparing video call...</p>
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