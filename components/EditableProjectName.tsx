// components/EditableProjectName.tsx
'use client';

import React, { useState, useRef, useEffect } from 'react';

interface EditableProjectNameProps {
  initialName: string;
  onNameChange: (newName: string) => void;
}

const EditableProjectName: React.FC<EditableProjectNameProps> = ({ 
  initialName, 
  onNameChange 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [projectName, setProjectName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Update the project name if the initialName prop changes
  useEffect(() => {
    setProjectName(initialName);
  }, [initialName]);

  // Focus the input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleDoubleClick = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (projectName.trim() !== initialName) {
      onNameChange(projectName);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
      if (projectName.trim() !== initialName) {
        onNameChange(projectName);
      }
    }
    if (e.key === 'Escape') {
      // Restore previous value on escape
      setProjectName(initialName);
      setIsEditing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProjectName(e.target.value);
  };

  return (
    <div className="flex flex-col items-start justify-center py-0">
      <div className="w-full max-w-md px-2 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={projectName}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className="w-full p-1 text-lg font-medium text-gray-900 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Edit project name"
              />
            ) : (
              <h2
                onDoubleClick={handleDoubleClick}
                className="text-lg font-medium text-gray-900 cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors"
              >
                {projectName}
              </h2>
            )}
          </div>
          {/* <div className="ml-2 flex items-center text-gray-400">
            {!isEditing && (
              <p className="text-xs">Double-click to edit</p>
            )}
          </div> */}
        </div>
      </div>
    </div>
  );
};

export default EditableProjectName;