'use client';

import { useState, useEffect } from 'react';
import { FileText, Plus, Edit, Trash2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

interface Template {
  id: string;
  name: string;
  type: 'sms' | 'email';
  content: string;
  createdAt: string;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([
    {
      id: '1',
      name: 'SMS Upload Link',
      type: 'sms',
      content: 'Hi {customerName}! Please upload your photos using this secure link: {uploadLink}. Link expires in 7 days.',
      createdAt: '2024-01-15'
    },
    {
      id: '2',
      name: 'Email Welcome',
      type: 'email',
      content: 'Welcome {customerName}! We\'re excited to help with your move. Your project "{projectName}" is ready.',
      createdAt: '2024-01-10'
    }
  ]);


  const handleEdit = (template: Template) => {
    // TODO: Implement template editing
    console.log('Edit template:', template);
  };

  const handleDelete = (templateId: string) => {
    setTemplates(templates.filter(t => t.id !== templateId));
  };

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="h-16"></div>
      <div className="container mx-auto p-4 max-w-4xl lg:pl-64">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <FileText className="h-6 w-6 text-blue-600" />
            <h1 className="text-2xl font-bold">Templates</h1>
          </div>
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </Button>
        </div>
        
        <div className="max-w-4xl">
          {/* Templates List */}
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <h2 className="text-lg font-medium mb-4">Message Templates</h2>
            
            <div className="space-y-4">
              {templates.map((template) => (
                <div key={template.id} className="border rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium">{template.name}</h3>
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          template.type === 'sms' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-blue-100 text-blue-700'
                        }`}>
                          {template.type.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {template.content}
                      </p>
                      <p className="text-xs text-gray-400 mt-2">
                        Created {new Date(template.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(template)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(template.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <SidebarTrigger />
    </SidebarProvider>
  );
}