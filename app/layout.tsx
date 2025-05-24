import { type Metadata } from 'next'
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import Navbar from '../components/nav/navbar'
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import '@livekit/components-styles';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata = {
  title: 'Qube Sheets | AI Inventory for Moving Companies',
  description: 'Automate inventory, with photo or video.',
  keywords: 'inventory, moving companies, inventory management, job scheduling, AI automation, paperless, bill of lading',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          {/* <Navbar/> */}
          <header className="flex justify-end items-center p-4 gap-4 h-16">
          </header>
          {/* <SidebarProvider>
      <AppSidebar /> */}
      <main>
        {/* <SidebarTrigger /> */}
        
          {children}
          </main>
          {/* </SidebarProvider> */}
        </body>
      </html>
    </ClerkProvider>
  )
}