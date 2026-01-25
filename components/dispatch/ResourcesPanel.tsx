'use client';

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import {
  Truck as TruckIcon,
  User,
  Plus,
  MoreVertical,
  Search,
  Settings,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Truck, CrewMember } from './types';

interface ResourcesPanelProps {
  trucks: Truck[];
  crew: CrewMember[];
}

function DraggableTruckCard({ truck }: { truck: Truck }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `truck-${truck.id}`,
    data: { type: 'truck', truck },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  const statusColors = {
    available: 'bg-green-500',
    on_job: 'bg-amber-500',
    unavailable: 'bg-gray-400',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'bg-background border rounded-lg p-3 cursor-grab active:cursor-grabbing',
        'hover:border-primary/50 hover:shadow-sm transition-all',
        isDragging && 'shadow-lg ring-2 ring-primary/20'
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-bold"
            style={{ backgroundColor: truck.color }}
          >
            {truck.name.substring(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-sm leading-tight">{truck.name}</p>
            <p className="text-xs text-muted-foreground">
              {truck.capacity} ft³ • {truck.crewSize} crew
            </p>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit truck</DropdownMenuItem>
            <DropdownMenuItem>View schedule</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">Remove</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-wrap gap-1 mb-2">
        {truck.features.map((feature) => (
          <Badge key={feature} variant="secondary" className="text-xs px-1.5 py-0">
            {feature}
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{truck.hoursToday} hrs today</span>
        <span className={cn('w-2 h-2 rounded-full', statusColors[truck.status])} />
      </div>
    </div>
  );
}

function DraggableCrewCard({ member }: { member: CrewMember }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `crew-${member.id}`,
    data: { type: 'crew', member },
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  const statusColors = {
    available: 'bg-green-500',
    on_job: 'bg-amber-500',
    off: 'bg-gray-400',
  };

  const roleLabels = {
    driver: 'Driver',
    mover: 'Mover',
    lead: 'Lead',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        'bg-background border rounded-lg p-3 cursor-grab active:cursor-grabbing',
        'hover:border-primary/50 hover:shadow-sm transition-all',
        isDragging && 'shadow-lg ring-2 ring-primary/20'
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium text-sm">{member.name}</p>
            <p className="text-xs text-muted-foreground">
              {roleLabels[member.role]} • {member.hoursToday} hrs
            </p>
          </div>
        </div>
        <span className={cn('w-2 h-2 rounded-full', statusColors[member.status])} />
      </div>
    </div>
  );
}

export function ResourcesPanel({ trucks, crew }: ResourcesPanelProps) {
  const [activeTab, setActiveTab] = useState<'trucks' | 'crew'>('trucks');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTrucks = trucks.filter((truck) =>
    truck.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCrew = crew.filter((member) =>
    member.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="w-60 bg-card border-r flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Resources</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-muted rounded-lg p-1">
          <button
            onClick={() => setActiveTab('trucks')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'trucks'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <TruckIcon className="h-3 w-3 inline mr-1" />
            Trucks ({trucks.length})
          </button>
          <button
            onClick={() => setActiveTab('crew')}
            className={cn(
              'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors',
              activeTab === 'crew'
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <User className="h-3 w-3 inline mr-1" />
            Crew ({crew.length})
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="p-3 border-b">
        <Input
          placeholder={`Search ${activeTab}...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeTab === 'trucks' ? (
          <>
            {filteredTrucks.map((truck) => (
              <DraggableTruckCard key={truck.id} truck={truck} />
            ))}
          </>
        ) : (
          <>
            {filteredCrew.map((member) => (
              <DraggableCrewCard key={member.id} member={member} />
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t">
        <Button variant="outline" className="w-full" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          {activeTab === 'trucks' ? 'Add Rental Truck' : 'Add Crew Member'}
        </Button>
      </div>
    </div>
  );
}
