"use client";
import { useEffect, RefObject } from "react";

export function useClickAway<T extends HTMLElement>(
  ref: RefObject<T | null>,
  onClickAway: () => void,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClickAway();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [ref, onClickAway, enabled]);
}
