import { type Metadata } from 'next'
import {
  ClerkProvider,
} from '@clerk/nextjs'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import '@livekit/components-styles'
import { OrganizationDataProvider } from '@/components/providers/OrganizationDataProvider'
import { Toaster } from 'sonner';
import EmergencyCleanup from '@/components/EmergencyCleanup';

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
          <EmergencyCleanup />
          <OrganizationDataProvider>
            <main>
              {children}
            </main>
            <Toaster />
          </OrganizationDataProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}