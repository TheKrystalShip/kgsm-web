import React, { useState, useRef, useEffect } from 'react';
import './Dropdown.css';

interface DropdownOption<T = string> {
  value: T;
  label: string;
}

interface DropdownProps<T = string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Reusable dropdown component with keyboard navigation and accessibility
 */
const Dropdown = <T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
  disabled = false
}: DropdownProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Find the current option
  const selectedOption = options.find(option => option.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setFocusedIndex(0);
        } else if (focusedIndex >= 0) {
          onChange(options[focusedIndex].value);
          setIsOpen(false);
          setFocusedIndex(-1);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setFocusedIndex(0);
        } else {
          setFocusedIndex(prev =>
            prev < options.length - 1 ? prev + 1 : 0
          );
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (isOpen) {
          setFocusedIndex(prev =>
            prev > 0 ? prev - 1 : options.length - 1
          );
        }
        break;
    }
  };

  const handleOptionClick = (optionValue: T) => {
    onChange(optionValue);
    setIsOpen(false);
    setFocusedIndex(-1);
  };

  const toggleDropdown = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
    if (!isOpen) {
      setFocusedIndex(0);
    } else {
      setFocusedIndex(-1);
    }
  };

  return (
    <div
      ref={dropdownRef}
      className={`dropdown ${className} ${isOpen ? 'dropdown-open' : ''} ${disabled ? 'dropdown-disabled' : ''}`}
    >
      <button
        type="button"
        className="dropdown-trigger"
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        <span className="dropdown-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <svg
          className="dropdown-arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {isOpen && (
        <ul
          ref={listRef}
          className="dropdown-menu"
          role="listbox"
          aria-label="Options"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              className={`dropdown-option ${
                option.value === value ? 'dropdown-option-selected' : ''
              } ${
                index === focusedIndex ? 'dropdown-option-focused' : ''
              }`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => handleOptionClick(option.value)}
              onMouseEnter={() => setFocusedIndex(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Dropdown;
