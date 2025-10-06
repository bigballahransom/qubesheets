'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface SearchContextType {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <SearchContext.Provider value={{ searchQuery, setSearchQuery }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}

// Helper function to filter projects based on search query
export function filterProjects(projects: any[], searchQuery: string) {
  if (!searchQuery.trim()) return projects;
  
  const query = searchQuery.toLowerCase().trim();
  
  return projects.filter(project => {
    // Search in project name
    if (project.name?.toLowerCase().includes(query)) return true;
    
    // Search in customer name
    if (project.customerName?.toLowerCase().includes(query)) return true;
    
    // Search in phone number (remove non-digits for comparison)
    const cleanQuery = query.replace(/\D/g, '');
    const cleanPhone = project.phone?.replace(/\D/g, '');
    if (cleanPhone && cleanQuery && cleanPhone.includes(cleanQuery)) return true;
    
    return false;
  });
}