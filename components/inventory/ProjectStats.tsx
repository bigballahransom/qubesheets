'use client';

import { useMemo } from 'react';
import { 
  Package, ShoppingBag, Scale, TrendingUp, Box
} from 'lucide-react';

interface ProjectStatsConfig {
  id: string;
  label: string;
  value: number | string;
  icon: any;
  color: string;
  bgColor: string;
  textColor: string;
}

interface ProjectStatsProps {
  spreadsheetRows: any[];
  className?: string;
  variant?: 'cards' | 'compact' | 'inline';
  showLabels?: boolean;
  hideGoing?: boolean;
}

export default function ProjectStats({ 
  spreadsheetRows = [], 
  className = "",
  variant = 'cards',
  showLabels = true,
  hideGoing = false
}: ProjectStatsProps) {
  // Calculate stats based on spreadsheet rows
  const stats = useMemo(() => {
    if (!spreadsheetRows || spreadsheetRows.length === 0) {
      return {
        totalItems: 0,
        totalBoxes: 0,
        totalCuft: 0,
        totalWeight: 0,
        totalGoing: 0
      };
    }

    return spreadsheetRows
      .filter(row => row.cells && !row.isAnalyzing)
      .reduce((acc, row) => {
        const count = parseFloat(row.cells.col3) || 0;
        const cuft = parseFloat(row.cells.col4) || 0;
        const weight = parseFloat(row.cells.col5) || 0;
        const going = row.cells.col6?.toLowerCase();

        acc.totalItems += count;
        acc.totalBoxes += count;
        acc.totalCuft += cuft;
        acc.totalWeight += weight;
        
        if (going === 'yes' || going === 'y') {
          acc.totalGoing += count;
        }
        
        return acc;
      }, {
        totalItems: 0,
        totalBoxes: 0,
        totalCuft: 0,
        totalWeight: 0,
        totalGoing: 0
      });
  }, [spreadsheetRows]);

  const allStatsConfig: ProjectStatsConfig[] = [
    {
      id: 'items',
      label: 'Items',
      value: stats.totalItems,
      icon: ShoppingBag,
      color: 'blue',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-600'
    },
    {
      id: 'boxes',
      label: 'Boxes',
      value: stats.totalBoxes,
      icon: Package,
      color: 'purple',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-600'
    },
    {
      id: 'cuft',
      label: 'Cu Ft',
      value: stats.totalCuft.toFixed(1),
      icon: Box,
      color: 'green',
      bgColor: 'bg-green-100',
      textColor: 'text-green-600'
    },
    {
      id: 'weight',
      label: 'Weight',
      value: stats.totalWeight.toFixed(1),
      icon: Scale,
      color: 'orange',
      bgColor: 'bg-orange-100',
      textColor: 'text-orange-600'
    },
    {
      id: 'going',
      label: 'Going',
      value: stats.totalGoing,
      icon: TrendingUp,
      color: 'red',
      bgColor: 'bg-red-100',
      textColor: 'text-red-600'
    }
  ];

  const statsConfig = hideGoing 
    ? allStatsConfig.filter(stat => stat.id !== 'going')
    : allStatsConfig;

  if (variant === 'cards') {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-${hideGoing ? '4' : '5'} xl:grid-cols-${hideGoing ? '4' : '5'} gap-3 ${className}`}>
        {statsConfig.map((stat) => (
          <div key={stat.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center mr-3 flex-shrink-0`}>
              <stat.icon className={`h-5 w-5 ${stat.textColor}`} />
            </div>
            <div>
              {showLabels && (
                <p className="text-xs font-medium text-slate-500">{stat.label}</p>
              )}
              <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`flex flex-wrap gap-4 ${className}`}>
        {statsConfig.map((stat) => (
          <div key={stat.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
            <stat.icon className={`h-4 w-4 ${stat.textColor}`} />
            <span className="text-sm font-medium text-slate-700">{stat.label}:</span>
            <span className="text-sm font-bold text-slate-900">{stat.value}</span>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-6 ${className}`}>
        {statsConfig.map((stat) => (
          <div key={stat.id} className="flex items-center gap-2">
            <stat.icon className={`h-4 w-4 ${stat.textColor}`} />
            <span className="text-sm text-slate-600">{stat.label}:</span>
            <span className="text-sm font-semibold text-slate-900">{stat.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// Individual stat component for custom layouts
export function StatCard({ 
  label, 
  value, 
  icon: Icon, 
  bgColor = 'bg-gray-100', 
  textColor = 'text-gray-600',
  className = "" 
}: {
  label: string;
  value: string | number;
  icon: any;
  bgColor?: string;
  textColor?: string;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 flex items-center shadow-sm hover:shadow-md transition-shadow ${className}`}>
      <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center mr-3 flex-shrink-0`}>
        <Icon className={`h-5 w-5 ${textColor}`} />
      </div>
      <div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

// Hook for getting stats data without UI
export function useProjectStats(spreadsheetRows: any[]) {
  return useMemo(() => {
    if (!spreadsheetRows || spreadsheetRows.length === 0) {
      return {
        totalItems: 0,
        totalBoxes: 0,
        totalCuft: 0,
        totalWeight: 0,
        totalGoing: 0,
        isEmpty: true
      };
    }

    const stats = spreadsheetRows
      .filter(row => row.cells && !row.isAnalyzing)
      .reduce((acc, row) => {
        const count = parseFloat(row.cells.col3) || 0;
        const cuft = parseFloat(row.cells.col4) || 0;
        const weight = parseFloat(row.cells.col5) || 0;
        const going = row.cells.col6?.toLowerCase();

        acc.totalItems += count;
        acc.totalBoxes += count;
        acc.totalCuft += cuft;
        acc.totalWeight += weight;
        
        if (going === 'yes' || going === 'y') {
          acc.totalGoing += count;
        }
        
        return acc;
      }, {
        totalItems: 0,
        totalBoxes: 0,
        totalCuft: 0,
        totalWeight: 0,
        totalGoing: 0
      });

    return {
      ...stats,
      isEmpty: stats.totalItems === 0
    };
  }, [spreadsheetRows]);
}