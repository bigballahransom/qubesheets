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

    // Search in customer email
    if (project.customerEmail?.toLowerCase().includes(query)) return true;
    
    // Search in phone number (remove non-digits for comparison)
    const cleanQuery = query.replace(/\D/g, '');
    const cleanPhone = project.phone?.replace(/\D/g, '');
    if (cleanPhone && cleanQuery && cleanPhone.includes(cleanQuery)) return true;

    // Search by CRM job/quote identifier, any integration
    if (projectMatchesCrmId(project, query)) return true;

    return false;
  });
}

// True when the query matches one of the project's CRM job/quote identifiers.
// "#9818" works too. Human-facing numbers/codes match anywhere in the string;
// UUID ids (Supermove, MoveRight) are prefix-only so short digit queries
// don't fuzzy-match random uuid fragments.
export function projectMatchesCrmId(project: any, searchQuery: string): boolean {
  const idQuery = searchQuery.toLowerCase().trim().replace(/^#/, '');
  if (!idQuery) return false;

  const meta = project.metadata || {};
  const humanIds = [
    meta.smartMovingQuoteNumber,
    meta.chariotSync?.jobId,
    meta.moverbaseSync?.jobId,
    meta.moverightSync?.jobCode,
  ];
  if (
    humanIds.some(
      (id) => id !== undefined && id !== null && String(id).toLowerCase().includes(idQuery)
    )
  ) {
    return true;
  }
  const uuidIds = [meta.supermoveProjectUuid, meta.moverightSync?.jobId];
  return uuidIds.some(
    (id) => typeof id === 'string' && id.toLowerCase().startsWith(idQuery)
  );
}