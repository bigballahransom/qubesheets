
'use client'
import React, { useState, useRef, useEffect } from 'react';

const EditableProjectName = () => {
  const [isEditing, setIsEditing] = useState(false);
  const [projectName, setProjectName] = useState("My Awesome Project");
  const inputRef = useRef(null);

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
    // Optional: validate or save the project name here
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
    }
    if (e.key === 'Escape') {
      // Optional: restore previous value on escape
      setIsEditing(false);
    }
  };

  const handleChange = (e) => {
    setProjectName(e.target.value);
  };

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <div className="w-full max-w-md p-2 bg-white rounded-lg border border-gray-200">
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
          <div className="ml-2 flex items-center text-gray-400">
            {!isEditing && (
              <p className="text-xs">Double-click to edit</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditableProjectName;