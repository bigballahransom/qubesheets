'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { X, Menu, ChevronRight } from 'lucide-react';
import Link from 'next/link'
import Logo from '../../public/logo'

// Create context for sidebar state
type SidebarContextType = {
  isOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Check if window width is desktop size on initial load
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    };
    
    // Set initial state
    handleResize();
    
    // Add event listener
    window.addEventListener('resize', handleResize);
    
    // Cleanup
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggleSidebar = () => setIsOpen(!isOpen);
  const closeSidebar = () => setIsOpen(false);

  return (
    <SidebarContext.Provider value={{ isOpen, toggleSidebar, closeSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function SidebarTrigger() {
  const { toggleSidebar, isOpen } = useSidebar();
  
  return (
    <>
    <button
      onClick={toggleSidebar}
      className="fixed top-4 left-4 z-30 p-2 rounded-md hover:bg-gray-100 transition-colors lg:hidden"
      aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
    >
      <Menu size={20} />
    </button>
    <div className='fixed top-0 left-0 w-full bg-white h-16 z-20'>
    </div>
    <div className='fixed top-4 right-4 z-30 lg:hidden'>
    <Logo />
    </div>
    </>
  );
}

export function Sidebar({ children }: { children: React.ReactNode }) {
  const { isOpen, closeSidebar } = useSidebar();
  
  // Set CSS custom properties for mobile viewport handling
  useEffect(() => {
    const setViewportHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      
      // For mobile browsers, calculate available height excluding browser UI
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        const availableHeight = window.innerHeight;
        const headerHeight = 64; // 64px header
        const safeAreaBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-bottom') || '0');
        const mobileContentHeight = availableHeight - headerHeight - safeAreaBottom - 16; // 16px bottom padding
        document.documentElement.style.setProperty('--mobile-sidebar-height', `${mobileContentHeight}px`);
      }
    };

    // Set initial values
    setViewportHeight();
    
    // Update on resize and orientation change
    window.addEventListener('resize', setViewportHeight);
    window.addEventListener('orientationchange', () => {
      // Small delay to account for mobile browser UI adjustment
      setTimeout(setViewportHeight, 100);
    });
    
    return () => {
      window.removeEventListener('resize', setViewportHeight);
      window.removeEventListener('orientationchange', setViewportHeight);
    };
  }, []);
  
  // Handle clicks outside on mobile
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isOpen && window.innerWidth < 1024 && !target.closest('.sidebar')) {
        closeSidebar();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, closeSidebar]);
  
  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 z-35 lg:hidden" onClick={closeSidebar} />
      )}
      
      {/* Sidebar */}
      <aside 
        className={`sidebar fixed top-0 left-0 h-full w-64 bg-white shadow-lg z-40 transition-transform duration-300 transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="flex items-center justify-between p-4 border-b">
                 <Link href="/" className="flex items-center">
                      <Logo />
                    </Link>
          <button 
            className="p-1 rounded-md hover:bg-gray-100 lg:hidden"
            onClick={closeSidebar}
          >
            <X size={20} />
          </button>
        </div>
        
        <div 
          className="lg:h-[calc(100vh-64px)] overflow-hidden"
          style={{
            height: 'var(--mobile-sidebar-height, calc(100vh - 64px))'
          }}
        >
          {children}
        </div>
      </aside>
      
      {/* Main content wrapper with margin for sidebar */}
      <div className={`${isOpen ? 'lg:ml-64' : ''} transition-all duration-300`}>
        {/* Content goes here */}
      </div>
    </>
  );
}