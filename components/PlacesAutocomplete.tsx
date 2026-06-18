'use client';

import { useEffect, useRef } from 'react';

export interface PlacesAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (place: google.maps.places.PlaceResult) => void;
  placeholder?: string;
}

export default function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = 'Enter address...',
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Hold the latest callbacks in refs so the bind-effect can stay
  // dependency-free. Re-binding on every render destroys the Autocomplete
  // and the orphaned instance fires a stale `place_changed` with an empty
  // result the next time the input blurs — which was clobbering sibling
  // address fields in forms that had two autocompletes side-by-side.
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSelectRef.current = onSelect;
  });

  useEffect(() => {
    if (!inputRef.current || !window.google) return;

    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace();
      // Places fires place_changed on blur with an "empty" PlaceResult
      // (no place_id, no formatted_address) when the user didn't pick a
      // suggestion. Treat that as a no-op — propagating it would wipe
      // any previously-selected place on the same OR a sibling field.
      if (!place || (!place.place_id && !place.formatted_address)) return;
      onSelectRef.current(place);
      if (place.formatted_address) {
        onChangeRef.current(place.formatted_address);
      }
    });

    return () => {
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-3 border-2 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-base"
    />
  );
}
