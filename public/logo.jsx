// components/logo.jsx
'use client'

import { motion } from 'framer-motion'

export default function Logo() {
  return (
    <motion.div
      className="flex items-center gap-2"
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      {/* Hexagonal Q logo mark */}
      <svg width="30" height="30" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M87.5 25L50 3L12.5 25V75L50 97L87.5 75V25Z"
          className="fill-blue-500" // Changed to Tailwind blue-500
        />
        <path
          d="M75 32.5L50 18L25 32.5V67.5L50 82L75 67.5V32.5Z"
          fill="white"
        />
        <path
          d="M45 50V65L55 58V43L45 50Z"
          className="fill-blue-500" // Changed to Tailwind blue-500
        />
        <path
          d="M55 43L70 33V48L55 58V43Z"
          className="fill-blue-500" // Changed to Tailwind blue-500
        />
      </svg>
      
      {/* Wordmark */}
      <div className="flex items-center">
        {/* Qube text */}
        <span className="text-blue-500 font-bold text-2xl tracking-tight">qube</span>
        
        {/* Sheets text with highlighter effect */}
        <div className="relative ml-1">
          <span className="text-gray-800 dark:text-white font-bold text-2xl tracking-tight">sheets</span>
          {/* Highlighter effect */}
          <motion.div
            className="absolute -bottom-0.5 left-0 right-0 h-3 bg-yellow-200 dark:bg-blue-800 opacity-50 rounded-sm -z-10"
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ duration: 0.5, delay: 0.2 }}
          />
        </div>
      </div>
    </motion.div>
  )
}