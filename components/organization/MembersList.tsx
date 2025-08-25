'use client';

import { useOrganization, useOrganizationList } from '@clerk/nextjs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MoreHorizontal, Shield, User, Crown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import InviteMemberModal from './InviteMemberModal';

export default function MembersList() {
  const { organization, memberships } = useOrganization({
    memberships: {
      infinite: true,
    },
  });

  if (!organization || !memberships) {
    return <div>Loading members...</div>;
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield className="h-4 w-4 text-blue-600" />;
      case 'basic_member':
        return <User className="h-4 w-4 text-gray-500" />;
      default:
        return <User className="h-4 w-4 text-gray-500" />;
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin':
        return 'default' as const;
      case 'basic_member':
        return 'secondary' as const;
      default:
        return 'secondary' as const;
    }
  };

  const formatRole = (role: string) => {
    switch (role) {
      case 'admin':
        return 'Admin';
      case 'basic_member':
        return 'Member';
      default:
        return role;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Team Members
            </CardTitle>
            <CardDescription>
              Manage your organization's members and their permissions
            </CardDescription>
          </div>
          <InviteMemberModal />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {memberships?.data?.map((membership) => (
            <div
              key={membership.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
            >
              <div className="flex items-center space-x-3">
                <Avatar className="h-10 w-10">
                  <AvatarImage 
                    src={membership.publicUserData?.imageUrl} 
                    alt={membership.publicUserData?.firstName || 'User'} 
                  />
                  <AvatarFallback>
                    {(membership.publicUserData?.firstName?.[0] || '') + 
                     (membership.publicUserData?.lastName?.[0] || '')}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center space-x-2">
                    <p className="font-medium">
                      {membership.publicUserData?.firstName} {membership.publicUserData?.lastName}
                    </p>
                    {membership.publicUserData?.identifier && (
                      <Badge variant="outline" className="text-xs">
                        {membership.publicUserData.identifier}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">
                    {membership.publicUserData?.identifier}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1">
                  {getRoleIcon(membership.role)}
                  <Badge variant={getRoleBadgeVariant(membership.role)}>
                    {formatRole(membership.role)}
                  </Badge>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>View Profile</DropdownMenuItem>
                    <DropdownMenuItem>Change Role</DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600">
                      Remove Member
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}