// components/navbar.jsx
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '../../components/ui/button'
import { Menu, X } from 'lucide-react'
import { motion } from 'framer-motion'
import Logo from '../../public/logo'
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs'

export default function Navbar() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setIsScrolled(true)
      } else {
        setIsScrolled(false)
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Navigation links
  const navLinks = [
    { name: 'Features', href: '#features' },
    { name: 'Pricing', href: '#pricing' },
    { name: 'Integrations', href: '/integrations' },
    // { name: 'Testimonials', href: '#testimonials' },
    // { name: 'Contact', href: '#contact' }
  ]

  return (
    <ClerkProvider>
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled 
          ? 'bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-md py-3' 
          : 'bg-transparent py-5'
      }`}
    >
      <div className="container px-4 md:px-6 mx-auto">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <Logo />
          </Link>

          {/* Desktop Navigation */}
          {/* <nav className="hidden md:flex items-center space-x-8">
            {navLinks.map((link) => (
              <Link 
                key={link.name}
                href={link.href}
                className="text-gray-700 hover:text-blue-500 dark:text-gray-300 dark:hover:text-blue-400 font-medium transition-colors"
              >
                {link.name}
              </Link>
            ))}
          </nav> */}

          {/* Desktop Action Buttons */}
          <div className="flex items-center space-x-4">
          <SignedIn>
              <UserButton />
            </SignedIn>
          </div>

          {/* Mobile Menu Button */}
          {/* <button
            className="md:hidden text-gray-700 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button> */}
        </div>
      </div>

      {/* Mobile Menu */}
      {/* {isMobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
          className="md:hidden bg-white dark:bg-gray-900 shadow-lg"
        >
          <div className="container px-4 py-4">
            <nav className="flex flex-col space-y-4">
              {navLinks.map((link) => (
                <Link 
                  key={link.name}
                  href={link.href}
                  className="text-gray-700 hover:text-blue-500 dark:text-gray-300 dark:hover:text-blue-400 font-medium transition-colors py-2"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.name}
                </Link>
              ))}
              <div className="pt-2 flex flex-col space-y-3">
                <Button 
                  asChild 
                  variant="outline" 
                  className="w-full justify-center font-medium"
                >
                  <Link href="https://infinite-beetle-73.accounts.dev/sign-in?redirect_url=https%3A%2F%2Fapp.qubesheets.com%2F">Login</Link>
                </Button>
                <Button 
                  asChild 
                  className="w-full justify-center bg-blue-500 hover:bg-blue-400 text-white font-medium"
                >
                  <Link href="/demo">See Demo</Link>
                </Button>
              </div>
            </nav>
          </div>
        </motion.div>
      )} */}
    </header>
    </ClerkProvider>
  )
}